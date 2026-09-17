import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import { OPENING_RULES, openingPhaseBeforeMoves } from './opening-phase.mjs';
import { classifyOpeningError } from './opening-error-themes.mjs';
import { buildPeriodMetrics, validateSummaryAnalysis } from './period-metrics.mjs';

const ENGINE_VERSION = '18-lite';
const ENGINE_DEPTH = 18;
const OPENING_PLIES = OPENING_RULES.maxFullMoves * 2;
const OPENING_NOT_LOST_MIN_EVALUATION = -50;
const OPENING_LOST_MAX_EVALUATION = -200;
const OPPONENT_BLUNDER_LOSS = 300;
const ENDGAME_NOT_LOST_MIN_EVALUATION = -50;
const ENDGAME_LOST_MAX_EVALUATION = -200;

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = join(webRoot, '..');
const pgnRoot = join(repositoryRoot, 'pgn');
const analysisRoot = join(
  webRoot,
  'public',
  'analysis',
  `stockfish-${ENGINE_VERSION}-depth-${ENGINE_DEPTH}`,
);
const manifestFile = join(analysisRoot, 'manifest.json');
const outputFile = join(analysisRoot, 'statistics.json');

function splitPgn(source) {
  return source.trim().split(/\r?\n\r?\n(?=\[Event )/);
}

function parseTags(gamePgn) {
  const header = gamePgn.split(/\r?\n\r?\n/, 1)[0];
  const tags = {};
  for (const match of header.matchAll(/^\[([A-Za-z0-9_]+) "(.*)"\]$/gm)) {
    tags[match[1]] = match[2].replaceAll('\\"', '"');
  }
  return tags;
}

function gameId(gamePgn, tags) {
  const fallback = createHash('sha256').update(gamePgn).digest('hex').slice(0, 16);
  return tags.GameId ?? tags.Site?.split('/').at(-1) ?? fallback;
}

function playedAt(tags) {
  const date = (tags.UTCDate ?? tags.Date ?? '').replaceAll('.', '-');
  const time = tags.UTCTime ?? '00:00:00';
  const timestamp = Date.parse(`${date}T${time}Z`);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function speed(tags) {
  const event = (tags.Event ?? '').toLowerCase();
  if (event.includes('bullet') || event.includes('пуля')) return 'bullet';
  if (event.includes('blitz') || event.includes('блиц')) return 'blitz';
  if (event.includes('rapid') || event.includes('рапид')) return 'rapid';
  return null;
}

function evaluationToCentipawns(evaluation) {
  if (evaluation.kind === 'mate') {
    const distance = Math.min(99, Math.abs(evaluation.value));
    return Math.sign(evaluation.value || -1) * (100_000 - distance * 100);
  }
  return evaluation.value;
}

function evaluationLoss(move, before, after) {
  const beforeWhite = evaluationToCentipawns(before.evaluation);
  const afterWhite = evaluationToCentipawns(after.evaluation);
  const beforeMover = move.color === 'w' ? beforeWhite : -beforeWhite;
  const afterMover = move.color === 'w' ? afterWhite : -afterWhite;
  return Math.max(0, beforeMover - afterMover);
}

function evaluationFor(evaluation, color) {
  const white = evaluationToCentipawns(evaluation);
  return color === 'white' ? white : -white;
}

function positionKey(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}

function uciToSan(fen, uci) {
  const match = uci?.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
  if (!match) return uci ?? null;

  try {
    return new Chess(fen).move({
      from: match[1],
      to: match[2],
      promotion: match[3],
    })?.san ?? uci;
  } catch {
    return uci;
  }
}

// Keep the error if the position stays at least as bad until the end or
// the opponent's first serious blunder. An earlier improvement rejects it.
function badPositionEnding(analysis, moves, color, index, afterEvaluation) {
  const moveColor = color === 'white' ? 'w' : 'b';
  for (let futureIndex = index + 1; futureIndex < moves.length; futureIndex += 1) {
    const move = moves[futureIndex];
    const before = analysis.positions[futureIndex];
    const after = analysis.positions[futureIndex + 1];
    if (
      move.color !== moveColor
      && evaluationLoss(move, before, after) >= OPPONENT_BLUNDER_LOSS
    ) {
      return {
        badUntil: 'opponentBlunder',
        badUntilPly: futureIndex + 1,
        opponentBlunderMove: move.san,
      };
    }
    if (evaluationFor(after.evaluation, color) > afterEvaluation) return null;
  }
  return { badUntil: 'gameEnd', badUntilPly: moves.length, opponentBlunderMove: null };
}

function lostOpeningForColor(analysis, moves, color, openingPositions) {
  const moveColor = color === 'white' ? 'w' : 'b';
  const limit = Math.min(OPENING_PLIES, moves.length);

  for (let index = 0; index < limit; index += 1) {
    const move = moves[index];
    if (move.color !== moveColor || !openingPositions[index]) continue;

    const before = analysis.positions[index];
    const after = analysis.positions[index + 1];
    const moveNumber = Number(before.fen.split(' ')[5]);
    const beforeEvaluation = evaluationFor(before.evaluation, color);
    const afterEvaluation = evaluationFor(after.evaluation, color);
    if (
      beforeEvaluation < OPENING_NOT_LOST_MIN_EVALUATION
      || afterEvaluation > OPENING_LOST_MAX_EVALUATION
    ) continue;
    const ending = badPositionEnding(analysis, moves, color, index, afterEvaluation);
    if (!ending) continue;

    return {
      positionKey: positionKey(before.fen),
      themes: classifyOpeningError(analysis, moves, index),
      fen: before.fen,
      ply: index + 1,
      moveNumber,
      playedMove: move.san,
      bestMove: uciToSan(before.fen, before.bestMove),
      beforeEvaluation,
      evaluationLoss: beforeEvaluation - afterEvaluation,
      afterEvaluation,
      ...ending,
    };
  }

  return null;
}

function lostOpenings(analysis, moves) {
  const openingPositions = openingPhaseBeforeMoves(moves, (fen) => isEndgame(materialFromFen(fen)));
  return {
    white: lostOpeningForColor(analysis, moves, 'white', openingPositions),
    black: lostOpeningForColor(analysis, moves, 'black', openingPositions),
  };
}

function materialFromFen(fen) {
  const board = fen.split(' ')[0];
  const material = {
    white: { queens: 0, rooks: 0, bishops: [], knights: 0, pawns: [] },
    black: { queens: 0, rooks: 0, bishops: [], knights: 0, pawns: [] },
  };
  let rank = 8;
  let file = 0;

  for (const token of board) {
    if (token === '/') {
      rank -= 1;
      file = 0;
      continue;
    }
    const empty = Number(token);
    if (Number.isInteger(empty) && empty > 0) {
      file += empty;
      continue;
    }

    const color = token === token.toUpperCase() ? 'white' : 'black';
    const piece = token.toLowerCase();
    if (piece === 'q') material[color].queens += 1;
    if (piece === 'r') material[color].rooks += 1;
    if (piece === 'n') material[color].knights += 1;
    if (piece === 'b') material[color].bishops.push((file + rank) % 2);
    if (piece === 'p') material[color].pawns.push(file);
    file += 1;
  }

  return material;
}

function isEndgame(material) {
  const queens = material.white.queens + material.black.queens;
  const rooks = material.white.rooks + material.black.rooks;
  const bishops = material.white.bishops.length + material.black.bishops.length;
  const knights = material.white.knights + material.black.knights;
  const pieceCount = queens + rooks + bishops + knights;
  const materialValue = queens * 9 + rooks * 5 + (bishops + knights) * 3;
  return pieceCount <= 4 || materialValue <= 24 || (queens === 0 && materialValue <= 30);
}

function pawnEndingType(material) {
  const whiteFlanks = new Set(
    material.white.pawns.map((file) => file <= 3 ? 'queen' : 'king'),
  );
  const blackFlanks = new Set(
    material.black.pawns.map((file) => file <= 3 ? 'queen' : 'king'),
  );
  if (
    whiteFlanks.size === 1
    && blackFlanks.size === 1
    && [...whiteFlanks][0] !== [...blackFlanks][0]
  ) return 'pawn-opposite-wings';

  const allFlanks = new Set([...whiteFlanks, ...blackFlanks]);
  return allFlanks.size > 1 ? 'pawn-both-wings' : 'pawn-one-wing';
}

function endgameType(material) {
  const queens = material.white.queens + material.black.queens;
  const rooks = material.white.rooks + material.black.rooks;
  const bishops = material.white.bishops.length + material.black.bishops.length;
  const knights = material.white.knights + material.black.knights;

  if (queens > 0) {
    return rooks + bishops + knights === 0 ? 'queen' : 'queen-mixed';
  }
  if (rooks > 0) {
    if (bishops + knights > 0) return 'rook-with-minors';
    if (material.white.rooks === 1 && material.black.rooks === 1) return 'rook-one-each';
    if (material.white.rooks === 2 && material.black.rooks === 2) return 'rook-two-each';
    return 'rook-unbalanced';
  }
  if (bishops + knights === 0) return pawnEndingType(material);
  if (bishops > 0 && knights === 0) {
    if (material.white.bishops.length === 1 && material.black.bishops.length === 1) {
      return material.white.bishops[0] === material.black.bishops[0]
        ? 'bishop-same-color'
        : 'bishop-opposite-color';
    }
    return 'bishop';
  }
  if (knights > 0 && bishops === 0) return 'knight';
  const whiteHasOnlyBishops = material.white.bishops.length > 0 && material.white.knights === 0;
  const blackHasOnlyBishops = material.black.bishops.length > 0 && material.black.knights === 0;
  const whiteHasOnlyKnights = material.white.knights > 0 && material.white.bishops.length === 0;
  const blackHasOnlyKnights = material.black.knights > 0 && material.black.bishops.length === 0;
  if (
    (whiteHasOnlyBishops && blackHasOnlyKnights)
    || (blackHasOnlyBishops && whiteHasOnlyKnights)
  ) return 'bishop-vs-knight';
  return 'minor-mixed';
}

function decisiveEndgameForColor(analysis, moves, color) {
  const moveColor = color === 'white' ? 'w' : 'b';

  for (let index = 0; index < moves.length; index += 1) {
    const move = moves[index];
    if (move.color !== moveColor) continue;

    const before = analysis.positions[index];
    const after = analysis.positions[index + 1];
    const material = materialFromFen(before.fen);
    if (!isEndgame(material)) continue;

    const beforeEvaluation = evaluationFor(before.evaluation, color);
    const afterEvaluation = evaluationFor(after.evaluation, color);
    if (
      beforeEvaluation < ENDGAME_NOT_LOST_MIN_EVALUATION
      || afterEvaluation > ENDGAME_LOST_MAX_EVALUATION
    ) continue;

    const ending = badPositionEnding(analysis, moves, color, index, afterEvaluation);
    if (!ending) continue;

    return {
      type: endgameType(material),
      fen: before.fen,
      ply: index + 1,
      moveNumber: Math.floor(index / 2) + 1,
      playedMove: move.san,
      bestMove: uciToSan(before.fen, before.bestMove),
      beforeEvaluation,
      afterEvaluation,
      evaluationLoss: beforeEvaluation - afterEvaluation,
      ...ending,
    };
  }

  return null;
}

function decisiveEndgames(analysis, moves) {
  return {
    white: decisiveEndgameForColor(analysis, moves, 'white'),
    black: decisiveEndgameForColor(analysis, moves, 'black'),
  };
}

async function loadPgnGames() {
  const names = (await readdir(pgnRoot)).filter((name) => name.toLowerCase().endsWith('.pgn'));
  const games = new Map();

  for (const name of names.sort()) {
    const source = await readFile(join(pgnRoot, name), 'utf8');
    for (const gamePgn of splitPgn(source)) {
      const tags = parseTags(gamePgn);
      if (!tags.Event || !tags.White || !tags.Black || !tags.Result) continue;
      games.set(gameId(gamePgn, tags), { gamePgn, tags });
    }
  }

  return games;
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  if (manifest.engine?.version !== ENGINE_VERSION || manifest.engine?.depth !== ENGINE_DEPTH) {
    throw new Error('Для статистики требуется полный анализ Stockfish 18 Lite на глубине 18.');
  }

  const pgnGames = await loadPgnGames();
  const statistics = [];
  const failures = [];

  for (const entry of manifest.games) {
    const source = pgnGames.get(entry.gameId);
    if (!source) {
      failures.push(`${entry.gameId}: партия отсутствует в PGN`);
      continue;
    }

    try {
      const chess = new Chess();
      chess.loadPgn(source.gamePgn);
      const moves = chess.history({ verbose: true });
      const analysis = JSON.parse(await readFile(join(analysisRoot, entry.file), 'utf8'));
      validateSummaryAnalysis(analysis, moves, entry.gameId, manifest.engine);
      if (!['1-0', '0-1', '1/2-1/2'].includes(source.tags.Result)) continue;
      const openings = lostOpenings(analysis, moves);
      const openingPositions = openingPhaseBeforeMoves(moves, (fen) => isEndgame(materialFromFen(fen)));
      const endgameTypes = moves.map((move) => {
        const material = materialFromFen(move.before);
        return isEndgame(material) ? endgameType(material) : null;
      });

      statistics.push({
        gameId: entry.gameId,
        playedAt: playedAt(source.tags),
        speed: speed(source.tags),
        result: source.tags.Result,
        white: source.tags.White,
        black: source.tags.Black,
        lostOpening: openings,
        decisiveEndgame: decisiveEndgames(analysis, moves),
        periodMetrics: buildPeriodMetrics(analysis, moves, openingPositions, endgameTypes, source.tags.Result, openings),
      });
    } catch (error) {
      failures.push(`${entry.gameId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const temporaryFile = join(analysisRoot, `.${randomUUID()}.statistics.json.tmp`);
  await writeFile(temporaryFile, `${JSON.stringify({
    schemaVersion: 14,
    engine: manifest.engine,
    generatedAt: new Date().toISOString(),
    opening: {
      plies: OPENING_PLIES,
      earlyFullMoves: OPENING_RULES.earlyFullMoves,
      developedMinors: OPENING_RULES.developedMinors,
      notLostMinEvaluation: OPENING_NOT_LOST_MIN_EVALUATION,
      lostMaxEvaluation: OPENING_LOST_MAX_EVALUATION,
      opponentBlunderLoss: OPPONENT_BLUNDER_LOSS,
    },
    endgame: {
      notLostMinEvaluation: ENDGAME_NOT_LOST_MIN_EVALUATION,
      lostMaxEvaluation: ENDGAME_LOST_MAX_EVALUATION,
      opponentBlunderLoss: OPPONENT_BLUNDER_LOSS,
    },
    games: statistics,
  })}\n`, 'utf8');
  await rename(temporaryFile, outputFile);

  console.log(`Индекс анализа и резюме: ${statistics.length} партий → ${outputFile}`);
  if (failures.length > 0) {
    console.warn(`Пропущено партий: ${failures.length}`);
    for (const failure of failures.slice(0, 20)) console.warn(`  ${failure}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
