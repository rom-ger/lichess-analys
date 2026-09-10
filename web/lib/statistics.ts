import type { GameResult, GameSpeed } from './lichess';
import { STOCKFISH_DEPTH, STOCKFISH_VERSION } from './stockfish';

const STATISTICS_SCHEMA_VERSION = 8;
const STATISTICS_URL = `/analysis/stockfish-${STOCKFISH_VERSION}-depth-${STOCKFISH_DEPTH}/statistics.json?v=${STATISTICS_SCHEMA_VERSION}`;

export type AnalysisFilters = {
  from?: number;
  to?: number;
  speed?: GameSpeed;
  result?: GameResult;
};

export type PlayerColor = 'white' | 'black';
export type BadUntil = 'gameEnd' | 'opponentBlunder';

export type LostOpening = {
  positionKey: string;
  fen: string;
  ply: number;
  moveNumber: number;
  playedMove: string;
  bestMove: string | null;
  winPercentLoss: number;
  afterWinPercent: number;
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
  type: EndgameType;
  fen: string;
  ply: number;
  moveNumber: number;
  playedMove: string;
  bestMove: string | null;
  beforeWinPercent: number;
  afterWinPercent: number;
  winPercentLoss: number;
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
};

export type StatisticsIndex = {
  schemaVersion: number;
  engine: { name: string; version: string; depth: number };
  generatedAt: string;
  opening: {
    plies: number;
    minimumWinPercentLoss: number;
    badPositionMaxWinPercent: number;
    recoveredPositionMinWinPercent: number;
    opponentBlunderLoss: number;
  };
  endgame: {
    notLostMinWinPercent: number;
    lostMaxWinPercent: number;
  };
  games: StatisticsGame[];
};

export type LostOpeningExample = LostOpening & {
  gameId: string;
  playedAt: number;
  opponent: string;
};

export type FrequentLostOpening = {
  positionKey: string;
  fen: string;
  color: PlayerColor;
  games: number;
  averageWinPercentLoss: number;
  averageAfterWinPercent: number;
  playedMove: string;
  playedMoveCount: number;
  bestMove: string | null;
  examples: LostOpeningExample[];
};

export type LostOpeningsSummary = {
  selectedGames: number;
  lostGames: number;
  gamesWithLostOpening: number;
  positions: FrequentLostOpening[];
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
  lostGames: number;
  gamesWithDecisiveError: number;
  groups: DecisiveEndgameGroup[];
};

type SelectedGame = {
  game: StatisticsGame;
  color: PlayerColor;
};

type LostOpeningGroup = {
  positionKey: string;
  fen: string;
  color: PlayerColor;
  gameIds: Set<string>;
  totalWinPercentLoss: number;
  totalAfterWinPercent: number;
  playedMoves: Map<string, number>;
  bestMoves: Map<string, number>;
  examples: LostOpeningExample[];
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

function increment(map: Map<string, number>, key: string | null) {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + 1);
}

function mostCommon(map: Map<string, number>) {
  let best: [string, number] | null = null;
  for (const entry of map) {
    if (!best || entry[1] > best[1] || (entry[1] === best[1] && entry[0] < best[0])) {
      best = entry;
    }
  }
  return best;
}

export function summarizeLostOpenings(
  games: StatisticsGame[],
  username: string,
  filters: AnalysisFilters,
): LostOpeningsSummary {
  const selected = selectGames(games, username, filters);
  const lost = selected.filter(({ game }) => resultFor(game, username) === 'loss');
  const groups = new Map<string, LostOpeningGroup>();

  for (const { game, color } of lost) {
    const opening = game.lostOpening[color];
    if (!opening) continue;

    const opponent = color === 'white' ? game.black : game.white;
    const group = groups.get(opening.positionKey) ?? {
      positionKey: opening.positionKey,
      fen: opening.fen,
      color,
      gameIds: new Set<string>(),
      totalWinPercentLoss: 0,
      totalAfterWinPercent: 0,
      playedMoves: new Map<string, number>(),
      bestMoves: new Map<string, number>(),
      examples: [],
    };

    group.gameIds.add(game.gameId);
    group.totalWinPercentLoss += opening.winPercentLoss;
    group.totalAfterWinPercent += opening.afterWinPercent;
    increment(group.playedMoves, opening.playedMove);
    increment(group.bestMoves, opening.bestMove);
    group.examples.push({
      ...opening,
      gameId: game.gameId,
      playedAt: game.playedAt,
      opponent,
    });
    groups.set(opening.positionKey, group);
  }

  const ranked = [...groups.values()]
    .map((group): FrequentLostOpening => {
      const playedMove = mostCommon(group.playedMoves);
      const bestMove = mostCommon(group.bestMoves);
      return {
        positionKey: group.positionKey,
        fen: group.fen,
        color: group.color,
        games: group.gameIds.size,
        averageWinPercentLoss: group.totalWinPercentLoss / group.gameIds.size,
        averageAfterWinPercent: group.totalAfterWinPercent / group.gameIds.size,
        playedMove: playedMove?.[0] ?? '—',
        playedMoveCount: playedMove?.[1] ?? 0,
        bestMove: bestMove?.[0] ?? null,
        examples: group.examples.sort((first, second) => second.playedAt - first.playedAt),
      };
    })
    .sort((first, second) => (
      second.games - first.games
      || first.averageAfterWinPercent - second.averageAfterWinPercent
      || second.averageWinPercentLoss - first.averageWinPercentLoss
      || first.positionKey.localeCompare(second.positionKey)
    ));

  return {
    selectedGames: selected.length,
    lostGames: lost.length,
    gamesWithLostOpening: lost.filter(({ game, color }) => game.lostOpening[color] !== null).length,
    positions: ranked,
  };
}

export function summarizeDecisiveEndgames(
  games: StatisticsGame[],
  username: string,
  filters: AnalysisFilters,
): DecisiveEndgamesSummary {
  const selected = selectGames(games, username, filters);
  const lost = selected.filter(({ game }) => resultFor(game, username) === 'loss');
  const groups = new Map<EndgameType, DecisiveEndgameExample[]>();

  for (const { game, color } of lost) {
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
    lostGames: lost.length,
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
    })();
  }
  return statisticsRequest;
}
