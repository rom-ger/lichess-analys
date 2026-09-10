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

export type AdvantageMetrics = {
  maxWinPercent: number;
  firstWinningPly: number | null;
  postAdvantageMetrics: QualityMetrics;
  firstFiveMetrics: QualityMetrics;
};

export type DefenseMetrics = {
  minWinPercent: number;
  firstLosingPly: number | null;
  bestRecoveryWinPercent: number | null;
  finalWinPercent: number;
  postDisadvantageMetrics: QualityMetrics;
  firstFiveMetrics: QualityMetrics;
  firstHopelessPly: number | null;
  ownMovesAfterHopeless: number;
  firstBlunderPly: number | null;
  postBlunderMetrics: QualityMetrics;
  errorCascade: boolean | null;
};

export type TimeMetrics = {
  timedMoves: number;
  totalSeconds: number;
  finalClock: number | null;
  quickMetrics: QualityMetrics;
  longMetrics: QualityMetrics;
  lowTime60Metrics: QualityMetrics;
  lowTime30Metrics: QualityMetrics;
  lowTime10Metrics: QualityMetrics;
  quickErrors: number;
  phaseTime: Record<GamePhase, { moves: number; totalSeconds: number }>;
};

export type OpeningMetrics = {
  family: string;
  line: string;
  metrics: QualityMetrics;
  exitWinPercent: number;
  firstErrorPly: number | null;
  firstErrorSan: string | null;
};

export type TacticalMotif =
  | 'missedCheck'
  | 'missedCapture'
  | 'materialLoss'
  | 'kingSafety'
  | 'promotion';

export type CriticalMoment = {
  ply: number;
  san: string;
  winPercentLoss: number;
  phase: GamePhase;
  bestMove: string | null;
  motif: TacticalMotif | 'other';
};

export type TacticalMetrics = {
  motifs: Record<TacticalMotif, { count: number; totalWinPercentLoss: number }>;
  criticalMoments: CriticalMoment[];
};

export type CenterType = 'open' | 'closed' | 'mixed';

export type PositionalMetrics = {
  earlyQueenMoves: number;
  undevelopedPiecesAt10: number;
  uncastledAt15: boolean | null;
  doubledPawnMetrics: QualityMetrics;
  centerType: CenterType;
};

export type EndgameType = 'pawn' | 'rook' | 'minor' | 'queen' | 'mixed';

export type EndgameMetrics = {
  type: EndgameType | null;
  startWinPercent: number | null;
  startPly: number | null;
};

export type QualityGame = {
  gameId: string;
  playedAt: number;
  speed: GameSpeed | null;
  result: '0-1' | '1-0' | '1/2-1/2';
  white: string;
  black: string;
  whiteRating: number | null;
  blackRating: number | null;
  rated: boolean;
  termination: string | null;
  sessionGameNumber: number;
  previousGameId: string | null;
  metrics: { white: QualityMetrics; black: QualityMetrics };
  phaseMetrics: { white: PhaseMetrics; black: PhaseMetrics };
  queenlessMetrics: { white: QualityMetrics; black: QualityMetrics };
  openingExitWinPercent: { white: number | null; black: number | null };
  advantage: { white: AdvantageMetrics; black: AdvantageMetrics };
  defense: { white: DefenseMetrics; black: DefenseMetrics };
  time: { white: TimeMetrics; black: TimeMetrics };
  opening: { white: OpeningMetrics; black: OpeningMetrics };
  tactical: { white: TacticalMetrics; black: TacticalMetrics };
  positional: { white: PositionalMetrics; black: PositionalMetrics };
  endgame: { white: EndgameMetrics; black: EndgameMetrics };
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

export type ConversionBand = {
  threshold: 65 | 80 | 95;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  conversionRate: number | null;
};

export type AdvantageOverview = {
  bands: ConversionBand[];
  winningPositions: number;
  convertedGames: number;
  squanderedGames: number;
  squanderedDraws: number;
  squanderedLosses: number;
  cleanConversionRate: number | null;
  averagePeakInLosses: number | null;
  firstFiveAccuracy: number | null;
  firstFiveWinPercentLoss: number | null;
  firstFiveMoves: number;
  postAdvantageSeriousErrorsPer100: number | null;
  averageFirstWinningMove: number | null;
};

export type DefenseBand = {
  threshold: 35 | 20 | 5;
  games: number;
  saved: number;
  wins: number;
  draws: number;
  losses: number;
  saveRate: number | null;
};

export type DefenseOverview = {
  bands: DefenseBand[];
  losingPositions: number;
  savedGames: number;
  savedWins: number;
  savedDraws: number;
  recoveryRate: number | null;
  averageResistanceMoves: number | null;
  averageFirstLosingMove: number | null;
  firstFiveAccuracy: number | null;
  firstFiveWinPercentLoss: number | null;
  firstFiveMoves: number;
  postDisadvantageSeriousErrorsPer100: number | null;
  blunderedGames: number;
  errorCascadeRate: number | null;
  postBlunderAccuracy: number | null;
  postBlunderWinPercentLoss: number | null;
  postBlunderMoves: number;
  lossesWithChances: number;
  hopelessGames: number;
  prolongedHopelessGames: number;
};

export function resultFor(game: QualityGame, username: string): GameResult {
  if (game.result === '1/2-1/2') return 'draw';
  const playerIsWhite = game.white.toLowerCase() === username.toLowerCase();
  return (playerIsWhite && game.result === '1-0')
    || (!playerIsWhite && game.result === '0-1')
    ? 'win'
    : 'loss';
}

export function playerColor(game: QualityGame, username: string) {
  if (game.white.toLowerCase() === username.toLowerCase()) return 'white' as const;
  if (game.black.toLowerCase() === username.toLowerCase()) return 'black' as const;
  return null;
}

export function selectGames(games: QualityGame[], username: string, filters: QualityFilters) {
  return games.flatMap((game) => {
    if (filters.from !== undefined && game.playedAt < filters.from) return [];
    if (filters.to !== undefined && game.playedAt >= filters.to) return [];
    if (filters.speed && game.speed !== filters.speed) return [];
    if (filters.result && resultFor(game, username) !== filters.result) return [];
    const color = playerColor(game, username);
    return color ? [{ game, color }] : [];
  });
}

export function aggregateMetrics(metricsList: QualityMetrics[]) {
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

export function summarizeAdvantage(
  games: QualityGame[],
  username: string,
  filters: QualityFilters,
): AdvantageOverview {
  const selected = selectGames(games, username, filters);
  const bands = ([65, 80, 95] as const).map((threshold): ConversionBand => {
    const reached = selected.filter(({ game, color }) => (
      game.advantage[color].maxWinPercent >= threshold
    ));
    const results = reached.map(({ game }) => resultFor(game, username));
    const wins = results.filter((result) => result === 'win').length;
    const draws = results.filter((result) => result === 'draw').length;
    const losses = results.filter((result) => result === 'loss').length;
    return {
      threshold,
      games: reached.length,
      wins,
      draws,
      losses,
      conversionRate: reached.length > 0 ? wins / reached.length * 100 : null,
    };
  });
  const winning = selected.filter(({ game, color }) => (
    game.advantage[color].maxWinPercent >= 80
  ));
  const converted = winning.filter(({ game }) => resultFor(game, username) === 'win');
  const squanderedDraws = winning.filter(({ game }) => resultFor(game, username) === 'draw').length;
  const squanderedLosses = winning.filter(({ game }) => resultFor(game, username) === 'loss').length;
  const cleanConversions = converted.filter(({ game, color }) => {
    const metrics = game.advantage[color].postAdvantageMetrics;
    return metrics.mistakes + metrics.blunders === 0;
  });
  const losses = selected.filter(({ game }) => resultFor(game, username) === 'loss');
  const peakInLosses = losses.map(({ game, color }) => game.advantage[color].maxWinPercent);
  const firstFive = aggregateMetrics(
    winning.map(({ game, color }) => game.advantage[color].firstFiveMetrics),
  );
  const postAdvantage = aggregateMetrics(
    winning.map(({ game, color }) => game.advantage[color].postAdvantageMetrics),
  );
  const firstWinningPlies = winning
    .map(({ game, color }) => game.advantage[color].firstWinningPly)
    .filter((ply): ply is number => ply !== null);

  return {
    bands,
    winningPositions: winning.length,
    convertedGames: converted.length,
    squanderedGames: squanderedDraws + squanderedLosses,
    squanderedDraws,
    squanderedLosses,
    cleanConversionRate: converted.length > 0
      ? cleanConversions.length / converted.length * 100
      : null,
    averagePeakInLosses: peakInLosses.length > 0
      ? peakInLosses.reduce((sum, value) => sum + value, 0) / peakInLosses.length
      : null,
    firstFiveAccuracy: firstFive.accuracyPerMove,
    firstFiveWinPercentLoss: firstFive.winPercentLossPerMove,
    firstFiveMoves: firstFive.moves,
    postAdvantageSeriousErrorsPer100: postAdvantage.seriousErrorsPer100,
    averageFirstWinningMove: firstWinningPlies.length > 0
      ? firstWinningPlies.reduce((sum, ply) => sum + Math.ceil(ply / 2), 0)
        / firstWinningPlies.length
      : null,
  };
}

export function summarizeDefense(
  games: QualityGame[],
  username: string,
  filters: QualityFilters,
): DefenseOverview {
  const selected = selectGames(games, username, filters);
  const bands = ([35, 20, 5] as const).map((threshold): DefenseBand => {
    const reached = selected.filter(({ game, color }) => (
      game.defense[color].minWinPercent <= threshold
    ));
    const results = reached.map(({ game }) => resultFor(game, username));
    const wins = results.filter((result) => result === 'win').length;
    const draws = results.filter((result) => result === 'draw').length;
    const losses = results.filter((result) => result === 'loss').length;
    const saved = wins + draws;
    return {
      threshold,
      games: reached.length,
      saved,
      wins,
      draws,
      losses,
      saveRate: reached.length > 0 ? saved / reached.length * 100 : null,
    };
  });
  const losing = selected.filter(({ game, color }) => (
    game.defense[color].minWinPercent <= 20
  ));
  const saved = losing.filter(({ game }) => resultFor(game, username) !== 'loss');
  const recovered = losing.filter(({ game, color }) => (
    (game.defense[color].bestRecoveryWinPercent ?? 0) >= 45
  ));
  const resistanceMoves = losing.map(({ game, color }) => (
    game.defense[color].postDisadvantageMetrics.moves
  ));
  const firstLosingPlies = losing
    .map(({ game, color }) => game.defense[color].firstLosingPly)
    .filter((ply): ply is number => ply !== null);
  const firstFive = aggregateMetrics(
    losing.map(({ game, color }) => game.defense[color].firstFiveMetrics),
  );
  const postDisadvantage = aggregateMetrics(
    losing.map(({ game, color }) => game.defense[color].postDisadvantageMetrics),
  );
  const afterBlunder = selected.filter(({ game, color }) => (
    game.defense[color].firstBlunderPly !== null
  ));
  const resilienceSamples = afterBlunder.filter(({ game, color }) => (
    game.defense[color].postBlunderMetrics.moves > 0
  ));
  const postBlunder = aggregateMetrics(
    resilienceSamples.map(({ game, color }) => game.defense[color].postBlunderMetrics),
  );
  const errorCascades = resilienceSamples.filter(({ game, color }) => (
    game.defense[color].errorCascade === true
  )).length;
  const lossesWithChances = selected.filter(({ game, color }) => (
    resultFor(game, username) === 'loss'
    && game.defense[color].finalWinPercent >= 10
  )).length;
  const hopeless = selected.filter(({ game, color }) => (
    game.defense[color].firstHopelessPly !== null
  ));

  return {
    bands,
    losingPositions: losing.length,
    savedGames: saved.length,
    savedWins: saved.filter(({ game }) => resultFor(game, username) === 'win').length,
    savedDraws: saved.filter(({ game }) => resultFor(game, username) === 'draw').length,
    recoveryRate: losing.length > 0 ? recovered.length / losing.length * 100 : null,
    averageResistanceMoves: resistanceMoves.length > 0
      ? resistanceMoves.reduce((sum, value) => sum + value, 0) / resistanceMoves.length
      : null,
    averageFirstLosingMove: firstLosingPlies.length > 0
      ? firstLosingPlies.reduce((sum, ply) => sum + Math.ceil(ply / 2), 0)
        / firstLosingPlies.length
      : null,
    firstFiveAccuracy: firstFive.accuracyPerMove,
    firstFiveWinPercentLoss: firstFive.winPercentLossPerMove,
    firstFiveMoves: firstFive.moves,
    postDisadvantageSeriousErrorsPer100: postDisadvantage.seriousErrorsPer100,
    blunderedGames: resilienceSamples.length,
    errorCascadeRate: resilienceSamples.length > 0
      ? errorCascades / resilienceSamples.length * 100
      : null,
    postBlunderAccuracy: postBlunder.accuracyPerMove,
    postBlunderWinPercentLoss: postBlunder.winPercentLossPerMove,
    postBlunderMoves: postBlunder.moves,
    lossesWithChances,
    hopelessGames: hopeless.length,
    prolongedHopelessGames: hopeless.filter(({ game, color }) => (
      game.defense[color].ownMovesAfterHopeless >= 10
    )).length,
  };
}

export async function loadStatisticsIndex() {
  const response = await fetch(STATISTICS_URL);
  if (!response.ok) throw new Error('Индекс статистики не найден. Перезапустите приложение.');
  const value = await response.json() as StatisticsIndex;
  if (
    value.schemaVersion !== 5
    || value.engine?.version !== STOCKFISH_VERSION
    || value.engine?.depth !== STOCKFISH_DEPTH
    || !Array.isArray(value.games)
  ) {
    throw new Error('Индекс статистики устарел. Перезапустите приложение.');
  }
  return value;
}
