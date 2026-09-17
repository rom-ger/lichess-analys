import { Chess } from 'chess.js';

export const OPENING_RULES = {
  earlyFullMoves: 10,
  maxFullMoves: 15,
  developedMinors: 3,
};

// Record development once: returning a piece to its home square does not
// restart the opening. A captured original minor also counts as resolved.
export function developmentBeforeMoves(moves) {
  if (moves.length === 0) return [];
  const initial = new Chess(moves[0].before);
  const undeveloped = {
    w: new Set(['b1', 'c1', 'f1', 'g1']),
    b: new Set(['b8', 'c8', 'f8', 'g8']),
  };
  for (const color of ['w', 'b']) {
    for (const square of undeveloped[color]) {
      const piece = initial.get(square);
      const expectedType = square[0] === 'b' || square[0] === 'g' ? 'n' : 'b';
      if (piece?.color !== color || piece.type !== expectedType) {
        undeveloped[color].delete(square);
      }
    }
  }
  const castled = { w: false, b: false };
  return moves.map((move) => {
    const state = Object.fromEntries(['w', 'b'].map((color) => [color, {
      castled: castled[color],
      resolvedMinors: 4 - undeveloped[color].size,
      undevelopedSquares: [...undeveloped[color]],
    }]));
    undeveloped[move.color].delete(move.from);
    const opponent = move.color === 'w' ? 'b' : 'w';
    if (move.captured) undeveloped[opponent].delete(move.to);
    if (move.flags.includes('k') || move.flags.includes('q')) castled[move.color] = true;
    return state;
  });
}

export function openingPhaseBeforeMoves(moves, isEndgameFen) {
  const development = developmentBeforeMoves(moves);
  let openingEnded = false;
  return moves.map((move, index) => {
    const number = Number(move.before.split(' ')[5]);
    const bothDeveloped = ['w', 'b'].every((color) => (
      development[index][color].castled
      && development[index][color].resolvedMinors >= OPENING_RULES.developedMinors
    ));
    if (
      number > OPENING_RULES.maxFullMoves
      || isEndgameFen(move.before)
      || (number > OPENING_RULES.earlyFullMoves && bothDeveloped)
    ) openingEnded = true;
    return !openingEnded;
  });
}
