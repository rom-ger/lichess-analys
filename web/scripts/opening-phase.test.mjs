import assert from 'node:assert/strict';
import test from 'node:test';
import { Chess } from 'chess.js';
import { openingPhaseBeforeMoves } from './opening-phase.mjs';

function history(san) {
  const chess = new Chess();
  for (const move of san.split(' ').filter(Boolean)) chess.move(move);
  return chess.history({ verbose: true });
}

// Probe a later move number without filling the fixture with waiting moves.
function probe(moves, number) {
  const fen = moves.at(-1)?.after ?? new Chess().fen();
  const before = fen.replace(/\d+$/, String(number));
  const move = new Chess(before).moves({ verbose: true })[0];
  return [...moves, move];
}

const developed = history('e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Bc5 O-O O-O Nc3 d6');

test('10th move is still opening; both developed sides end it before move 11', () => {
  assert.equal(openingPhaseBeforeMoves(probe(developed, 10), () => false).at(-1), true);
  assert.equal(openingPhaseBeforeMoves(probe(developed, 11), () => false).at(-1), false);
});

test('incomplete development keeps move 15 but never move 16', () => {
  const moves = history('e4 e5');
  assert.equal(openingPhaseBeforeMoves(probe(moves, 15), () => false).at(-1), true);
  assert.equal(openingPhaseBeforeMoves(probe(moves, 16), () => false).at(-1), false);
});

test('castling rights are not a completed castling move', () => {
  const moves = history('e4 e5 Nf3 Nc6 Bc4 Nf6 Nc3 Bc5');
  assert.equal(openingPhaseBeforeMoves(probe(moves, 11), () => false).at(-1), true);
});

test('repeated moves of one minor do not develop the other minors', () => {
  const moves = history('e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Bc5 O-O O-O Ng5 d6 Nf3 a6');
  assert.equal(openingPhaseBeforeMoves(probe(moves, 11), () => false).at(-1), true);
});

test('returning a developed knight to its starting square does not reopen the opening', () => {
  const moves = history('e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Bc5 O-O O-O Nc3 d6 Nb1 a6');
  assert.equal(openingPhaseBeforeMoves(probe(moves, 11), () => false).at(-1), false);
});

test('capturing an undeveloped original minor counts as an exchange', () => {
  const moves = history('e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Bc5 O-O O-O');
  // Only the move fields consumed by the tracker are relevant to this capture fixture.
  const capture = { before: moves.at(-1).after, after: moves.at(-1).after,
    color: 'b', from: 'c5', to: 'b1', captured: 'n', flags: 'c' };
  assert.equal(openingPhaseBeforeMoves(probe([...moves, capture], 11), () => false).at(-1), false);
});

test('the move that completes development is classified by the position before it', () => {
  const moves = history('e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Bc5 O-O O-O');
  const before = moves.at(-1).after.replace(/\d+$/, '11');
  const chess = new Chess(before);
  const lastDevelopment = chess.move('Nc3');
  const reply = chess.move('d6');
  const phases = openingPhaseBeforeMoves([...moves, lastDevelopment, reply], () => false);
  assert.deepEqual(phases.slice(-2), [true, false]);
});

test('a move leading to an endgame is included, but positions from that point are not', () => {
  const moves = history('e4 e5 Nf3 Nc6');
  const phases = openingPhaseBeforeMoves(moves, (fen) => fen === moves[1].before);
  assert.deepEqual(phases, [true, false, false, false]);
});

test('empty history is supported', () => {
  assert.deepEqual(openingPhaseBeforeMoves([], () => false), []);
});
