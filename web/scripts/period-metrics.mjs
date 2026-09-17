import { Chess } from 'chess.js';

export const SUMMARY_RULES = {
  seriousLoss: 150,
  goodOpening: 50,
  advantage: 200,
  retainedAdvantage: 100,
  equalPosition: 50,
  lostEquality: -100,
  accurateReply: 50,
  missedReply: 100,
  playableMin: -200,
  playableMax: 500,
};

function centipawns(evaluation) {
  return evaluation.kind === 'mate'
    ? Math.sign(evaluation.value || -1) * (100_000 - Math.min(99, Math.abs(evaluation.value)) * 100)
    : evaluation.value;
}

// Mate distances are not centipawn losses. Keep a won mate won, and bound
// the weight of a single catastrophic move when ranking training topics.
function bounded(value) { return Math.max(-1_000, Math.min(1_000, value)); }
function loss(before, after) { return Math.max(0, bounded(before) - bounded(after)); }
function evaluationLabel(value) {
  if (Math.abs(value) >= 90_000) {
    return `${value > 0 ? '+' : '−'}M${Math.max(1, Math.round((100_000 - Math.abs(value)) / 100))}`;
  }
  return `${value > 0 ? '+' : ''}${(value / 100).toFixed(2)}`;
}

function bestSan(position) {
  const match = position.bestMove?.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
  if (!match) return null;
  try {
    return new Chess(position.fen).move({ from: match[1], to: match[2], promotion: match[3] }).san;
  } catch { return null; }
}

/** Validate the full analysis against the PGN before using it as evidence. */
export function validateSummaryAnalysis(analysis, moves, gameId, engine) {
  if (analysis.schemaVersion !== 1 || analysis.gameId !== gameId
    || analysis.engine?.name !== 'Stockfish'
    || analysis.engine?.version !== engine.version || analysis.engine?.depth !== engine.depth
    || !Array.isArray(analysis.positions) || analysis.positions.length !== moves.length + 1) {
    throw new Error('анализ не соответствует партии или версии движка');
  }
  for (const [ply, position] of analysis.positions.entries()) {
    const expectedFen = ply === moves.length ? moves.at(-1)?.after : moves[ply].before;
    if (position.ply !== ply || (expectedFen && position.fen !== expectedFen)
      || !['centipawns', 'mate'].includes(position.evaluation?.kind)
      || !Number.isFinite(position.evaluation.value)) {
      throw new Error(`некорректная позиция анализа: ${ply}`);
    }
  }
}

/** All phase labels describe the position BEFORE the move. */
export function buildPeriodMetrics(analysis, moves, openingPositions, endgameTypes, result, lostOpening) {
  return Object.fromEntries(['white', 'black'].map((color) => {
    const moveColor = color === 'white' ? 'w' : 'b';
    const sign = color === 'white' ? 1 : -1;
    const values = analysis.positions.map(({ evaluation }) => centipawns(evaluation) * sign);
    const own = moves.flatMap((move, index) => move.color === moveColor ? [index] : []);
    const won = result === (color === 'white' ? '1-0' : '0-1');
    const metrics = {};
    const metric = (id) => (metrics[id] ??= {
      opportunities: 0, successes: 0, failures: 0, impact: 0, positive: [], negative: [],
    });
    const example = (index, evidence) => ({
      ply: index + 1,
      fen: analysis.positions[index].fen,
      moveNumber: Number(analysis.positions[index].fen.split(' ')[5]),
      playedMove: moves[index].san,
      bestMove: bestSan(analysis.positions[index]),
      beforeEvaluation: values[index],
      afterEvaluation: values[index + 1],
      evidence,
    });
    const record = (id, index, good, bad, evidence, severity = loss(values[index], values[index + 1])) => {
      const sample = metric(id);
      sample.opportunities += 1;
      if (good) sample.successes += 1;
      if (bad) { sample.failures += 1; sample.impact += Math.min(500, severity); }
      const examples = good ? sample.positive : bad ? sample.negative : null;
      if (examples && examples.length < 1) examples.push(example(index, evidence));
    };

    for (const index of own) {
      const before = values[index];
      const after = values[index + 1];
      const drop = loss(before, after);
      if (before >= SUMMARY_RULES.playableMin && before <= SUMMARY_RULES.playableMax) {
        const phase = openingPositions[index] ? 'opening' : endgameTypes[index] ? 'endgame' : 'middlegame';
        const bad = drop >= SUMMARY_RULES.seriousLoss;
        record(`phase:${phase}`, index, false, bad, 'На этом ходу оценка ухудшилась минимум на 1.50 пешки.');
      }

      // Only responses to a real opponent move count as an opportunity.
      if (index > 0 && moves[index - 1].color !== moveColor
        && loss(values[index], values[index - 1]) >= SUMMARY_RULES.seriousLoss
        && before >= -SUMMARY_RULES.equalPosition && before <= SUMMARY_RULES.playableMax) {
        const good = drop <= SUMMARY_RULES.accurateReply;
        const bad = drop >= SUMMARY_RULES.missedReply;
        record('punish', index, good, bad, good
          ? 'После ошибки соперника ответ сохранил оценку с потерей не более 0.50.'
          : 'После ошибки соперника ответ отдал минимум 1.00 пешки полученной оценки.');
      }
    }

    // Short games ending within the opening are not a completed opening exit.
    const exit = openingPositions.findIndex((inOpening) => !inOpening);
    if (exit > 0) {
      const last = own.filter((index) => index < exit).at(-1);
      if (last !== undefined) {
        const good = values[exit] >= SUMMARY_RULES.goodOpening;
        const bad = values[exit] < -SUMMARY_RULES.equalPosition;
        record('opening', last, good, bad,
          `При переходе к следующей стадии оценка за вас: ${evaluationLabel(values[exit])}. Показан ваш последний дебютный ход.`,
          Math.max(0, -bounded(values[exit])));
      }
    }

    const advantage = own.find((index) => values[index] >= SUMMARY_RULES.advantage);
    if (advantage !== undefined) {
      const dropped = own.find((index) => index >= advantage
        && values[index] >= SUMMARY_RULES.retainedAdvantage
        && values[index + 1] < SUMMARY_RULES.retainedAdvantage);
      // A win alone is not evidence of clean conversion (e.g. a win on time
      // after giving the advantage away). Check every subsequent position.
      const kept = values.slice(advantage).every((value) => value >= SUMMARY_RULES.retainedAdvantage);
      record('conversion', dropped ?? advantage, won && kept, dropped !== undefined,
        dropped !== undefined
          ? 'После полученного преимущества от +2.00 этот ход снизил оценку ниже +1.00.'
          : 'С позиции от +2.00 преимущество оставалось не ниже +1.00 до победы.');
    }

    const equalEndgame = own.find((index) => endgameTypes[index]
      && Math.abs(values[index]) <= SUMMARY_RULES.equalPosition);
    if (equalEndgame !== undefined) {
      const remaining = own.filter((index) => index >= equalEndgame);
      const dropped = remaining.find((index) => values[index] >= SUMMARY_RULES.lostEquality
        && values[index + 1] < SUMMARY_RULES.lostEquality);
      const held = remaining.length >= 5 && result !== (color === 'white' ? '0-1' : '1-0')
        && values.slice(equalEndgame).every((value) => value >= SUMMARY_RULES.lostEquality);
      record('hold', dropped ?? equalEndgame, held, dropped !== undefined,
        dropped !== undefined
          ? 'После равной эндшпильной позиции этот ход снизил оценку ниже −1.00.'
          : 'После равной позиции сыграно минимум 5 ваших ходов, оценка не опускалась ниже −1.00, партия не проиграна.');
    }

    // Each endgame type contributes at most one opportunity per game.
    for (const type of new Set(own.map((index) => endgameTypes[index]).filter(Boolean))) {
      const eligible = own.filter((index) => endgameTypes[index] === type
        && values[index] >= SUMMARY_RULES.playableMin && values[index] <= SUMMARY_RULES.playableMax);
      if (!eligible.length) continue;
      const worst = eligible.reduce((a, b) => loss(values[a], values[a + 1]) >= loss(values[b], values[b + 1]) ? a : b);
      record(`ending:${type}`, worst, false, loss(values[worst], values[worst + 1]) >= SUMMARY_RULES.seriousLoss,
        'В этом типе окончания допущен ход с потерей оценки от 1.50 пешки.');
    }

    if (own.some((index) => openingPositions[index])) {
      for (const type of ['material', 'king-safety', 'development', 'pawn-structure', 'other']) {
        const error = lostOpening[color];
        const theme = error?.themes.find((item) => item.type === type);
        record(`theme:${type}`, theme ? error.ply - 1 : own[0], false, Boolean(theme),
          theme?.evidence ?? '', theme ? error.evaluationLoss : 0);
      }
    }

    return [color, { metrics }];
  }));
}
