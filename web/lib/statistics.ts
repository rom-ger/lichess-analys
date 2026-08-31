import type { GameResult, GameSpeed } from './lichess';
import { STOCKFISH_DEPTH, STOCKFISH_VERSION } from './stockfish';

const STATISTICS_URL = `/analysis/stockfish-${STOCKFISH_VERSION}-depth-${STOCKFISH_DEPTH}/statistics.json`;

export type QualityMetrics = {
  moves: number;
  totalAccuracy: number;
  totalCentipawnLoss: number;
  totalWinPercentLoss: number;
  comparableBestMoves: number;
  bestMoveMatches: number;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
  firstSeriousErrorPly: number | null;
};

export type GamePhase = 'opening' | 'middlegame' | 'endgame';
export type PhaseMetrics = Record<GamePhase, QualityMetrics>;

export type QualityGame = {
  gameId: string;
  playedAt: number;
  speed: GameSpeed | null;
  result: '0-1' | '1-0' | '1/2-1/2';
  white: string;
  black: string;
  metrics: { white: QualityMetrics; black: QualityMetrics };
  phaseMetrics: { white: PhaseMetrics; black: PhaseMetrics };
  queenlessMetrics: { white: QualityMetrics; black: QualityMetrics };
  openingExitWinPercent: { white: number | null; black: number | null };
};

type StatisticsIndex = {
  schemaVersion: number;
  engine: { name: string; version: string; depth: number };
  generatedAt: string;
  games: QualityGame[];
};

export type QualityFilters = {
  from?: number;
  to?: number;
  speed?: GameSpeed;
  result?: GameResult;
};

export type QualitySummary = {
  games: number;
  moves: number;
  accuracy: number | null;
  averageCentipawnLoss: number | null;
  averageWinPercentLoss: number | null;
  bestMoveRate: number | null;
  inaccuraciesPer100: number | null;
  mistakesPer100: number | null;
  blundersPer100: number | null;
  cleanGamesRate: number | null;
  averageFirstSeriousErrorMove: number | null;
};

export type PhaseSummary = {
  phase: GamePhase;
  games: number;
  moves: number;
  accuracy: number | null;
  averageCentipawnLoss: number | null;
  averageWinPercentLoss: number | null;
  seriousErrorsPer100: number | null;
  bestMoveRate: number | null;
};

export type PhaseOverview = {
  phases: PhaseSummary[];
  openingHeldRate: number | null;
  averageOpeningExitWinPercent: number | null;
  queenlessAccuracy: number | null;
  queenlessWinPercentLoss: number | null;
  queenlessMoves: number;
};

function resultFor(game: QualityGame, username: string): GameResult {
  if (game.result === '1/2-1/2') return 'draw';
  const playerIsWhite = game.white.toLowerCase() === username.toLowerCase();
  return (playerIsWhite && game.result === '1-0')
    || (!playerIsWhite && game.result === '0-1')
    ? 'win'
    : 'loss';
}

function playerColor(game: QualityGame, username: string) {
  if (game.white.toLowerCase() === username.toLowerCase()) return 'white' as const;
  if (game.black.toLowerCase() === username.toLowerCase()) return 'black' as const;
  return null;
}

function selectGames(games: QualityGame[], username: string, filters: QualityFilters) {
  return games.flatMap((game) => {
    if (filters.from !== undefined && game.playedAt < filters.from) return [];
    if (filters.to !== undefined && game.playedAt >= filters.to) return [];
    if (filters.speed && game.speed !== filters.speed) return [];
    if (filters.result && resultFor(game, username) !== filters.result) return [];
    const color = playerColor(game, username);
    return color ? [{ game, color }] : [];
  });
}

function aggregateMetrics(metricsList: QualityMetrics[]) {
  const totals = metricsList.reduce((sum, metrics) => ({
    moves: sum.moves + metrics.moves,
    accuracy: sum.accuracy + metrics.totalAccuracy,
    centipawnLoss: sum.centipawnLoss + metrics.totalCentipawnLoss,
    winPercentLoss: sum.winPercentLoss + metrics.totalWinPercentLoss,
    comparableBestMoves: sum.comparableBestMoves + metrics.comparableBestMoves,
    bestMoveMatches: sum.bestMoveMatches + metrics.bestMoveMatches,
    inaccuracies: sum.inaccuracies + metrics.inaccuracies,
    mistakes: sum.mistakes + metrics.mistakes,
    blunders: sum.blunders + metrics.blunders,
  }), {
    moves: 0,
    accuracy: 0,
    centipawnLoss: 0,
    winPercentLoss: 0,
    comparableBestMoves: 0,
    bestMoveMatches: 0,
    inaccuracies: 0,
    mistakes: 0,
    blunders: 0,
  });
  const perMove = (value: number) => totals.moves > 0 ? value / totals.moves : null;
  const per100 = (value: number) => totals.moves > 0 ? value / totals.moves * 100 : null;

  return {
    ...totals,
    accuracyPerMove: perMove(totals.accuracy),
    centipawnLossPerMove: perMove(totals.centipawnLoss),
    winPercentLossPerMove: perMove(totals.winPercentLoss),
    seriousErrorsPer100: per100(totals.mistakes + totals.blunders),
    bestMoveRate: totals.comparableBestMoves > 0
      ? totals.bestMoveMatches / totals.comparableBestMoves * 100
      : null,
  };
}

export function summarizeQuality(
  games: QualityGame[],
  username: string,
  filters: QualityFilters,
): QualitySummary {
  const selected = selectGames(games, username, filters);
  const metricsList = selected.map(({ game, color }) => game.metrics[color]);
  const totals = aggregateMetrics(metricsList);
  const firstErrors = selected
    .map(({ game, color }) => game.metrics[color].firstSeriousErrorPly)
    .filter((ply): ply is number => ply !== null);
  const cleanGames = selected.length - firstErrors.length;

  return {
    games: selected.length,
    moves: totals.moves,
    accuracy: totals.accuracyPerMove,
    averageCentipawnLoss: totals.centipawnLossPerMove,
    averageWinPercentLoss: totals.winPercentLossPerMove,
    bestMoveRate: totals.bestMoveRate,
    inaccuraciesPer100: totals.moves > 0 ? totals.inaccuracies / totals.moves * 100 : null,
    mistakesPer100: totals.moves > 0 ? totals.mistakes / totals.moves * 100 : null,
    blundersPer100: totals.moves > 0 ? totals.blunders / totals.moves * 100 : null,
    cleanGamesRate: selected.length > 0 ? cleanGames / selected.length * 100 : null,
    averageFirstSeriousErrorMove: firstErrors.length > 0
      ? firstErrors.reduce((sum, ply) => sum + Math.ceil(ply / 2), 0) / firstErrors.length
      : null,
  };
}

export function summarizePhases(
  games: QualityGame[],
  username: string,
  filters: QualityFilters,
): PhaseOverview {
  const selected = selectGames(games, username, filters);
  const phaseNames: GamePhase[] = ['opening', 'middlegame', 'endgame'];
  const phases = phaseNames.map((phase): PhaseSummary => {
    const metrics = selected.map(({ game, color }) => game.phaseMetrics[color][phase]);
    const aggregate = aggregateMetrics(metrics);
    return {
      phase,
      games: metrics.filter((value) => value.moves > 0).length,
      moves: aggregate.moves,
      accuracy: aggregate.accuracyPerMove,
      averageCentipawnLoss: aggregate.centipawnLossPerMove,
      averageWinPercentLoss: aggregate.winPercentLossPerMove,
      seriousErrorsPer100: aggregate.seriousErrorsPer100,
      bestMoveRate: aggregate.bestMoveRate,
    };
  });
  const openingExitValues = selected
    .map(({ game, color }) => game.openingExitWinPercent[color])
    .filter((value): value is number => value !== null);
  const queenless = aggregateMetrics(
    selected.map(({ game, color }) => game.queenlessMetrics[color]),
  );

  return {
    phases,
    openingHeldRate: openingExitValues.length > 0
      ? openingExitValues.filter((value) => value >= 45).length / openingExitValues.length * 100
      : null,
    averageOpeningExitWinPercent: openingExitValues.length > 0
      ? openingExitValues.reduce((sum, value) => sum + value, 0) / openingExitValues.length
      : null,
    queenlessAccuracy: queenless.accuracyPerMove,
    queenlessWinPercentLoss: queenless.winPercentLossPerMove,
    queenlessMoves: queenless.moves,
  };
}

export async function loadStatisticsIndex() {
  const response = await fetch(STATISTICS_URL);
  if (!response.ok) throw new Error('Индекс статистики не найден. Перезапустите приложение.');
  const value = await response.json() as StatisticsIndex;
  if (
    value.schemaVersion !== 2
    || value.engine?.version !== STOCKFISH_VERSION
    || value.engine?.depth !== STOCKFISH_DEPTH
    || !Array.isArray(value.games)
  ) {
    throw new Error('Индекс статистики устарел. Перезапустите приложение.');
  }
  return value;
}
