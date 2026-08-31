import { Chess } from 'chess.js';
import type { PositionEvaluation } from './lichess';
import {
  STOCKFISH_DEPTH,
  STOCKFISH_VERSION,
  type StockfishAnalysis,
} from './stockfish';

const ANALYSIS_DIRECTORY = `/analysis/stockfish-${STOCKFISH_VERSION}-depth-${STOCKFISH_DEPTH}`;

type SavedPosition = {
  ply: number;
  fen: string;
  evaluation: PositionEvaluation;
  bestMove: string | null;
  pv: string[];
};

type SavedGameAnalysis = {
  schemaVersion: number;
  gameId: string;
  engine: {
    name: string;
    version: string;
    depth: number;
  };
  positions: SavedPosition[];
};

function isEvaluation(value: unknown): value is PositionEvaluation {
  if (!value || typeof value !== 'object') return false;
  const evaluation = value as Partial<PositionEvaluation>;
  return (evaluation.kind === 'centipawns' || evaluation.kind === 'mate')
    && typeof evaluation.value === 'number'
    && Number.isFinite(evaluation.value);
}

function isSavedAnalysis(
  value: unknown,
  gameId: string,
  expectedFens: string[],
): value is SavedGameAnalysis {
  if (!value || typeof value !== 'object') return false;
  const saved = value as Partial<SavedGameAnalysis>;

  return saved.schemaVersion === 1
    && saved.gameId === gameId
    && saved.engine?.name === 'Stockfish'
    && saved.engine.version === STOCKFISH_VERSION
    && saved.engine.depth === STOCKFISH_DEPTH
    && Array.isArray(saved.positions)
    && saved.positions.length === expectedFens.length
    && saved.positions.every((position, ply) => (
      position?.ply === ply
      && position.fen === expectedFens[ply]
      && isEvaluation(position.evaluation)
      && (position.bestMove === null || typeof position.bestMove === 'string')
      && Array.isArray(position.pv)
      && position.pv.every((move) => typeof move === 'string')
    ));
}

function variationToSan(fen: string, variation: string[]) {
  const chess = new Chess(fen);
  const san: string[] = [];

  for (const uci of variation) {
    const match = uci.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
    if (!match) break;

    try {
      const move = chess.move({
        from: match[1],
        to: match[2],
        promotion: match[3],
      });
      if (!move) break;
      san.push(move.san);
    } catch {
      break;
    }
  }

  return san;
}

export async function loadSavedGameAnalysis(gameId: string, expectedFens: string[]) {
  try {
    const response = await fetch(`${ANALYSIS_DIRECTORY}/${encodeURIComponent(gameId)}.json`);
    if (!response.ok) return null;

    const saved: unknown = await response.json();
    if (!isSavedAnalysis(saved, gameId, expectedFens)) return null;

    return Object.fromEntries(saved.positions.map((position) => [
      position.ply,
      {
        fen: position.fen,
        depth: STOCKFISH_DEPTH,
        evaluation: position.evaluation,
        bestMove: position.bestMove,
        pv: position.pv,
        pvSan: variationToSan(position.fen, position.pv),
      } satisfies StockfishAnalysis,
    ])) as Record<number, StockfishAnalysis>;
  } catch {
    return null;
  }
}
