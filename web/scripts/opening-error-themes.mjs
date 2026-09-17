import { Chess } from 'chess.js';
import { developmentBeforeMoves } from './opening-phase.mjs';

const PV_PLIES = 8;
const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function materialBalance(chess, color) {
  return chess.board().flat().reduce((sum, piece) => (
    piece ? sum + PIECE_VALUES[piece.type] * (piece.color === color ? 1 : -1) : sum
  ), 0);
}

function playUci(chess, uci) {
  const match = uci?.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
  if (!match) return null;
  try {
    return chess.move({ from: match[1], to: match[2], promotion: match[3] });
  } catch {
    return null;
  }
}

function replayLine(position) {
  const chess = new Chess(position.fen);
  const moves = [];
  const pv = (position.pv ?? []).slice(0, PV_PLIES);
  for (const uci of pv) {
    const move = playUci(chess, uci);
    if (!move) return null;
    moves.push(move);
  }
  // Avoid calling an unfinished exchange a material loss: end after the
  // player's reply, unless the line has already ended in checkmate/stalemate.
  if (moves.length % 2 === 1 && !chess.isCheckmate() && !chess.isStalemate()) {
    chess.undo();
    moves.pop();
  }
  return { chess, moves, san: moves.map((move) => move.san) };
}

function pawnStructure(chess, color) {
  const files = Array(8).fill(0);
  for (const piece of chess.board().flat()) {
    if (piece?.type === 'p' && piece.color === color) files[piece.square.charCodeAt(0) - 97] += 1;
  }
  return {
    doubled: files.reduce((sum, count) => sum + Math.max(0, count - 1), 0),
    isolated: files.reduce((sum, count, file) => (
      sum + (!files[file - 1] && !files[file + 1] ? count : 0)
    ), 0),
  };
}

/** Observable signals, not a claim that Stockfish supplied a causal explanation. */
export function classifyOpeningError(analysis, moves, index) {
  const played = moves[index];
  const color = played.color;
  const opponent = color === 'w' ? 'b' : 'w';
  const before = analysis.positions[index];
  const after = analysis.positions[index + 1];
  const beforeBoard = new Chess(before.fen);
  const afterBoard = new Chess(after.fen);
  const recommendedBoard = new Chess(before.fen);
  const recommended = playUci(recommendedBoard, before.bestMove);
  const line = replayLine(after);
  const themes = [];

  if (line && line.moves.length >= 2) {
    const loss = materialBalance(beforeBoard, color) - materialBalance(line.chess, color);
    if (loss >= 1) {
      themes.push({
        type: 'material',
        evidence: `В сохранённой линии Stockfish за ${line.moves.length} полуходов после ошибки баланс материала ухудшается на ${loss} пешек относительно позиции перед ходом.`,
        lineSan: line.san,
      });
    }
  }

  const losingMate = after.evaluation.kind === 'mate'
    && (color === 'w' ? after.evaluation.value <= 0 : after.evaluation.value > 0);
  const opponentChecks = line?.moves.filter((move) => (
    move.color === opponent && /[+#]$/.test(move.san)
  )).length ?? 0;
  if (losingMate || opponentChecks >= 2) {
    themes.push({
      type: 'king-safety',
      evidence: losingMate
        ? 'После ошибки Stockfish видит форсированный мат вашему королю.'
        : `В сохранённой линии после ошибки соперник даёт ${opponentChecks} шаха вашему королю.`,
      lineSan: line?.san ?? [],
    });
  }

  const development = developmentBeforeMoves(moves.slice(0, index + 1)).at(-1);
  const own = development[color];
  const other = development[opponent];
  const castling = (move) => move && (move.flags.includes('k') || move.flags.includes('q'));
  const recommendsDevelopment = recommended
    && (own.undevelopedSquares.includes(recommended.from) || castling(recommended));
  const playedDevelopment = own.undevelopedSquares.includes(played.from) || castling(played);
  if (
    recommendsDevelopment && !playedDevelopment
    && (own.resolvedMinors < other.resolvedMinors || (!own.castled && other.castled))
  ) {
    themes.push({
      type: 'development',
      evidence: `Выведено или разменяно лёгких фигур: у вас ${own.resolvedMinors} из 4, у соперника ${other.resolvedMinors} из 4. ${!own.castled && other.castled ? 'Соперник уже рокировал, вы — ещё нет. ' : ''}Stockfish рекомендовал ${recommended.san} — ${castling(recommended) ? 'рокировку' : 'развитие исходной лёгкой фигуры'}, а сыграно ${played.san}.`,
      lineSan: [],
    });
  }

  if (played.piece === 'p' && recommended) {
    const original = pawnStructure(beforeBoard, color);
    const actual = pawnStructure(afterBoard, color);
    const alternative = pawnStructure(recommendedBoard, color);
    const signals = [];
    if (actual.doubled > original.doubled && actual.doubled > alternative.doubled) {
      signals.push(`лишних пешек на одной вертикали стало ${actual.doubled} вместо ${original.doubled}`);
    }
    if (actual.isolated > original.isolated && actual.isolated > alternative.isolated) {
      signals.push(`изолированных пешек стало ${actual.isolated} вместо ${original.isolated}`);
    }
    if (signals.length) themes.push({
      type: 'pawn-structure',
      evidence: `После ${played.san} ${signals.join('; ')}. При рекомендованном ${recommended.san} эти показатели лучше.`,
      lineSan: [],
    });
  }

  return themes.length ? themes : [{
    type: 'other',
    evidence: 'Падение оценки подтверждено, но по доступной позиции и линии Stockfish тип ошибки уверенно определить не удалось.',
    lineSan: [],
  }];
}
