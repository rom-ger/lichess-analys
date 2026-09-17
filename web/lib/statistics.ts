import type { GameResult, GameSpeed } from './lichess';
import { STOCKFISH_DEPTH, STOCKFISH_VERSION } from './stockfish';
import type { PeriodMetrics } from './period-summary';

const STATISTICS_SCHEMA_VERSION = 14;
const STATISTICS_URL = `/analysis/stockfish-${STOCKFISH_VERSION}-depth-${STOCKFISH_DEPTH}/statistics.json?v=${STATISTICS_SCHEMA_VERSION}`;

export type AnalysisFilters = {
  from?: number;
  to?: number;
  speed?: GameSpeed;
  result?: GameResult;
};

export type PlayerColor = 'white' | 'black';
export type BadUntil = 'gameEnd' | 'opponentBlunder';
export type OpeningErrorType = 'material' | 'king-safety' | 'development' | 'pawn-structure' | 'other';
export type OpeningErrorTheme = {
  type: OpeningErrorType;
  evidence: string;
  lineSan: string[];
};

export type LostOpening = {
  themes: OpeningErrorTheme[];
  beforeEvaluation: number;
  positionKey: string;
  fen: string;
  ply: number;
  moveNumber: number;
  playedMove: string;
  bestMove: string | null;
  evaluationLoss: number;
  afterEvaluation: number;
  badUntil: BadUntil;
  badUntilPly: number;
  opponentBlunderMove: string | null;
};

export type EndgameType =
  | 'pawn-opposite-wings'
  | 'pawn-both-wings'
  | 'pawn-one-wing'
  | 'rook-one-each'
  | 'rook-two-each'
  | 'rook-unbalanced'
  | 'rook-with-minors'
  | 'bishop-same-color'
  | 'bishop-opposite-color'
  | 'bishop'
  | 'knight'
  | 'bishop-vs-knight'
  | 'minor-mixed'
  | 'queen'
  | 'queen-mixed';

export type DecisiveEndgameError = {
  badUntil: BadUntil;
  badUntilPly: number;
  opponentBlunderMove: string | null;
  type: EndgameType;
  fen: string;
  ply: number;
  moveNumber: number;
  playedMove: string;
  bestMove: string | null;
  beforeEvaluation: number;
  afterEvaluation: number;
  evaluationLoss: number;
};

export type StatisticsGame = {
  gameId: string;
  playedAt: number;
  speed: GameSpeed | null;
  result: '0-1' | '1-0' | '1/2-1/2';
  white: string;
  black: string;
  lostOpening: Record<PlayerColor, LostOpening | null>;
  decisiveEndgame: Record<PlayerColor, DecisiveEndgameError | null>;
  periodMetrics: PeriodMetrics;
};

export type StatisticsIndex = {
  schemaVersion: number;
  engine: { name: string; version: string; depth: number };
  generatedAt: string;
  opening: {
    plies: number;
    earlyFullMoves: number;
    developedMinors: number;
    notLostMinEvaluation: number;
    lostMaxEvaluation: number;
    opponentBlunderLoss: number;
  };
  endgame: {
    opponentBlunderLoss: number;
    notLostMinEvaluation: number;
    lostMaxEvaluation: number;
  };
  games: StatisticsGame[];
};

export type LostOpeningExample = LostOpening & {
  color: PlayerColor;
  gameId: string;
  playedAt: number;
  opponent: string;
};

export type OpeningErrorGroup = {
  type: OpeningErrorType;
  examples: LostOpeningExample[];
};

export type LostOpeningsSummary = {
  selectedGames: number;
  gamesWithLostOpening: number;
  groups: OpeningErrorGroup[];
};

export type DecisiveEndgameExample = DecisiveEndgameError & {
  gameId: string;
  playedAt: number;
  opponent: string;
  color: PlayerColor;
};

export type DecisiveEndgameGroup = {
  type: EndgameType;
  examples: DecisiveEndgameExample[];
};

export type DecisiveEndgamesSummary = {
  selectedGames: number;
  gamesWithDecisiveError: number;
  groups: DecisiveEndgameGroup[];
};

type SelectedGame = {
  game: StatisticsGame;
  color: PlayerColor;
};

export function playerColor(game: StatisticsGame, username: string): PlayerColor | null {
  const normalizedUsername = username.toLowerCase();
  if (game.white.toLowerCase() === normalizedUsername) return 'white';
  if (game.black.toLowerCase() === normalizedUsername) return 'black';
  return null;
}

export function resultFor(game: StatisticsGame, username: string): GameResult {
  if (game.result === '1/2-1/2') return 'draw';
  const color = playerColor(game, username);
  if (!color) return 'loss';
  const won = (color === 'white' && game.result === '1-0')
    || (color === 'black' && game.result === '0-1');
  return won ? 'win' : 'loss';
}

export function formatCentipawnEvaluation(value: number) {
  if (Math.abs(value) >= 90_000) {
    const mateDistance = Math.max(1, Math.round((100_000 - Math.abs(value)) / 100));
    return `${value > 0 ? '+' : '−'}M${mateDistance}`;
  }
  const pawns = value / 100;
  if (Math.abs(pawns) < 0.005) return '0.00';
  return `${pawns > 0 ? '+' : '−'}${Math.abs(pawns).toFixed(2)}`;
}

function selectGames(
  games: StatisticsGame[],
  username: string,
  filters: AnalysisFilters,
): SelectedGame[] {
  return games.flatMap((game) => {
    const color = playerColor(game, username);
    if (!color) return [];
    if (filters.from !== undefined && game.playedAt < filters.from) return [];
    if (filters.to !== undefined && game.playedAt >= filters.to) return [];
    if (filters.speed && game.speed !== filters.speed) return [];
    if (filters.result && resultFor(game, username) !== filters.result) return [];
    return [{ game, color }];
  });
}

export function summarizeLostOpenings(
  games: StatisticsGame[],
  username: string,
  filters: AnalysisFilters,
): LostOpeningsSummary {
  const selected = selectGames(games, username, filters);
  const groups = new Map<OpeningErrorType, Map<string, LostOpeningExample>>();
  const gameIds = new Set<string>();

  for (const { game, color } of selected) {
    const opening = game.lostOpening[color];
    if (!opening) continue;

    gameIds.add(game.gameId);
    const example: LostOpeningExample = {
      ...opening,
      color,
      gameId: game.gameId,
      playedAt: game.playedAt,
      opponent: color === 'white' ? game.black : game.white,
    };
    for (const type of new Set(opening.themes.map((theme) => theme.type))) {
      const examples = groups.get(type) ?? new Map<string, LostOpeningExample>();
      examples.set(game.gameId, example);
      groups.set(type, examples);
    }
  }

  const ranked = [...groups.entries()]
    .map(([type, examples]): OpeningErrorGroup => ({
      type,
      examples: [...examples.values()].sort((a, b) => b.playedAt - a.playedAt || a.gameId.localeCompare(b.gameId)),
    }))
    .sort((first, second) => (
      second.examples.length - first.examples.length || first.type.localeCompare(second.type)
    ));

  return {
    selectedGames: selected.length,
    gamesWithLostOpening: gameIds.size,
    groups: ranked,
  };
}

export function summarizeDecisiveEndgames(
  games: StatisticsGame[],
  username: string,
  filters: AnalysisFilters,
): DecisiveEndgamesSummary {
  const selected = selectGames(games, username, filters);
  const groups = new Map<EndgameType, DecisiveEndgameExample[]>();

  for (const { game, color } of selected) {
    const error = game.decisiveEndgame[color];
    if (!error) continue;
    const examples = groups.get(error.type) ?? [];
    examples.push({
      ...error,
      gameId: game.gameId,
      playedAt: game.playedAt,
      opponent: color === 'white' ? game.black : game.white,
      color,
    });
    groups.set(error.type, examples);
  }

  const grouped = [...groups.entries()]
    .map(([type, examples]) => ({
      type,
      examples: examples.sort((first, second) => second.playedAt - first.playedAt),
    }))
    .sort((first, second) => (
      second.examples.length - first.examples.length
      || first.type.localeCompare(second.type)
    ));

  return {
    selectedGames: selected.length,
    gamesWithDecisiveError: grouped.reduce((sum, group) => sum + group.examples.length, 0),
    groups: grouped,
  };
}

let statisticsRequest: Promise<StatisticsIndex> | null = null;

export function loadStatisticsIndex() {
  if (!statisticsRequest) {
    statisticsRequest = (async () => {
      const response = await fetch(STATISTICS_URL);
      if (!response.ok) throw new Error('Индекс анализа не найден. Перезапустите приложение.');
      const value = await response.json() as StatisticsIndex;
      if (
        value.schemaVersion !== STATISTICS_SCHEMA_VERSION
        || value.engine?.version !== STOCKFISH_VERSION
        || value.engine?.depth !== STOCKFISH_DEPTH
        || !Array.isArray(value.games)
      ) {
        throw new Error('Индекс анализа устарел. Перезапустите приложение.');
      }
      return value;
    })().catch((error: unknown) => {
      statisticsRequest = null;
      throw error;
    });
  }
  return statisticsRequest;
}
