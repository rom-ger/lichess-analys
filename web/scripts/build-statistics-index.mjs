import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const ENGINE_VERSION = '18-lite';
const ENGINE_DEPTH = 18;
const OPENING_PLIES = 30;
const MINIMUM_ERROR_LOSS = 10;
const BAD_POSITION_MAX_WIN_PERCENT = 35;
const RECOVERED_POSITION_MIN_WIN_PERCENT = 45;
const OPPONENT_BLUNDER_LOSS = 30;
const ENDGAME_NOT_LOST_MIN_WIN_PERCENT = 35;
const ENDGAME_LOST_MAX_WIN_PERCENT = 20;

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
  if (evaluation.kind === 'mate') return Math.sign(evaluation.value || -1) * 1_000;
  return Math.max(-1_000, Math.min(1_000, evaluation.value));
}

function whiteWinPercent(evaluation) {
  const centipawns = evaluationToCentipawns(evaluation);
  const winningChances = 2 / (1 + Math.exp(-0.00368208 * centipawns)) - 1;
  return 50 + 50 * winningChances;
}

function winPercentLoss(move, before, after) {
  const beforeWhite = whiteWinPercent(before.evaluation);
  const afterWhite = whiteWinPercent(after.evaluation);
  const beforeMover = move.color === 'w' ? beforeWhite : 100 - beforeWhite;
  const afterMover = move.color === 'w' ? afterWhite : 100 - afterWhite;
  return Math.max(0, beforeMover - afterMover);
}

function winPercentFor(evaluation, color) {
  const white = whiteWinPercent(evaluation);
  return color === 'white' ? white : 100 - white;
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

function lostOpeningForColor(analysis, moves, color) {
  const moveColor = color === 'white' ? 'w' : 'b';
  const limit = Math.min(OPENING_PLIES, moves.length);

  for (let index = 0; index < limit; index += 1) {
    const move = moves[index];
    if (move.color !== moveColor) continue;

    const before = analysis.positions[index];
    const after = analysis.positions[index + 1];
    const loss = winPercentLoss(move, before, after);
    const afterWinPercent = winPercentFor(after.evaluation, color);
    if (loss < MINIMUM_ERROR_LOSS || afterWinPercent > BAD_POSITION_MAX_WIN_PERCENT) continue;

    let ending = { type: 'gameEnd', ply: moves.length, move: null };
    let stayedBad = true;

    for (let futureIndex = index + 1; futureIndex < moves.length; futureIndex += 1) {
      const futureMove = moves[futureIndex];
      const futureBefore = analysis.positions[futureIndex];
      const futureAfter = analysis.positions[futureIndex + 1];

      if (
        futureMove.color !== moveColor
        && winPercentLoss(futureMove, futureBefore, futureAfter) >= OPPONENT_BLUNDER_LOSS
      ) {
        ending = {
          type: 'opponentBlunder',
          ply: futureIndex + 1,
          move: futureMove.san,
        };
        break;
      }

      if (
        winPercentFor(futureAfter.evaluation, color)
        >= RECOVERED_POSITION_MIN_WIN_PERCENT
      ) {
        stayedBad = false;
        break;
      }
    }

    if (!stayedBad) continue;

    return {
      positionKey: positionKey(before.fen),
      fen: before.fen,
      ply: index + 1,
      moveNumber: Math.floor(index / 2) + 1,
      playedMove: move.san,
      bestMove: uciToSan(before.fen, before.bestMove),
      winPercentLoss: Math.round(loss * 10) / 10,
      afterWinPercent: Math.round(afterWinPercent * 10) / 10,
      badUntil: ending.type,
      badUntilPly: ending.ply,
      opponentBlunderMove: ending.move,
    };
  }

  return null;
}

function lostOpenings(analysis, moves, result) {
  return {
    white: result === '0-1' ? lostOpeningForColor(analysis, moves, 'white') : null,
    black: result === '1-0' ? lostOpeningForColor(analysis, moves, 'black') : null,
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

    const beforeWinPercent = winPercentFor(before.evaluation, color);
    const afterWinPercent = winPercentFor(after.evaluation, color);
    if (
      beforeWinPercent < ENDGAME_NOT_LOST_MIN_WIN_PERCENT
      || afterWinPercent > ENDGAME_LOST_MAX_WIN_PERCENT
    ) continue;

    let recovered = false;
    for (let futureIndex = index + 1; futureIndex < moves.length; futureIndex += 1) {
      const futureWinPercent = winPercentFor(
        analysis.positions[futureIndex + 1].evaluation,
        color,
      );
      if (futureWinPercent >= ENDGAME_NOT_LOST_MIN_WIN_PERCENT) {
        recovered = true;
        break;
      }
    }
    if (recovered) continue;

    return {
      type: endgameType(material),
      fen: before.fen,
      ply: index + 1,
      moveNumber: Math.floor(index / 2) + 1,
      playedMove: move.san,
      bestMove: uciToSan(before.fen, before.bestMove),
      beforeWinPercent: Math.round(beforeWinPercent * 10) / 10,
      afterWinPercent: Math.round(afterWinPercent * 10) / 10,
      winPercentLoss: Math.round((beforeWinPercent - afterWinPercent) * 10) / 10,
    };
  }

  return null;
}

function decisiveEndgames(analysis, moves, result) {
  return {
    white: result === '0-1' ? decisiveEndgameForColor(analysis, moves, 'white') : null,
    black: result === '1-0' ? decisiveEndgameForColor(analysis, moves, 'black') : null,
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
      if (analysis.positions.length !== moves.length + 1) {
        throw new Error('число позиций не совпадает с PGN');
      }

      statistics.push({
        gameId: entry.gameId,
        playedAt: playedAt(source.tags),
        speed: speed(source.tags),
        result: source.tags.Result,
        white: source.tags.White,
        black: source.tags.Black,
        lostOpening: lostOpenings(analysis, moves, source.tags.Result),
        decisiveEndgame: decisiveEndgames(analysis, moves, source.tags.Result),
      });
    } catch (error) {
      failures.push(`${entry.gameId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const temporaryFile = join(analysisRoot, `.${randomUUID()}.statistics.json.tmp`);
  await writeFile(temporaryFile, `${JSON.stringify({
    schemaVersion: 8,
    engine: manifest.engine,
    generatedAt: new Date().toISOString(),
    opening: {
      plies: OPENING_PLIES,
      minimumWinPercentLoss: MINIMUM_ERROR_LOSS,
      badPositionMaxWinPercent: BAD_POSITION_MAX_WIN_PERCENT,
      recoveredPositionMinWinPercent: RECOVERED_POSITION_MIN_WIN_PERCENT,
      opponentBlunderLoss: OPPONENT_BLUNDER_LOSS,
    },
    endgame: {
      notLostMinWinPercent: ENDGAME_NOT_LOST_MIN_WIN_PERCENT,
      lostMaxWinPercent: ENDGAME_LOST_MAX_WIN_PERCENT,
    },
    games: statistics,
  })}\n`, 'utf8');
  await rename(temporaryFile, outputFile);

  console.log(`Индекс проигранных дебютов: ${statistics.length} партий → ${outputFile}`);
  if (failures.length > 0) {
    console.warn(`Пропущено партий: ${failures.length}`);
    for (const failure of failures.slice(0, 20)) console.warn(`  ${failure}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
