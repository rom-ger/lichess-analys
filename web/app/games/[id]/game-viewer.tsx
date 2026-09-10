'use client';

import { Chess, type Square } from 'chess.js';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  classifyMove,
  evaluationToWhiteWinPercent,
  getGameById,
  type GameDetails,
  type GameMove,
  type MoveJudgement,
  type GamePlayer,
  type PositionEvaluation,
} from '../../../lib/lichess';
import { cacheAnalysis, getCachedAnalysis } from '../../../lib/analysis-cache';
import {
  analyzePosition,
  STOCKFISH_DEPTH,
  type StockfishAnalysis,
} from '../../../lib/stockfish';
import { loadSavedGameAnalysis } from '../../../lib/saved-analysis';

const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];

const pieces: Record<string, string> = {
  K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
};

type Promotion = 'q' | 'r' | 'b' | 'n';

type VariationMove = {
  color: 'w' | 'b';
  fen: string;
  from: string;
  moveNumber: number;
  promotion?: Promotion;
  san: string;
  to: string;
};

type Variation = {
  basePly: number;
  moves: VariationMove[];
};

type BoardMove = Pick<GameMove, 'from' | 'san' | 'to'>;

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Moscow',
});

function boardFromFen(fen: string) {
  const position = new Map<string, string>();
  const fenRanks = fen.split(' ')[0].split('/');

  fenRanks.forEach((rank, rankIndex) => {
    let fileIndex = 0;
    for (const symbol of rank) {
      const emptySquares = Number(symbol);
      if (Number.isInteger(emptySquares) && emptySquares > 0) {
        fileIndex += emptySquares;
      } else {
        position.set(`${files[fileIndex]}${8 - rankIndex}`, symbol);
        fileIndex += 1;
      }
    }
  });

  return position;
}

function materialBalanceFromFen(fen: string) {
  const values: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  return [...fen.split(' ')[0]].reduce((balance, piece) => {
    const value = values[piece.toLowerCase()] ?? 0;
    return piece === piece.toUpperCase() ? balance + value : balance - value;
  }, 0);
}

function moveNumberFromFen(fen: string) {
  const value = Number(fen.split(' ')[5]);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function playMove(
  fen: string,
  from: string,
  to: string,
  promotion?: Promotion,
): VariationMove | null {
  const chess = new Chess(fen);
  const moveNumber = moveNumberFromFen(fen);

  try {
    const move = chess.move({
      from: from as Square,
      to: to as Square,
      ...(promotion ? { promotion } : {}),
    });
    if (!move) return null;

    return {
      color: move.color,
      fen: chess.fen(),
      from: move.from,
      moveNumber,
      ...(move.promotion ? { promotion: move.promotion as Promotion } : {}),
      san: move.san,
      to: move.to,
    };
  } catch {
    return null;
  }
}

function playUciVariation(fen: string, uciMoves: string[]) {
  const moves: VariationMove[] = [];
  let currentFen = fen;

  for (const uci of uciMoves) {
    const match = uci.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
    if (!match) break;
    const move = playMove(currentFen, match[1], match[2], match[3] as Promotion | undefined);
    if (!move) break;
    moves.push(move);
    currentFen = move.fen;
  }

  return moves;
}

function ChessBoard({
  bestMove,
  fen,
  orientation,
  lastMove,
  onMove,
}: {
  bestMove?: string | null;
  fen: string;
  orientation: GameDetails['playerColor'];
  lastMove?: BoardMove;
  onMove: (from: string, to: string, promotion?: Promotion) => void;
}) {
  const position = useMemo(() => boardFromFen(fen), [fen]);
  const chess = useMemo(() => new Chess(fen), [fen]);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<{
    from: string;
    options: Promotion[];
    to: string;
  } | null>(null);
  const shownFiles = orientation === 'white' ? files : [...files].reverse();
  const shownRanks = orientation === 'white' ? ranks : [...ranks].reverse();
  const bestMoveMatch = bestMove?.match(/^([a-h][1-8])([a-h][1-8])/);
  const bestFrom = bestMoveMatch?.[1];
  const bestTo = bestMoveMatch?.[2];
  const legalMoves = useMemo(() => (
    selectedSquare
      ? chess.moves({ square: selectedSquare as Square, verbose: true })
      : []
  ), [chess, selectedSquare]);

  function selectSquare(square: string) {
    const destinationMoves = legalMoves.filter((move) => move.to === square);
    if (selectedSquare && destinationMoves.length > 0) {
      const promotions = destinationMoves
        .map((move) => move.promotion)
        .filter((piece): piece is Promotion => Boolean(piece));
      if (promotions.length > 1) {
        setPromotion({ from: selectedSquare, options: promotions, to: square });
      } else {
        onMove(selectedSquare, square, promotions[0]);
      }
      setSelectedSquare(null);
      return;
    }

    const piece = position.get(square);
    const isMovable = piece
      && (piece === piece.toUpperCase() ? 'w' : 'b') === chess.turn();
    setSelectedSquare(isMovable ? square : null);
  }

  return (
    <div
      aria-label={`Интерактивная шахматная доска, ход ${lastMove?.san ?? 'начальная позиция'}`}
      className="chess-board"
      role="grid"
    >
      {shownRanks.flatMap((rank, rankIndex) => shownFiles.map((file, fileIndex) => {
        const square = `${file}${rank}`;
        const piece = position.get(square);
        const isDark = (files.indexOf(file) + Number(rank)) % 2 === 1;
        const isLastMove = square === lastMove?.from || square === lastMove?.to;
        const isBestFrom = square === bestFrom;
        const isBestTo = square === bestTo;
        const legalMove = legalMoves.find((move) => move.to === square);
        const isSelected = square === selectedSquare;

        return (
          <button
            aria-label={`${square}${piece ? `, ${piece === piece.toUpperCase() ? 'белая' : 'чёрная'} фигура` : ''}${legalMove ? ', доступный ход' : ''}`}
            aria-selected={isSelected}
            className={`board-square board-square--${isDark ? 'dark' : 'light'}${isLastMove ? ' board-square--last' : ''}${isBestFrom ? ' board-square--best-from' : ''}${isBestTo ? ' board-square--best-to' : ''}${legalMove ? ' board-square--legal' : ''}${legalMove && piece ? ' board-square--capture' : ''}${isSelected ? ' board-square--selected' : ''}`}
            key={square}
            onClick={() => selectSquare(square)}
            role="gridcell"
            type="button"
          >
            {fileIndex === 0 && <span className="rank-label">{rank}</span>}
            {rankIndex === 7 && <span className="file-label">{file}</span>}
            {legalMove && (
              <span
                aria-hidden="true"
                className={`board-legal-marker${piece ? ' board-legal-marker--capture' : ''}`}
              />
            )}
            {piece && (
              <span
                aria-label={`${piece === piece.toUpperCase() ? 'Белая' : 'Чёрная'} фигура на ${square}`}
                className={`chess-piece chess-piece--${piece === piece.toUpperCase() ? 'white' : 'black'}`}
              >
                {pieces[piece]}
              </span>
            )}
          </button>
        );
      }))}
      {promotion && (
        <div className="promotion-picker" role="dialog" aria-label="Выберите фигуру для превращения">
          {promotion.options.map((piece) => (
            <button
              key={piece}
              onClick={() => {
                onMove(promotion.from, promotion.to, piece);
                setPromotion(null);
              }}
              type="button"
            >
              {pieces[chess.turn() === 'w' ? piece.toUpperCase() : piece]}
            </button>
          ))}
          <button className="promotion-picker__cancel" onClick={() => setPromotion(null)} type="button">
            Отмена
          </button>
        </div>
      )}
    </div>
  );
}

function formatEvaluation(evaluation: PositionEvaluation | null) {
  if (!evaluation) return '—';
  if (evaluation.kind === 'mate') {
    return evaluation.value > 0 ? `+M${evaluation.value}` : `−M${Math.abs(evaluation.value)}`;
  }
  const pawns = evaluation.value / 100;
  if (Math.abs(pawns) < 0.005) return '0.00';
  return `${pawns > 0 ? '+' : '−'}${Math.abs(pawns).toFixed(2)}`;
}

const judgementLabels: Record<MoveJudgement, { glyph: string; label: string }> = {
  inaccuracy: { glyph: '?!', label: 'Неточность' },
  mistake: { glyph: '?', label: 'Ошибка' },
  blunder: { glyph: '??', label: 'Грубая ошибка' },
};

function EvaluationBar({
  evaluation,
  orientation,
}: {
  evaluation: PositionEvaluation | null;
  orientation: GameDetails['playerColor'];
}) {
  const whitePercent = evaluation ? evaluationToWhiteWinPercent(evaluation) : 50;

  return (
    <div
      aria-label={`Оценка позиции: ${formatEvaluation(evaluation)} с точки зрения белых`}
      className={`evaluation-bar evaluation-bar--${orientation}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(whitePercent)}
    >
      <span className="evaluation-bar__white" style={{ height: `${whitePercent}%` }} />
      <strong>{formatEvaluation(evaluation)}</strong>
    </div>
  );
}

function EvaluationGraph({
  currentPly,
  evaluations,
  onSelect,
}: {
  currentPly: number;
  evaluations: Array<PositionEvaluation | null>;
  onSelect: (ply: number) => void;
}) {
  if (!evaluations.some((evaluation, index) => index > 0 && evaluation)) return null;

  return (
    <div className="evaluation-chart" aria-label="График оценки партии">
      <span className="evaluation-chart__middle" aria-hidden="true" />
      {evaluations.map((evaluation, ply) => {
        const whitePercent = evaluation ? evaluationToWhiteWinPercent(evaluation) : 50;
        const bottom = Math.min(50, whitePercent);
        const height = Math.max(1.5, Math.abs(whitePercent - 50));
        return (
          <button
            aria-label={`Позиция ${ply}: ${formatEvaluation(evaluation)}`}
            aria-pressed={currentPly === ply}
            className="evaluation-chart__point"
            key={ply}
            onClick={() => onSelect(ply)}
            type="button"
          >
            {evaluation && (
              <span
                className={`evaluation-chart__bar ${whitePercent >= 50 ? 'evaluation-chart__bar--white' : 'evaluation-chart__bar--black'}`}
                style={{ bottom: `${bottom}%`, height: `${height}%` }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

function judgementCounts(moves: Array<GameMove & { judgement: MoveJudgement | null }>) {
  return moves.reduce(
    (counts, move) => {
      if (move.judgement) counts[move.judgement] += 1;
      return counts;
    },
    { inaccuracy: 0, mistake: 0, blunder: 0 },
  );
}

type AnalysisStatus =
  | { kind: 'idle' }
  | { kind: 'position'; ply: number }
  | { kind: 'full'; current: number; total: number }
  | { kind: 'error'; message: string };

function formatClock(seconds: number | null) {
  if (seconds === null) return null;
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const secondsLabel = String(wholeSeconds).padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${secondsLabel}`;
  }
  return `${minutes}:${secondsLabel}`;
}

function PlayerBar({
  clockSeconds,
  materialAdvantage,
  player,
  score,
}: {
  clockSeconds: number | null;
  materialAdvantage: number;
  player: GamePlayer;
  score: string;
}) {
  const clock = formatClock(clockSeconds);

  return (
    <div className="player-bar">
      <span className="player-avatar" aria-hidden="true">
        {player.name.slice(0, 1).toUpperCase()}
      </span>
      <strong>{player.name}</strong>
      {player.rating !== null && <span className="player-rating">{player.rating}</span>}
      <div className="player-position-data">
        {materialAdvantage > 0 && (
          <span
            aria-label={`Преимущество по материалу: ${materialAdvantage}`}
            className="material-advantage"
            title="Преимущество по материалу"
          >
            +{materialAdvantage}
          </span>
        )}
        {clock && <time className="player-clock">{clock}</time>}
        <span className="player-score">{score}</span>
      </div>
    </div>
  );
}

function scoresFor(game: GameDetails) {
  if (game.result === 'Ничья') return { white: '½', black: '½' };
  const playerWon = game.result === 'Победа';
  const whiteWon = (game.playerColor === 'white' && playerWon)
    || (game.playerColor === 'black' && !playerWon);
  return whiteWon ? { white: '1', black: '0' } : { white: '0', black: '1' };
}

export function GameViewer({
  gameId,
  initialPly = 0,
  username,
}: {
  gameId: string;
  initialPly?: number;
  username: string;
}) {
  const game = useMemo(() => getGameById(username, gameId), [gameId, username]);
  const [currentPly, setCurrentPly] = useState(() => (
    game ? Math.min(initialPly, game.moves.length) : 0
  ));
  const [engineAnalysisByPly, setEngineAnalysisByPly] = useState<Record<number, StockfishAnalysis>>({});
  const [variationAnalysisByFen, setVariationAnalysisByFen] = useState<Record<string, StockfishAnalysis>>({});
  const [variation, setVariation] = useState<Variation | null>(null);
  const [variationStep, setVariationStep] = useState<number | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>({ kind: 'idle' });
  const activeMoveRef = useRef<HTMLButtonElement>(null);
  const analysisAbortRef = useRef<AbortController>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!game) return;
      const isVariation = variation && variationStep !== null;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (isVariation) setVariationStep((step) => Math.max(0, (step ?? 0) - 1));
        else setCurrentPly((ply) => Math.max(0, ply - 1));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (isVariation) {
          setVariationStep((step) => Math.min(variation.moves.length, (step ?? 0) + 1));
        } else {
          setCurrentPly((ply) => Math.min(game.moves.length, ply + 1));
        }
      } else if (event.key === 'Home') {
        event.preventDefault();
        if (isVariation) setVariationStep(0);
        else setCurrentPly(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        if (isVariation) setVariationStep(variation.moves.length);
        else setCurrentPly(game.moves.length);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [game, variation, variationStep]);

  useEffect(() => {
    activeMoveRef.current?.scrollIntoView({ block: 'nearest' });
  }, [currentPly, variationStep]);

  useEffect(() => () => analysisAbortRef.current?.abort(), []);

  useEffect(() => {
    let cancelled = false;
    if (!game) return undefined;

    const expectedFens = [game.initialFen, ...game.moves.map((move) => move.fen)];

    void loadSavedGameAnalysis(gameId, expectedFens).then((saved) => {
      if (!cancelled && saved) {
        setEngineAnalysisByPly((current) => ({ ...saved, ...current }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [game, gameId]);

  if (!game) {
    return (
      <div className="state-message game-state-message">
        <p className="state-title">Партия не найдена</p>
        <p>Возможно, её больше нет среди локальных PGN-файлов.</p>
        <Link className="state-link" href="/">Вернуться к списку</Link>
      </div>
    );
  }

  const loadedGame = game;

  const mainlineMove = currentPly > 0 ? game.moves[currentPly - 1] : undefined;
  const mainlineFen = mainlineMove?.fen ?? game.initialFen;
  const isVariation = Boolean(variation && variationStep !== null);
  const activeVariationStep = variation
    ? Math.min(variationStep ?? 0, variation.moves.length)
    : 0;
  const variationBaseFen = variation
    ? (variation.basePly === 0 ? game.initialFen : game.moves[variation.basePly - 1].fen)
    : game.initialFen;
  const variationMove = variation && activeVariationStep > 0
    ? variation.moves[activeVariationStep - 1]
    : undefined;
  const fen = isVariation ? (variationMove?.fen ?? variationBaseFen) : mainlineFen;
  const currentMove: BoardMove | undefined = isVariation ? variationMove : mainlineMove;
  const evaluations = [
    game.initialEvaluation,
    ...game.moves.map((move) => move.evaluation),
  ].map((evaluation, ply) => engineAnalysisByPly[ply]?.evaluation ?? evaluation);
  const annotatedMoves = game.moves.map((move, index) => {
    if (!engineAnalysisByPly[index] || !engineAnalysisByPly[index + 1]) return move;
    const classification = classifyMove(
      engineAnalysisByPly[index].evaluation,
      engineAnalysisByPly[index + 1].evaluation,
      move.ply % 2 === 1 ? 'white' : 'black',
    );
    return { ...move, ...classification };
  });
  const playerMoves = annotatedMoves.filter((move) => (
    game.playerColor === 'white' ? move.ply % 2 === 1 : move.ply % 2 === 0
  ));
  const counts = judgementCounts(playerMoves);
  const playerErrors = playerMoves.filter((move) => move.judgement);
  const currentEngineAnalysis = isVariation
    ? (variationAnalysisByFen[fen]
      ?? (activeVariationStep === 0 && variation ? engineAnalysisByPly[variation.basePly] : undefined))
    : engineAnalysisByPly[currentPly];
  const currentEvaluation = currentEngineAnalysis?.evaluation
    ?? (isVariation && variation && activeVariationStep === 0
      ? evaluations[variation.basePly]
      : isVariation ? null : evaluations[currentPly])
    ?? null;
  const analysisIsRunning = analysisStatus.kind === 'position' || analysisStatus.kind === 'full';
  const clockSourceMove = isVariation && variation
    ? (variation.basePly > 0 ? game.moves[variation.basePly - 1] : undefined)
    : mainlineMove;
  const whiteClockSeconds = clockSourceMove?.whiteClockSeconds ?? game.initialClockSeconds;
  const blackClockSeconds = clockSourceMove?.blackClockSeconds ?? game.initialClockSeconds;
  const materialBalance = isVariation
    ? materialBalanceFromFen(fen)
    : mainlineMove?.materialBalance ?? game.initialMaterialBalance;
  const score = scoresFor(game);
  const bottomPlayer = game.playerColor === 'white' ? game.white : game.black;
  const topPlayer = game.playerColor === 'white' ? game.black : game.white;
  const bottomScore = game.playerColor === 'white' ? score.white : score.black;
  const topScore = game.playerColor === 'white' ? score.black : score.white;
  const whiteMaterialAdvantage = Math.max(0, materialBalance);
  const blackMaterialAdvantage = Math.max(0, -materialBalance);
  const bottomClock = game.playerColor === 'white' ? whiteClockSeconds : blackClockSeconds;
  const topClock = game.playerColor === 'white' ? blackClockSeconds : whiteClockSeconds;
  const bottomMaterialAdvantage = game.playerColor === 'white'
    ? whiteMaterialAdvantage
    : blackMaterialAdvantage;
  const topMaterialAdvantage = game.playerColor === 'white'
    ? blackMaterialAdvantage
    : whiteMaterialAdvantage;
  const moveRows = Array.from({ length: Math.ceil(game.moves.length / 2) }, (_, index) => ({
    number: index + 1,
    white: annotatedMoves[index * 2],
    black: annotatedMoves[index * 2 + 1],
  }));
  const navigationPosition = isVariation ? activeVariationStep : currentPly;
  const navigationLength = isVariation && variation ? variation.moves.length : game.moves.length;

  function selectMainlinePly(ply: number) {
    setCurrentPly(ply);
    setVariationStep(null);
  }

  function openVariationStep(step: number) {
    if (!variation) return;
    setCurrentPly(variation.basePly);
    setVariationStep(Math.max(0, Math.min(step, variation.moves.length)));
  }

  function appendVariationMoves(moves: VariationMove[]) {
    if (moves.length === 0) return;
    stopAnalysis();

    if (isVariation && variation) {
      const updatedMoves = [...variation.moves.slice(0, activeVariationStep), ...moves];
      setVariation({ ...variation, moves: updatedMoves });
      setVariationStep(updatedMoves.length);
      return;
    }

    setVariation({ basePly: currentPly, moves });
    setVariationStep(moves.length);
  }

  function makeBoardMove(from: string, to: string, promotion?: Promotion) {
    const move = playMove(fen, from, to, promotion);
    if (move) appendVariationMoves([move]);
  }

  function followEngineVariation(moveIndex: number) {
    if (!currentEngineAnalysis) return;
    appendVariationMoves(playUciVariation(fen, currentEngineAnalysis.pv.slice(0, moveIndex + 1)));
  }

  function navigate(position: 'start' | 'previous' | 'next' | 'end') {
    if (isVariation && variation) {
      if (position === 'start') setVariationStep(0);
      if (position === 'previous') setVariationStep(Math.max(0, activeVariationStep - 1));
      if (position === 'next') setVariationStep(Math.min(variation.moves.length, activeVariationStep + 1));
      if (position === 'end') setVariationStep(variation.moves.length);
      return;
    }

    if (position === 'start') setCurrentPly(0);
    if (position === 'previous') setCurrentPly(Math.max(0, currentPly - 1));
    if (position === 'next') setCurrentPly(Math.min(loadedGame.moves.length, currentPly + 1));
    if (position === 'end') setCurrentPly(loadedGame.moves.length);
  }

  function moveToError(direction: 'previous' | 'next') {
    const candidates = direction === 'previous'
      ? playerErrors.filter((move) => move.ply < currentPly).reverse()
      : playerErrors.filter((move) => move.ply > currentPly);
    if (candidates[0]) selectMainlinePly(candidates[0].ply);
  }

  function stopAnalysis() {
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = null;
    setAnalysisStatus({ kind: 'idle' });
  }

  async function analyzePly(ply: number, signal: AbortSignal) {
    const positionFen = ply === 0 ? loadedGame.initialFen : loadedGame.moves[ply - 1].fen;
    const cached = await getCachedAnalysis(loadedGame.id, ply, positionFen, STOCKFISH_DEPTH);
    if (cached) return cached;

    const analysis = await analyzePosition(positionFen, { depth: STOCKFISH_DEPTH, signal });
    await cacheAnalysis(loadedGame.id, ply, analysis);
    return analysis;
  }

  async function analyzeVariationPosition(positionFen: string, signal: AbortSignal) {
    const cacheGameId = `${loadedGame.id}:variation`;
    const cached = await getCachedAnalysis(cacheGameId, 0, positionFen, STOCKFISH_DEPTH);
    if (cached) return cached;

    const analysis = await analyzePosition(positionFen, { depth: STOCKFISH_DEPTH, signal });
    await cacheAnalysis(cacheGameId, 0, analysis);
    return analysis;
  }

  async function analyzeCurrentPosition() {
    stopAnalysis();
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    setAnalysisStatus({ kind: 'position', ply: isVariation ? activeVariationStep : currentPly });

    try {
      const analysis = currentEngineAnalysis
        ?? (isVariation
          ? await analyzeVariationPosition(fen, controller.signal)
          : await analyzePly(currentPly, controller.signal));
      if (controller.signal.aborted) return;
      if (isVariation) {
        setVariationAnalysisByFen((current) => ({ ...current, [fen]: analysis }));
      } else {
        setEngineAnalysisByPly((current) => ({ ...current, [currentPly]: analysis }));
      }
      setAnalysisStatus({ kind: 'idle' });
    } catch (error) {
      if (controller.signal.aborted) return;
      setAnalysisStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Не удалось выполнить анализ.',
      });
    } finally {
      if (analysisAbortRef.current === controller) analysisAbortRef.current = null;
    }
  }

  async function analyzeWholeGame() {
    stopAnalysis();
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    const total = loadedGame.moves.length + 1;
    const collected = { ...engineAnalysisByPly };

    try {
      for (const ply of Array.from({ length: total }, (_, index) => index)) {
        if (controller.signal.aborted) return;
        setAnalysisStatus({ kind: 'full', current: ply + 1, total });
        const analysis = collected[ply] ?? await analyzePly(ply, controller.signal);
        collected[ply] = analysis;
        setEngineAnalysisByPly((current) => ({ ...current, [ply]: analysis }));
      }
      setAnalysisStatus({ kind: 'idle' });
    } catch (error) {
      if (controller.signal.aborted) return;
      setAnalysisStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Не удалось проанализировать партию.',
      });
    } finally {
      if (analysisAbortRef.current === controller) analysisAbortRef.current = null;
    }
  }

  return (
    <section className="game-viewer" aria-labelledby="game-title">
      <div className="board-column">
        <PlayerBar
          clockSeconds={topClock}
          materialAdvantage={topMaterialAdvantage}
          player={topPlayer}
          score={topScore}
        />
        <div className="board-with-evaluation">
          <EvaluationBar evaluation={currentEvaluation} orientation={game.playerColor} />
          <ChessBoard
            bestMove={currentEngineAnalysis?.bestMove}
            fen={fen}
            key={fen}
            lastMove={currentMove}
            onMove={makeBoardMove}
            orientation={game.playerColor}
          />
        </div>
        <p className="board-interaction-hint">
          {isVariation
            ? `Вариант · позиция ${activeVariationStep} из ${variation?.moves.length ?? 0}. Можно продолжить своим ходом.`
            : 'Нажмите на фигуру, затем на доступную клетку, чтобы создать вариант.'}
        </p>
        <PlayerBar
          clockSeconds={bottomClock}
          materialAdvantage={bottomMaterialAdvantage}
          player={bottomPlayer}
          score={bottomScore}
        />
      </div>

      <aside className="moves-panel">
        <header className="moves-header">
          <p className="eyebrow">{game.control} · {game.result}</p>
          <h1 id="game-title">{game.white.name} — {game.black.name}</h1>
          <p className="game-meta">
            <time dateTime={new Date(game.playedAt).toISOString()}>
              {dateFormatter.format(game.playedAt)} МСК
            </time>
            {game.termination && <span>{game.termination}</span>}
          </p>
        </header>

        <section className="analysis-overview" aria-label="Компьютерный анализ">
          <div className="analysis-summary">
            {(['inaccuracy', 'mistake', 'blunder'] as const).map((judgement) => (
              <span className={`analysis-count analysis-count--${judgement}`} key={judgement}>
                <strong>{counts[judgement]}</strong>
                {judgementLabels[judgement].label.toLowerCase()}
              </span>
            ))}
            <div className="error-navigation" aria-label="Навигация по ошибкам">
              <button
                aria-label="Предыдущая ошибка"
                disabled={!playerErrors.some((move) => move.ply < currentPly)}
                onClick={() => moveToError('previous')}
                type="button"
              >
                ‹
              </button>
              <button
                aria-label="Следующая ошибка"
                disabled={!playerErrors.some((move) => move.ply > currentPly)}
                onClick={() => moveToError('next')}
                type="button"
              >
                ›
              </button>
            </div>
          </div>

          <EvaluationGraph
            currentPly={isVariation ? -1 : currentPly}
            evaluations={evaluations}
            onSelect={selectMainlinePly}
          />

          <div className="engine-analysis">
            <div className="engine-analysis__result">
              <span className="engine-label">
                {currentEngineAnalysis ? `Stockfish 18 · глубина ${currentEngineAnalysis.depth}` : 'Оценка позиции'}
              </span>
              <strong>{formatEvaluation(currentEvaluation)}</strong>
              {currentEngineAnalysis?.pvSan.length ? (
                <div className="engine-variation" title={currentEngineAnalysis.pv.join(' ')}>
                  {currentEngineAnalysis.pvSan.slice(0, 8).map((san, index) => (
                    <button
                      aria-label={`Перейти к варианту Stockfish после хода ${san}`}
                      key={`${currentEngineAnalysis.pv[index]}-${index}`}
                      onClick={() => followEngineVariation(index)}
                      type="button"
                    >
                      {san}
                    </button>
                  ))}
                </div>
              ) : (
                <p>{currentEvaluation ? 'Доступна из PGN' : 'Позиция ещё не анализировалась'}</p>
              )}
            </div>

            <div className="engine-actions">
              {analysisIsRunning ? (
                <button className="engine-button engine-button--stop" onClick={stopAnalysis} type="button">
                  Остановить
                </button>
              ) : (
                <>
                  <button className="engine-button" onClick={analyzeCurrentPosition} type="button">
                    Анализ позиции
                  </button>
                  {!isVariation && (
                    <button className="engine-button engine-button--secondary" onClick={analyzeWholeGame} type="button">
                      Вся партия
                    </button>
                  )}
                </>
              )}
            </div>

            {analysisStatus.kind === 'position' && (
              <p className="analysis-status">Stockfish анализирует позицию…</p>
            )}
            {analysisStatus.kind === 'full' && (
              <div className="analysis-progress">
                <span>Анализ партии: {analysisStatus.current} / {analysisStatus.total}</span>
                <progress max={analysisStatus.total} value={analysisStatus.current} />
              </div>
            )}
            {analysisStatus.kind === 'error' && (
              <p className="analysis-status analysis-status--error">{analysisStatus.message}</p>
            )}
          </div>
        </section>

        {variation && (
          <section className="variation-panel" aria-label="Созданный вариант">
            <header className="variation-panel__header">
              <div>
                <span>
                  {variation.basePly === 0
                    ? 'Вариант от начальной позиции'
                    : `Вариант после ${game.moves[variation.basePly - 1].san}`}
                </span>
                <strong>{variation.moves.length} ходов</strong>
              </div>
              <div className="variation-panel__actions">
                {isVariation && (
                  <button onClick={() => selectMainlinePly(variation.basePly)} type="button">
                    К партии
                  </button>
                )}
                <button
                  aria-label="Удалить вариант"
                  onClick={() => {
                    setVariation(null);
                    setVariationStep(null);
                  }}
                  type="button"
                >
                  Удалить
                </button>
              </div>
            </header>
            <div className="variation-line">
              <button
                aria-pressed={isVariation && activeVariationStep === 0}
                onClick={() => openVariationStep(0)}
                type="button"
              >
                Точка ветвления
              </button>
              {variation.moves.map((move, index) => (
                <button
                  aria-pressed={isVariation && activeVariationStep === index + 1}
                  key={`${move.from}-${move.to}-${index}`}
                  onClick={() => openVariationStep(index + 1)}
                  type="button"
                >
                  <small>{move.color === 'w' ? `${move.moveNumber}.` : `${move.moveNumber}…`}</small>
                  {move.san}
                </button>
              ))}
            </div>
            {!isVariation && (
              <button
                className="variation-panel__open"
                onClick={() => openVariationStep(variation.moves.length)}
                type="button"
              >
                Вернуться к варианту
              </button>
            )}
          </section>
        )}

        <div className="moves-list" aria-label="Ходы партии">
          {moveRows.map((row) => (
            <div className="move-row" key={row.number}>
              <span className="move-number">{row.number}.</span>
              {[row.white, row.black].map((move, colorIndex) => move ? (
                <button
                  aria-current={!isVariation && currentPly === move.ply ? 'step' : undefined}
                  className="move-button"
                  key={move.ply}
                  onClick={() => selectMainlinePly(move.ply)}
                  ref={!isVariation && currentPly === move.ply ? activeMoveRef : undefined}
                  type="button"
                >
                  <span className="move-san">
                    {move.san}
                    {move.judgement && (
                      <span
                        aria-label={judgementLabels[move.judgement].label}
                        className={`move-judgement move-judgement--${move.judgement}`}
                        title={`${judgementLabels[move.judgement].label}${move.winPercentLoss === null ? '' : `: потеря ${move.winPercentLoss.toFixed(0)}% шансов на победу`}`}
                      >
                        {judgementLabels[move.judgement].glyph}
                      </span>
                    )}
                  </span>
                  <span className="move-data">
                    {evaluations[move.ply] && <small>{formatEvaluation(evaluations[move.ply])}</small>}
                    {move.clockSeconds !== null && <time>{formatClock(move.clockSeconds)}</time>}
                  </span>
                </button>
              ) : <span key={colorIndex} />)}
            </div>
          ))}
        </div>

        <div className="move-controls" aria-label="Навигация по ходам">
          <button aria-label="В начало" disabled={navigationPosition === 0} onClick={() => navigate('start')} type="button">«</button>
          <button aria-label="На ход назад" disabled={navigationPosition === 0} onClick={() => navigate('previous')} type="button">‹</button>
          <span>{isVariation ? 'Вариант ' : ''}{navigationPosition} / {navigationLength}</span>
          <button aria-label="На ход вперёд" disabled={navigationPosition === navigationLength} onClick={() => navigate('next')} type="button">›</button>
          <button aria-label="В конец" disabled={navigationPosition === navigationLength} onClick={() => navigate('end')} type="button">»</button>
        </div>

        <footer className="moves-footer">
          <span>
            Навигация: ← → Home End ·{' '}
            <a href="https://github.com/nmrugg/stockfish.js" rel="noreferrer" target="_blank">
              Stockfish GPLv3
            </a>
          </span>
          {game.siteUrl && (
            <a href={game.siteUrl} rel="noreferrer" target="_blank">Открыть на Lichess ↗</a>
          )}
        </footer>
      </aside>
    </section>
  );
}
