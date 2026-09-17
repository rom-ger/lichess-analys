import assert from 'node:assert/strict';
import test from 'node:test';
import { Chess } from 'chess.js';
import { classifyOpeningError } from './opening-error-themes.mjs';

function fixture({ fen, san, best, pv = [], evaluation = { kind: 'centipawns', value: -200 } }) {
  const chess = new Chess(fen);
  const moves = san.split(' ').map((move) => chess.move(move));
  const index = moves.length - 1;
  const positions = moves.map((move) => ({ fen: move.before, bestMove: best }));
  positions.push({ fen: chess.fen(), pv, evaluation });
  return classifyOpeningError({ positions }, moves, index);
}

const whiteMaterial = 'r3k3/8/8/8/8/8/7P/R3K3 w Q - 0 1';
const blackMaterial = 'r3k3/7p/8/8/8/8/8/R3K3 b q - 0 1';
const types = (themes) => themes.map((theme) => theme.type);

test('material loss is measured from the player perspective after a reply', () => {
  const themes = fixture({ fen: whiteMaterial, san: 'h3', best: 'a1a2', pv: ['a8a1', 'e1d2'] });
  assert.deepEqual(types(themes), ['material']);
  assert.match(themes[0].evidence, /на 5 пешек/);
  assert.deepEqual(themes[0].lineSan, ['Rxa1+', 'Kd2']);
  assert.deepEqual(types(fixture({ fen: blackMaterial, san: 'h6', best: 'a8a7', pv: ['a1a8', 'e8d7'] })), ['material']);
});

test('recapture in an equal exchange does not imply a material loss', () => {
  assert.deepEqual(types(fixture({
    fen: 'r3k3/8/8/8/8/8/7P/R2QK3 w Q - 0 1', san: 'h3', best: 'a1a2', pv: ['a8a1', 'd1a1'],
  })), ['other']);
});

test('a truncated exchange or invalid saved line is not classified as material loss', () => {
  for (const pv of [[], ['a8a1'], ['a8a1', 'e1e8']]) {
    assert.deepEqual(types(fixture({ fen: whiteMaterial, san: 'h3', best: 'a1a2', pv })), ['other']);
  }
});

test('one error can have both material and king-safety signals', () => {
  const themes = fixture({ fen: whiteMaterial, san: 'h3', best: 'a1a2', pv: ['a8a1', 'e1d2', 'a1a2', 'd2c3'] });
  assert.deepEqual(types(themes), ['material', 'king-safety']);
  assert.match(themes[1].evidence, /2 шаха/);
});

test('mate scores use white perspective for either player', () => {
  for (const [fen, san, losingSign] of [[whiteMaterial, 'h3', -1], [blackMaterial, 'h6', 1]]) {
    assert.deepEqual(types(fixture({ fen, san, evaluation: { kind: 'mate', value: losingSign * 3 } })), ['king-safety']);
    assert.deepEqual(types(fixture({ fen, san, evaluation: { kind: 'mate', value: -losingSign * 3 } })), ['other']);
  }
});

test('development signal requires both lag and an ignored development recommendation', () => {
  const options = { san: 'e4 e5 d3 Nf6 a3', best: 'g1f3' };
  assert.deepEqual(types(fixture(options)), ['development']);
  assert.deepEqual(types(fixture({ ...options, best: 'a2a3' })), ['other']);
  assert.deepEqual(types(fixture({ san: 'e4 e5 d3 d6 a3', best: 'g1f3' })), ['other']);
  assert.deepEqual(types(fixture({ san: 'e4 e5 d3 Nf6 Nc3', best: 'g1f3' })), ['other']);
});

test('pawn weaknesses must increase and be avoided by the recommendation', () => {
  const options = { fen: '4k3/8/8/8/8/2p5/PPP5/4K3 w - - 0 1', san: 'bxc3', best: 'b2b3' };
  const themes = fixture(options);
  assert.deepEqual(types(themes), ['pawn-structure']);
  assert.match(themes[0].evidence, /изолированных пешек/);
  assert.match(themes[0].evidence, /одной вертикали/);
  assert.deepEqual(types(fixture({ ...options, best: 'b2c3' })), ['other']);
});
