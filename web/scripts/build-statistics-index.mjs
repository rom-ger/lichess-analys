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

function rating(value) {
  const parsed = Number(value);
  return value && Number.isFinite(parsed) ? parsed : null;
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

function winPercentLossForMove(move, before, after) {
  const beforeWinPercent = move.color === 'w'
    ? whiteWinPercent(before.evaluation)
    : 100 - whiteWinPercent(before.evaluation);
  const afterWinPercent = move.color === 'w'
    ? whiteWinPercent(after.evaluation)
    : 100 - whiteWinPercent(after.evaluation);
  return Math.max(0, beforeWinPercent - afterWinPercent);
}

function centipawnLossForMove(move, before, after) {
  const multiplier = move.color === 'w' ? 1 : -1;
  const beforeCentipawns = multiplier * evaluationToCentipawns(before.evaluation);
  const afterCentipawns = multiplier * evaluationToCentipawns(after.evaluation);
  return Math.max(0, beforeCentipawns - afterCentipawns);
}

function addMove(metrics, move, before, after) {
  const centipawnLoss = centipawnLossForMove(move, before, after);
  const winPercentLoss = winPercentLossForMove(move, before, after);
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

function advantageForColor(analysis, moves, color) {
  const moveColor = color === 'white' ? 'w' : 'b';
  const winPercents = analysis.positions.map((position) => (
    winPercentFor(position.evaluation, color)
  ));
  const firstWinningPosition = winPercents.findIndex((value) => value >= 80);
  const postAdvantageMetrics = emptyMetrics();
  const firstFiveMetrics = emptyMetrics();
  let ownMovesAfterAdvantage = 0;

  if (firstWinningPosition >= 0) {
    for (let index = firstWinningPosition; index < moves.length; index += 1) {
      const move = moves[index];
      if (move.color !== moveColor) continue;
      const moveWithPly = { ...move, ply: index + 1 };
      addMove(
        postAdvantageMetrics,
        moveWithPly,
        analysis.positions[index],
        analysis.positions[index + 1],
      );
      if (ownMovesAfterAdvantage < 5) {
        addMove(
          firstFiveMetrics,
          moveWithPly,
          analysis.positions[index],
          analysis.positions[index + 1],
        );
      }
      ownMovesAfterAdvantage += 1;
    }
  }

  return {
    maxWinPercent: Math.max(...winPercents),
    firstWinningPly: firstWinningPosition >= 0 ? firstWinningPosition : null,
    postAdvantageMetrics,
    firstFiveMetrics,
  };
}

function defenseForColor(analysis, moves, color) {
  const moveColor = color === 'white' ? 'w' : 'b';
  const winPercents = analysis.positions.map((position) => (
    winPercentFor(position.evaluation, color)
  ));
  const firstLosingPosition = winPercents.findIndex((value) => value <= 20);
  const firstHopelessPosition = winPercents.findIndex((value) => value <= 5);
  const postDisadvantageMetrics = emptyMetrics();
  const firstFiveMetrics = emptyMetrics();
  const postBlunderMetrics = emptyMetrics();
  let ownMovesAfterDisadvantage = 0;
  let ownMovesAfterHopeless = 0;

  if (firstLosingPosition >= 0) {
    for (let index = firstLosingPosition; index < moves.length; index += 1) {
      const move = moves[index];
      if (move.color !== moveColor) continue;
      const moveWithPly = { ...move, ply: index + 1 };
      addMove(
        postDisadvantageMetrics,
        moveWithPly,
        analysis.positions[index],
        analysis.positions[index + 1],
      );
      if (ownMovesAfterDisadvantage < 5) {
        addMove(
          firstFiveMetrics,
          moveWithPly,
          analysis.positions[index],
          analysis.positions[index + 1],
        );
      }
      ownMovesAfterDisadvantage += 1;
    }
  }

  if (firstHopelessPosition >= 0) {
    for (let index = firstHopelessPosition; index < moves.length; index += 1) {
      if (moves[index].color === moveColor) ownMovesAfterHopeless += 1;
    }
  }

  const firstBlunderIndex = moves.findIndex((move, index) => (
    move.color === moveColor
    && winPercentLossForMove(
      move,
      analysis.positions[index],
      analysis.positions[index + 1],
    ) >= 30
  ));
  let ownMovesAfterBlunder = 0;
  let errorCascade = null;

  if (firstBlunderIndex >= 0) {
    errorCascade = false;
    for (let index = firstBlunderIndex + 1; index < moves.length; index += 1) {
      const move = moves[index];
      if (move.color !== moveColor) continue;
      const moveWithPly = { ...move, ply: index + 1 };
      if (ownMovesAfterBlunder < 5) {
        addMove(
          postBlunderMetrics,
          moveWithPly,
          analysis.positions[index],
          analysis.positions[index + 1],
        );
      }
      if (
        ownMovesAfterBlunder < 3
        && winPercentLossForMove(
          move,
          analysis.positions[index],
          analysis.positions[index + 1],
        ) >= 20
      ) {
        errorCascade = true;
      }
      ownMovesAfterBlunder += 1;
      if (ownMovesAfterBlunder >= 5) break;
    }
  }

  return {
    minWinPercent: Math.min(...winPercents),
    firstLosingPly: firstLosingPosition >= 0 ? firstLosingPosition : null,
    bestRecoveryWinPercent: firstLosingPosition >= 0
      ? Math.max(...winPercents.slice(firstLosingPosition))
      : null,
    finalWinPercent: winPercents.at(-1),
    postDisadvantageMetrics,
    firstFiveMetrics,
    firstHopelessPly: firstHopelessPosition >= 0 ? firstHopelessPosition : null,
    ownMovesAfterHopeless,
    firstBlunderPly: firstBlunderIndex >= 0 ? firstBlunderIndex + 1 : null,
    postBlunderMetrics,
    errorCascade,
  };
}

function timeControl(tags) {
  const [initialValue, incrementValue = '0'] = (tags.TimeControl ?? '').split('+');
  const initial = Number(initialValue);
  const increment = Number(incrementValue);
  return {
    initial: Number.isFinite(initial) ? initial : null,
    increment: Number.isFinite(increment) ? increment : 0,
  };
}

function clockFromComment(comment) {
  const match = comment?.match(/\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function timeForColor(analysis, moves, clocks, tags, color) {
  const moveColor = color === 'white' ? 'w' : 'b';
  const control = timeControl(tags);
  const quickMetrics = emptyMetrics();
  const longMetrics = emptyMetrics();
  const lowTime60Metrics = emptyMetrics();
  const lowTime30Metrics = emptyMetrics();
  const lowTime10Metrics = emptyMetrics();
  const phaseTime = {
    opening: { moves: 0, totalSeconds: 0 },
    middlegame: { moves: 0, totalSeconds: 0 },
    endgame: { moves: 0, totalSeconds: 0 },
  };
  let previousClock = control.initial;
  let totalSeconds = 0;
  let timedMoves = 0;
  let quickErrors = 0;

  for (let index = 0; index < moves.length; index += 1) {
    const move = moves[index];
    if (move.color !== moveColor) continue;
    const currentClock = clocks[index];
    const beforeClock = previousClock;
    if (currentClock === null || beforeClock === null) continue;
    const spent = Math.max(0, beforeClock + control.increment - currentClock);
    const moveWithPly = { ...move, ply: index + 1 };
    const before = analysis.positions[index];
    const after = analysis.positions[index + 1];
    const phase = phaseForPosition(before.fen);
    const winPercentLoss = winPercentLossForMove(move, before, after);

    totalSeconds += spent;
    timedMoves += 1;
    phaseTime[phase].moves += 1;
    phaseTime[phase].totalSeconds += spent;
    if (spent <= 3) {
      addMove(quickMetrics, moveWithPly, before, after);
      if (winPercentLoss >= 10) quickErrors += 1;
    }
    if (spent >= 30) addMove(longMetrics, moveWithPly, before, after);
    if (beforeClock <= 60) addMove(lowTime60Metrics, moveWithPly, before, after);
    if (beforeClock <= 30) addMove(lowTime30Metrics, moveWithPly, before, after);
    if (beforeClock <= 10) addMove(lowTime10Metrics, moveWithPly, before, after);
    previousClock = currentClock;
  }

  return {
    timedMoves,
    totalSeconds,
    finalClock: previousClock,
    quickMetrics,
    longMetrics,
    lowTime60Metrics,
    lowTime30Metrics,
    lowTime10Metrics,
    quickErrors,
    phaseTime,
  };
}

function openingFamily(moves) {
  const san = moves.slice(0, 4).map((move) => move.san.replace(/[+#]/g, ''));
  const [first, second, third, fourth] = san;
  if (first === 'e4' && second === 'c5') return 'Сицилианская защита';
  if (first === 'e4' && second === 'e6') return 'Французская защита';
  if (first === 'e4' && second === 'c6') return 'Защита Каро — Канн';
  if (first === 'e4' && second === 'd5') return 'Скандинавская защита';
  if (first === 'e4' && (second === 'd6' || second === 'g6')) return 'Пирц / Модерн';
  if (first === 'e4' && second === 'e5' && third === 'Nf3' && fourth === 'Nc6') {
    return 'Открытые дебюты';
  }
  if (first === 'e4' && second === 'e5') return 'Дебют королевской пешки';
  if (first === 'd4' && second === 'd5' && third === 'c4') return 'Ферзевый гамбит';
  if (first === 'd4' && second === 'Nf6') return 'Индийские защиты';
  if (first === 'd4' && second === 'd5') return 'Дебют ферзевой пешки';
  if (first === 'c4') return 'Английское начало';
  if (first === 'Nf3') return 'Дебют Рети';
  return first ? `Другие: ${first}` : 'Не определён';
}

function openingForColor(analysis, moves, color) {
  const moveColor = color === 'white' ? 'w' : 'b';
  const metrics = emptyMetrics();
  let firstErrorPly = null;
  let firstErrorSan = null;

  for (let index = 0; index < Math.min(moves.length, 30); index += 1) {
    const move = moves[index];
    if (move.color !== moveColor) continue;
    const moveWithPly = { ...move, ply: index + 1 };
    addMove(metrics, moveWithPly, analysis.positions[index], analysis.positions[index + 1]);
    if (
      firstErrorPly === null
      && winPercentLossForMove(move, analysis.positions[index], analysis.positions[index + 1]) >= 10
    ) {
      firstErrorPly = index + 1;
      firstErrorSan = move.san;
    }
  }

  const exitIndex = Math.min(24, analysis.positions.length - 1);
  return {
    family: openingFamily(moves),
    line: moves.slice(0, 8).map((move) => move.san).join(' '),
    metrics,
    exitWinPercent: winPercentFor(analysis.positions[exitIndex].evaluation, color),
    firstErrorPly,
    firstErrorSan,
  };
}

function bestMoveTraits(position) {
  if (!position.bestMove || position.bestMove.length < 4) return null;
  try {
    const chess = new Chess(position.fen);
    const move = chess.move({
      from: position.bestMove.slice(0, 2),
      to: position.bestMove.slice(2, 4),
      promotion: position.bestMove.slice(4, 5) || undefined,
    });
    if (!move) return null;
    return {
      capture: Boolean(move.captured),
      check: chess.inCheck(),
      promotion: Boolean(move.promotion),
    };
  } catch {
    return null;
  }
}

function tacticalForColor(analysis, moves, color) {
  const moveColor = color === 'white' ? 'w' : 'b';
  const motifs = {
    missedCheck: { count: 0, totalWinPercentLoss: 0 },
    missedCapture: { count: 0, totalWinPercentLoss: 0 },
    materialLoss: { count: 0, totalWinPercentLoss: 0 },
    kingSafety: { count: 0, totalWinPercentLoss: 0 },
    promotion: { count: 0, totalWinPercentLoss: 0 },
  };
  const criticalMoments = [];

  for (let index = 0; index < moves.length; index += 1) {
    const move = moves[index];
    if (move.color !== moveColor) continue;
    const before = analysis.positions[index];
    const after = analysis.positions[index + 1];
    const loss = winPercentLossForMove(move, before, after);
    if (loss < 10) continue;
    const bestBefore = bestMoveTraits(before);
    const bestAfter = bestMoveTraits(after);
    const matchedMotifs = [];

    if (bestBefore?.check) matchedMotifs.push('missedCheck');
    if (bestBefore?.capture) matchedMotifs.push('missedCapture');
    if (centipawnLossForMove(move, before, after) >= 150) matchedMotifs.push('materialLoss');
    if (loss >= 20 && bestAfter?.check) matchedMotifs.push('kingSafety');
    if (bestBefore?.promotion) matchedMotifs.push('promotion');

    for (const motif of matchedMotifs) {
      motifs[motif].count += 1;
      motifs[motif].totalWinPercentLoss += loss;
    }
    criticalMoments.push({
      ply: index + 1,
      san: move.san,
      winPercentLoss: loss,
      phase: phaseForPosition(before.fen),
      bestMove: before.bestMove ?? null,
      motif: matchedMotifs[0] ?? 'other',
    });
  }

  return {
    motifs,
    criticalMoments: criticalMoments
      .sort((first, second) => second.winPercentLoss - first.winPercentLoss)
      .slice(0, 3),
  };
}

function hasDoubledPawns(fen, color) {
  const files = Array(8).fill(0);
  let file = 0;
  for (const character of fen.split(' ')[0]) {
    if (character === '/') {
      file = 0;
    } else if (/\d/.test(character)) {
      file += Number(character);
    } else {
      const isPawn = color === 'white' ? character === 'P' : character === 'p';
      if (isPawn) files[file] += 1;
      file += 1;
    }
  }
  return files.some((count) => count > 1);
}

function centerType(fen) {
  const chess = new Chess(fen);
  const centralPawns = ['d4', 'e4', 'd5', 'e5']
    .map((square) => chess.get(square))
    .filter((piece) => piece?.type === 'p');
  const locked = (
    chess.get('d4')?.type === 'p' && chess.get('d4')?.color === 'w'
    && chess.get('d5')?.type === 'p' && chess.get('d5')?.color === 'b'
  ) || (
    chess.get('e4')?.type === 'p' && chess.get('e4')?.color === 'w'
    && chess.get('e5')?.type === 'p' && chess.get('e5')?.color === 'b'
  );
  if (locked) return 'closed';
  if (centralPawns.length <= 1) return 'open';
  return 'mixed';
}

function positionalForColor(analysis, moves, color) {
  const moveColor = color === 'white' ? 'w' : 'b';
  const earlyQueenMoves = moves.slice(0, 20)
    .filter((move) => move.color === moveColor && move.piece === 'q').length;
  const developedPosition = new Chess(analysis.positions[Math.min(20, moves.length)].fen);
  const startingSquares = color === 'white'
    ? [['b1', 'n'], ['g1', 'n'], ['c1', 'b'], ['f1', 'b']]
    : [['b8', 'n'], ['g8', 'n'], ['c8', 'b'], ['f8', 'b']];
  const undevelopedPiecesAt10 = startingSquares.filter(([square, type]) => {
    const piece = developedPosition.get(square);
    return piece?.type === type && piece.color === moveColor;
  }).length;
  const reachedMove15 = moves.length >= 29;
  const castledBy15 = moves.slice(0, 30)
    .some((move) => move.color === moveColor && move.san.startsWith('O-O'));
  const doubledPawnMetrics = emptyMetrics();

  for (let index = 0; index < moves.length; index += 1) {
    const move = moves[index];
    if (move.color !== moveColor || !hasDoubledPawns(analysis.positions[index].fen, color)) continue;
    addMove(
      doubledPawnMetrics,
      { ...move, ply: index + 1 },
      analysis.positions[index],
      analysis.positions[index + 1],
    );
  }

  return {
    earlyQueenMoves,
    undevelopedPiecesAt10,
    uncastledAt15: reachedMove15 ? !castledBy15 : null,
    doubledPawnMetrics,
    centerType: centerType(analysis.positions[Math.min(24, moves.length)].fen),
  };
}

function endgameType(fen) {
  const board = fen.split(' ')[0].toLowerCase();
  const queens = [...board].filter((piece) => piece === 'q').length;
  const rooks = [...board].filter((piece) => piece === 'r').length;
  const minors = [...board].filter((piece) => piece === 'b' || piece === 'n').length;
  if (queens > 0) return 'queen';
  if (rooks > 0 && minors === 0) return 'rook';
  if (rooks === 0 && minors > 0) return 'minor';
  if (rooks === 0 && minors === 0) return 'pawn';
  return 'mixed';
}

function endgameForColor(analysis, color) {
  const index = analysis.positions.findIndex((position) => phaseForPosition(position.fen) === 'endgame');
  if (index < 0) return { type: null, startWinPercent: null, startPly: null };
  return {
    type: endgameType(analysis.positions[index].fen),
    startWinPercent: winPercentFor(analysis.positions[index].evaluation, color),
    startPly: index,
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
      const commentsByFen = new Map(
        chess.getComments().map(({ fen, comment }) => [fen, comment]),
      );
      const clocks = moves.map((move) => clockFromComment(commentsByFen.get(move.after)));
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
      const whiteAdvantage = advantageForColor(analysis, moves, 'white');
      const blackAdvantage = advantageForColor(analysis, moves, 'black');
      const whiteDefense = defenseForColor(analysis, moves, 'white');
      const blackDefense = defenseForColor(analysis, moves, 'black');
      const whiteTime = timeForColor(analysis, moves, clocks, source.tags, 'white');
      const blackTime = timeForColor(analysis, moves, clocks, source.tags, 'black');
      const whiteOpening = openingForColor(analysis, moves, 'white');
      const blackOpening = openingForColor(analysis, moves, 'black');
      const whiteTactical = tacticalForColor(analysis, moves, 'white');
      const blackTactical = tacticalForColor(analysis, moves, 'black');
      const whitePositional = positionalForColor(analysis, moves, 'white');
      const blackPositional = positionalForColor(analysis, moves, 'black');
      const whiteEndgame = endgameForColor(analysis, 'white');
      const blackEndgame = endgameForColor(analysis, 'black');

      statistics.push({
        gameId: entry.gameId,
        playedAt: playedAt(source.tags),
        speed: speed(source.tags),
        result: source.tags.Result,
        white: source.tags.White,
        black: source.tags.Black,
        whiteRating: rating(source.tags.WhiteElo),
        blackRating: rating(source.tags.BlackElo),
        rated: (source.tags.Event ?? '').toLowerCase().includes('rated'),
        termination: source.tags.Termination ?? null,
        sessionGameNumber: 1,
        previousGameId: null,
        metrics: { white, black },
        phaseMetrics: { white: whitePhases, black: blackPhases },
        queenlessMetrics: { white: whiteQueenless, black: blackQueenless },
        openingExitWinPercent: openingExitPosition ? {
          white: winPercentFor(openingExitPosition.evaluation, 'white'),
          black: winPercentFor(openingExitPosition.evaluation, 'black'),
        } : { white: null, black: null },
        advantage: { white: whiteAdvantage, black: blackAdvantage },
        defense: { white: whiteDefense, black: blackDefense },
        time: { white: whiteTime, black: blackTime },
        opening: { white: whiteOpening, black: blackOpening },
        tactical: { white: whiteTactical, black: blackTactical },
        positional: { white: whitePositional, black: blackPositional },
        endgame: { white: whiteEndgame, black: blackEndgame },
      });
    } catch (error) {
      failures.push(`${entry.gameId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const chronological = [...statistics].sort((first, second) => first.playedAt - second.playedAt);
  let previousGame = null;
  let sessionGameNumber = 0;
  for (const game of chronological) {
    const continuesSession = previousGame !== null
      && game.playedAt - previousGame.playedAt <= 30 * 60 * 1_000;
    sessionGameNumber = continuesSession ? sessionGameNumber + 1 : 1;
    game.sessionGameNumber = sessionGameNumber;
    game.previousGameId = continuesSession ? previousGame.gameId : null;
    previousGame = game;
  }

  const temporaryFile = join(analysisRoot, `.${randomUUID()}.statistics.json.tmp`);
  await writeFile(temporaryFile, `${JSON.stringify({
    schemaVersion: 5,
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
