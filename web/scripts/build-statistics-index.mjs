import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = join(webRoot, '..');
const pgnRoot = join(repositoryRoot, 'pgn');
const analysisRoot = join(
  webRoot,
  'public',
  'analysis',
  'stockfish-18-lite-depth-18',
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

function moveAccuracy(winPercentLoss) {
  const accuracy = 103.1668 * Math.exp(-0.04354 * winPercentLoss) - 3.1669;
  return Math.max(0, Math.min(100, accuracy));
}

function phaseForPosition(fen) {
  const [board, , , , , fullmoveValue] = fen.split(' ');
  const pieceValues = { q: 9, r: 5, b: 3, n: 3 };
  let nonPawnMaterial = 0;
  let queens = 0;

  for (const piece of board.toLowerCase()) {
    nonPawnMaterial += pieceValues[piece] ?? 0;
    if (piece === 'q') queens += 1;
  }

  if (Number(fullmoveValue) <= 12) return 'opening';
  if (nonPawnMaterial <= 24 || (queens === 0 && nonPawnMaterial <= 30)) return 'endgame';
  return 'middlegame';
}

function isQueenless(fen) {
  const board = fen.split(' ')[0].toLowerCase();
  return !board.includes('q');
}

function winPercentFor(evaluation, color) {
  const white = whiteWinPercent(evaluation);
  return color === 'white' ? white : 100 - white;
}

function emptyMetrics() {
  return {
    moves: 0,
    totalAccuracy: 0,
    totalCentipawnLoss: 0,
    totalWinPercentLoss: 0,
    comparableBestMoves: 0,
    bestMoveMatches: 0,
    inaccuracies: 0,
    mistakes: 0,
    blunders: 0,
    firstSeriousErrorPly: null,
  };
}

function addMove(metrics, move, before, after) {
  const multiplier = move.color === 'w' ? 1 : -1;
  const beforeCentipawns = multiplier * evaluationToCentipawns(before.evaluation);
  const afterCentipawns = multiplier * evaluationToCentipawns(after.evaluation);
  const beforeWinPercent = move.color === 'w'
    ? whiteWinPercent(before.evaluation)
    : 100 - whiteWinPercent(before.evaluation);
  const afterWinPercent = move.color === 'w'
    ? whiteWinPercent(after.evaluation)
    : 100 - whiteWinPercent(after.evaluation);
  const centipawnLoss = Math.max(0, beforeCentipawns - afterCentipawns);
  const winPercentLoss = Math.max(0, beforeWinPercent - afterWinPercent);
  const actualMove = `${move.from}${move.to}${move.promotion ?? ''}`;

  metrics.moves += 1;
  metrics.totalAccuracy += moveAccuracy(winPercentLoss);
  metrics.totalCentipawnLoss += centipawnLoss;
  metrics.totalWinPercentLoss += winPercentLoss;

  if (before.bestMove) {
    metrics.comparableBestMoves += 1;
    if (before.bestMove === actualMove) metrics.bestMoveMatches += 1;
  }

  if (winPercentLoss >= 30) {
    metrics.blunders += 1;
  } else if (winPercentLoss >= 20) {
    metrics.mistakes += 1;
  } else if (winPercentLoss >= 10) {
    metrics.inaccuracies += 1;
  }

  if (winPercentLoss >= 20 && metrics.firstSeriousErrorPly === null) {
    metrics.firstSeriousErrorPly = move.ply;
  }
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
  if (manifest.engine?.version !== '18-lite' || manifest.engine?.depth !== 18) {
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

      const white = emptyMetrics();
      const black = emptyMetrics();
      const whitePhases = {
        opening: emptyMetrics(),
        middlegame: emptyMetrics(),
        endgame: emptyMetrics(),
      };
      const blackPhases = {
        opening: emptyMetrics(),
        middlegame: emptyMetrics(),
        endgame: emptyMetrics(),
      };
      const whiteQueenless = emptyMetrics();
      const blackQueenless = emptyMetrics();
      for (let index = 0; index < moves.length; index += 1) {
        const move = moves[index];
        const color = move.color === 'w' ? 'white' : 'black';
        const metrics = color === 'white' ? white : black;
        const phases = color === 'white' ? whitePhases : blackPhases;
        const queenless = color === 'white' ? whiteQueenless : blackQueenless;
        const phase = phaseForPosition(analysis.positions[index].fen);
        const moveWithPly = { ...move, ply: index + 1 };
        addMove(
          metrics,
          moveWithPly,
          analysis.positions[index],
          analysis.positions[index + 1],
        );
        addMove(
          phases[phase],
          moveWithPly,
          analysis.positions[index],
          analysis.positions[index + 1],
        );
        if (isQueenless(analysis.positions[index].fen)) {
          addMove(
            queenless,
            moveWithPly,
            analysis.positions[index],
            analysis.positions[index + 1],
          );
        }
      }

      const openingExitPosition = analysis.positions.find((position, index) => (
        index > 0 && phaseForPosition(position.fen) !== 'opening'
      ));

      statistics.push({
        gameId: entry.gameId,
        playedAt: playedAt(source.tags),
        speed: speed(source.tags),
        result: source.tags.Result,
        white: source.tags.White,
        black: source.tags.Black,
        metrics: { white, black },
        phaseMetrics: { white: whitePhases, black: blackPhases },
        queenlessMetrics: { white: whiteQueenless, black: blackQueenless },
        openingExitWinPercent: openingExitPosition ? {
          white: winPercentFor(openingExitPosition.evaluation, 'white'),
          black: winPercentFor(openingExitPosition.evaluation, 'black'),
        } : { white: null, black: null },
      });
    } catch (error) {
      failures.push(`${entry.gameId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const temporaryFile = join(analysisRoot, `.${randomUUID()}.statistics.json.tmp`);
  await writeFile(temporaryFile, `${JSON.stringify({
    schemaVersion: 2,
    engine: manifest.engine,
    generatedAt: new Date().toISOString(),
    games: statistics,
  })}\n`, 'utf8');
  await rename(temporaryFile, outputFile);

  console.log(`Индекс статистики: ${statistics.length} партий → ${outputFile}`);
  if (failures.length > 0) {
    console.warn(`Пропущено партий: ${failures.length}`);
    for (const failure of failures.slice(0, 20)) console.warn(`  ${failure}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
