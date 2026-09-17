import assert from 'node:assert/strict';
import test from 'node:test';
import { Chess } from 'chess.js';
import { buildPeriodMetrics, validateSummaryAnalysis } from './period-metrics.mjs';
import { compareMetric, previousPeriod, summarizePeriod, summaryConfidence, rateInterval } from '../lib/period-summary.ts';

const engine = { name: 'Stockfish', version: '18-lite', depth: 18 };
const san = 'e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Bc5 O-O O-O Nc3 d6 Bg5 h6 Bh4 g5';
function fixture(values = [], { openingEnd = 6, endingStart = 10, result = '1-0' } = {}) {
  const chess = new Chess();
  for (const move of san.split(' ')) chess.move(move);
  const moves = chess.history({ verbose: true });
  const positions = [moves[0].before, ...moves.map((move) => move.after)].map((fen, ply) => ({
    ply, fen, evaluation: typeof values[ply] === 'object' ? values[ply] : { kind: 'centipawns', value: values[ply] ?? 0 },
    bestMove: null,
  }));
  const analysis = { schemaVersion: 1, gameId: 'game', engine, positions };
  const opening = moves.map((_, index) => index < openingEnd);
  const endings = moves.map((_, index) => index >= endingStart ? 'rook-one-each' : null);
  const metrics = buildPeriodMetrics(analysis, moves, opening, endings, result, { white: null, black: null });
  return { analysis, moves, metrics, opening, endings };
}

test('errors are attributed to the mover, with evaluations from their side', () => {
  const values = Array(17).fill(-170); values[0] = 0; values[1] = 0; values[2] = 30;
  const { metrics } = fixture(values);
  assert.equal(metrics.white.metrics['phase:opening'].failures, 1);
  assert.equal(metrics.black.metrics['phase:opening'].failures, 0);
  assert.equal(metrics.white.metrics['phase:opening'].negative[0].ply, 3);
  assert.equal(metrics.white.metrics['phase:opening'].negative[0].afterEvaluation, -170);
});

test('a phase uses the position before the move; endgame denominator counts games once', () => {
  const values = Array(17).fill(0); values[7] = -200;
  const { metrics } = fixture(values);
  assert.equal(metrics.white.metrics['phase:opening'].failures, 0);
  assert.equal(metrics.white.metrics['phase:middlegame'].failures, 1);
  assert.equal(metrics.white.metrics['ending:rook-one-each'].opportunities, 1);
  assert.equal(metrics.white.metrics['phase:endgame'].opportunities, 3);
});

test('short games do not establish successful opening exits', () => {
  const { metrics } = fixture(Array(17).fill(70), { openingEnd: 99 });
  assert.equal(metrics.white.metrics.opening, undefined);
  const full = fixture(Array(17).fill(70));
  assert.equal(full.metrics.white.metrics.opening.successes, 1);
  assert.equal(full.metrics.black.metrics.opening.failures, 1);
});

test('win after losing and regaining advantage is not clean conversion', () => {
  const values = Array(17).fill(300); values[3] = 0;
  const { metrics } = fixture(values);
  assert.equal(metrics.white.metrics.conversion.opportunities, 1);
  assert.equal(metrics.white.metrics.conversion.successes, 0);
  assert.equal(metrics.white.metrics.conversion.failures, 1);
  assert.equal(metrics.white.metrics.conversion.negative[0].ply, 3);
  assert.equal(fixture(Array(17).fill(300)).metrics.white.metrics.conversion.successes, 1);
  assert.equal(fixture(Array(17).fill(300), { result: '0-1' }).metrics.white.metrics.conversion.successes, 0);
});

test('only an actual reply to an opponent error counts, not all accurate moves', () => {
  const values = Array(17).fill(180); values[0] = 0; values[1] = 0; values[2] = 200;
  const { metrics } = fixture(values);
  assert.equal(metrics.white.metrics.punish.opportunities, 1);
  assert.equal(metrics.white.metrics.punish.successes, 1);
  assert.equal(metrics.white.metrics.punish.positive[0].ply, 3);
  assert.equal(fixture().metrics.white.metrics.punish, undefined);
  const hopeless = Array(17).fill(-500); hopeless[1] = -800;
  assert.equal(fixture(hopeless).metrics.white.metrics.punish, undefined);
});

test('missed replies and accurate replies have separate thresholds', () => {
  const values = Array(17).fill(100); values[0] = 0; values[1] = 0; values[2] = 200;
  const sample = fixture(values).metrics.white.metrics.punish;
  assert.equal(sample.failures, 1);
  assert.equal(sample.successes, 0);
  values[3] = 130;
  const neutral = fixture(values).metrics.white.metrics.punish;
  assert.equal(neutral.failures, 0);
  assert.equal(neutral.successes, 0);
});

test('mate distance changes do not create fictitious opportunities', () => {
  const values = Array.from({ length: 17 }, (_, index) => ({ kind: 'mate', value: index % 2 ? 15 : 2 }));
  const { metrics } = fixture(values);
  assert.equal(metrics.white.metrics.punish, undefined);
  assert.equal(metrics.black.metrics.punish, undefined);
  assert.equal(metrics.white.metrics.conversion.failures, 0);
  assert.match(metrics.white.metrics.opening.positive[0].evidence, /\+M2/);
});

test('black replies and best move examples use the black perspective', () => {
  const values = Array(17).fill(-200); values[0] = 0;
  const f = fixture(values, { result: '0-1' });
  f.analysis.positions[1].bestMove = 'e7e5';
  const metrics = buildPeriodMetrics(f.analysis, f.moves, f.opening, f.endings, '0-1', { white: null, black: null });
  const reply = metrics.black.metrics.punish;
  assert.equal(reply.successes, 1);
  assert.equal(reply.positive[0].ply, 2);
  assert.equal(reply.positive[0].beforeEvaluation, 200);
  assert.equal(reply.positive[0].bestMove, 'e5');
});

test('one decisive opening can support several themes with one game opportunity each', () => {
  const f = fixture();
  const metrics = buildPeriodMetrics(f.analysis, f.moves, f.opening, f.endings, '1-0', {
    white: { ply: 3, evaluationLoss: 250, themes: [{ type: 'material', evidence: 'Lost a piece' }, { type: 'king-safety', evidence: 'King exposed' }] },
    black: null,
  });
  for (const id of ['theme:material', 'theme:king-safety']) {
    assert.equal(metrics.white.metrics[id].opportunities, 1);
    assert.equal(metrics.white.metrics[id].failures, 1);
    assert.equal(metrics.white.metrics[id].negative[0].ply, 3);
  }
  assert.equal(metrics.white.metrics['theme:development'].failures, 0);
  assert.equal(metrics.black.metrics['theme:material'].failures, 0);
});

test('holding an equal ending requires actual play and a non-losing outcome', () => {
  const short = fixture([], { endingStart: 10 });
  assert.equal(short.metrics.white.metrics.hold.successes, 0);
  const held = fixture([], { endingStart: 4, result: '1/2-1/2' });
  assert.equal(held.metrics.white.metrics.hold.successes, 1);
  assert.equal(fixture([], { endingStart: 4, result: '0-1' }).metrics.white.metrics.hold.successes, 0);
  const values = Array(17).fill(0); values[7] = -150;
  assert.equal(fixture(values, { endingStart: 4 }).metrics.white.metrics.hold.failures, 1);
});

test('endgame weaknesses use only encountered types and relevant positions', () => {
  const { metrics } = fixture(Array(17).fill(-700));
  assert.equal(metrics.white.metrics['ending:rook-one-each'], undefined);
  assert.equal(metrics.white.metrics['ending:knight'], undefined);
});

test('stale analysis is rejected for mismatched FEN, id, depth or evaluation', () => {
  const { analysis, moves } = fixture();
  assert.doesNotThrow(() => validateSummaryAnalysis(analysis, moves, 'game', engine));
  for (const mutate of [
    (copy) => { copy.gameId = 'another'; },
    (copy) => { copy.positions[2].fen = copy.positions[1].fen; },
    (copy) => { copy.engine.depth = 14; },
    (copy) => { copy.positions[3].evaluation.value = NaN; },
    (copy) => { copy.positions.pop(); },
  ]) {
    const copy = structuredClone(analysis); mutate(copy);
    assert.throws(() => validateSummaryAnalysis(copy, moves, 'game', engine));
  }
});

function sample({ opportunities = 1, successes = 0, failures = 0, impact = failures * 200 } = {}) {
  const position = { ply: 3, fen: new Chess().fen(), moveNumber: 2, playedMove: 'Nf3', bestMove: 'Nf3', beforeEvaluation: 0, afterEvaluation: -200, evidence: 'Test evidence' };
  return { opportunities, successes, failures, impact, positive: successes ? [position] : [], negative: failures ? [position] : [] };
}

function dataset(count, { metrics = { conversion: sample({ successes: 1 }) }, start = 100, control = '180+0', speed = 'blitz', result = 'win' } = {}) {
  const source = Array.from({ length: count }, (_, index) => ({ gameId: `${start}-${index}`, playedAt: start + index, speed, result, timeControl: control }));
  const games = source.map((item) => ({ gameId: item.gameId, playedAt: item.playedAt, speed, result: '1-0', white: 'Player', black: 'Opponent', lostOpening: { white: null, black: null }, decisiveEndgame: { white: null, black: null }, periodMetrics: { white: { metrics }, black: { metrics: {} } } }));
  return { source, games };
}

test('selection uses the PGN inventory, deduplicates and reports incomplete coverage', () => {
  const { games, source } = dataset(20);
  const report = summarizePeriod([...games.slice(0, 10), { ...games[0], gameId: 'stale' }], [...source, source[0]], 'PLAYER', { from: 100, to: 120, speed: 'blitz', result: 'win' });
  assert.equal(report.selected, 20);
  assert.equal(report.analyzed, 10);
  assert.equal(report.coverage, 0.5);
  assert.equal(report.metrics[0].successes, 10);
  assert.equal(summaryConfidence(100, report.coverage), 'Предварительно: анализ неполный');
  assert.equal(summarizePeriod(games, source, 'stranger', {}).analyzed, 0);
});

test('filters include the lower boundary and exclude the upper, and retain result and speed', () => {
  const { games, source } = dataset(5);
  const report = summarizePeriod(games, source, 'Player', { from: 101, to: 103 });
  assert.equal(report.selected, 2);
  assert.equal(summarizePeriod(games, source, 'Player', { speed: 'rapid' }).selected, 0);
  assert.equal(summarizePeriod(games, source, 'Player', { result: 'loss' }).selected, 0);
});

test('no successes are invented from absence of failures or missing analysis', () => {
  const data = dataset(30, { metrics: { 'phase:middlegame': sample({ opportunities: 20 }) } });
  assert.equal(summarizePeriod(data.games, data.source, 'Player', {}).strengths.length, 0);
  assert.equal(summarizePeriod([], data.source, 'Player', {}).metrics.length, 0);
  const small = dataset(9);
  assert.equal(summarizePeriod(small.games, small.source, 'Player', {}).strengths.length, 0);
  const repeated = dataset(10);
  assert.equal(summarizePeriod(repeated.games, repeated.source, 'Player', {}).strengths.length, 1);
});

test('a weakness needs three distinct games, not three errors in one game', () => {
  const data = dataset(1, { metrics: { 'phase:middlegame': sample({ opportunities: 30, failures: 10 }) } });
  assert.equal(summarizePeriod(data.games, data.source, 'Player', {}).weaknesses.length, 0);
  const repeated = dataset(3, { metrics: { 'phase:middlegame': sample({ opportunities: 20, failures: 1 }) } });
  const report = summarizePeriod(repeated.games, repeated.source, 'Player', {});
  assert.equal(report.priorities.length, 1);
  assert.equal(report.priorities[0].negative.length, 3);
});

test('priorities prefer specific themes and avoid repeating the same evidence', () => {
  const data = dataset(5, { metrics: {
    'theme:material': sample({ failures: 1 }),
    'phase:opening': sample({ opportunities: 10, failures: 1 }),
    opening: sample({ failures: 1 }),
  } });
  const report = summarizePeriod(data.games, data.source, 'Player', {});
  assert.equal(report.priorities.length, 1);
  assert.equal(report.priorities[0].id, 'theme:material');
});

test('previous periods are equally long, adjacent, and preserve filters', () => {
  assert.deepEqual(previousPeriod({ from: 100, to: 200, speed: 'blitz', result: 'loss' }), { from: 0, to: 100, speed: 'blitz', result: 'loss' });
  for (const filters of [{}, { from: 100 }, { from: 100, to: 100 }, { from: 200, to: 100 }]) assert.equal(previousPeriod(filters), null);
});

test('comparisons separate exact controls even within blitz', () => {
  const old = dataset(20, { start: 0, control: '180+0' });
  const current = dataset(20, { start: 100, control: '300+3' });
  const report = summarizePeriod([...old.games, ...current.games], [...old.source, ...current.source], 'Player', { from: 100, to: 200 });
  assert.equal(report.comparisons.length, 1);
  assert.equal(report.comparisons[0].previous.analyzed, 0);
  assert.equal(report.comparisons[0].current.analyzed, 20);
});

test('uncertainty and trend direction respect sample sizes and outcome meaning', () => {
  function metric(n, successes, failures = 0) {
    const data = dataset(n, { metrics: { conversion: sample() } });
    for (let index = 0; index < n; index += 1) data.games[index].periodMetrics.white.metrics = { conversion: sample({ successes: index < successes ? 1 : 0, failures: index < failures ? 1 : 0 }) };
    return summarizePeriod(data.games, data.source, 'Player', {}).metrics[0];
  }
  assert.equal(compareMetric(metric(10, 10), metric(10, 0), 1, 'successes').direction, 'uncertain');
  assert.equal(compareMetric(metric(100, 90), metric(100, 20), 1, 'successes').direction, 'better');
  assert.equal(compareMetric(metric(100, 90), metric(100, 20), 0.5, 'successes').direction, 'uncertain');
  assert.equal(compareMetric(metric(100, 0, 10), metric(100, 0, 80), 1).direction, 'better');
  assert.equal(compareMetric(metric(100, 51), metric(100, 50), 1, 'successes').direction, 'uncertain');
  assert.ok(rateInterval(0, 20)[1] > 0);
  assert.ok(rateInterval(20, 20)[0] < 1);
});
