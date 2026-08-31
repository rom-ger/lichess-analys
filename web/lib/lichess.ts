import { Chess } from 'chess.js';

const pgnFiles = import.meta.glob('../../pgn/*.pgn', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

export type GameSpeed = 'bullet' | 'blitz' | 'rapid';
export type GameResult = 'draw' | 'loss' | 'win';

export type PositionEvaluation =
  | { kind: 'centipawns'; value: number }
  | { kind: 'mate'; value: number };

export type MoveJudgement = 'inaccuracy' | 'mistake' | 'blunder';

export type GameRow = {
  id: string;
  playedAt: number;
  control: string;
  opponent: string;
  ratingDiff: number | null;
  result: 'Победа' | 'Поражение' | 'Ничья';
};

export type GameMove = {
  ply: number;
  san: string;
  from: string;
  to: string;
  fen: string;
  clockSeconds: number | null;
  whiteClockSeconds: number | null;
  blackClockSeconds: number | null;
  materialBalance: number;
  evaluation: PositionEvaluation | null;
  judgement: MoveJudgement | null;
  winPercentLoss: number | null;
};

export type GamePlayer = {
  name: string;
  rating: number | null;
};

export type GameDetails = GameRow & {
  white: GamePlayer;
  black: GamePlayer;
  playerColor: 'white' | 'black';
  initialFen: string;
  initialClockSeconds: number | null;
  initialMaterialBalance: number;
  initialEvaluation: PositionEvaluation;
  moves: GameMove[];
  siteUrl?: string;
  termination?: string;
};

export type GamesPage = {
  games: GameRow[];
  page: number;
  hasNext: boolean;
  total: number;
};

type ParsedGame = GameRow & {
  speed?: GameSpeed;
  resultKey: GameResult;
  tags: Record<string, string>;
  pgn: string;
};

const PAGE_SIZE = 20;

function parseTags(gamePgn: string) {
  const header = gamePgn.split(/\r?\n\r?\n/, 1)[0];
  const tags: Record<string, string> = {};

  for (const match of header.matchAll(/^\[([A-Za-z0-9_]+) "(.*)"\]$/gm)) {
    tags[match[1]] = match[2].replaceAll('\\"', '"');
  }

  return tags;
}

function speedFromTags(tags: Record<string, string>): GameSpeed | undefined {
  const event = (tags.Event ?? '').toLowerCase();
  if (event.includes('bullet') || event.includes('пуля')) return 'bullet';
  if (event.includes('blitz') || event.includes('блиц')) return 'blitz';
  if (event.includes('rapid') || event.includes('рапид')) return 'rapid';
  return undefined;
}

function formatControl(timeControl: string | undefined) {
  if (!timeControl || timeControl === '-') return 'Переписка';

  const [initialSeconds, increment = '0'] = timeControl.split('+');
  const minutes = Number(initialSeconds) / 60;
  const initial = Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
  return `${initial}+${increment}`;
}

function resultFromTags(tags: Record<string, string>, username: string): GameResult {
  if (tags.Result === '1/2-1/2') return 'draw';

  const playerIsWhite = tags.White?.toLowerCase() === username.toLowerCase();
  const playerWon = (playerIsWhite && tags.Result === '1-0')
    || (!playerIsWhite && tags.Result === '0-1');
  return playerWon ? 'win' : 'loss';
}

function parsePlayedAt(tags: Record<string, string>) {
  const date = (tags.UTCDate ?? tags.Date ?? '').replaceAll('.', '-');
  const time = tags.UTCTime ?? '00:00:00';
  const timestamp = Date.parse(`${date}T${time}Z`);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function ratingDiffFromTags(tags: Record<string, string>, playerIsWhite: boolean) {
  const rawRatingDiff = playerIsWhite
    ? tags.WhiteRatingDiff
    : tags.BlackRatingDiff;
  const ratingDiff = Number(rawRatingDiff);
  return rawRatingDiff && Number.isFinite(ratingDiff) ? ratingDiff : null;
}

function ratingFromTag(value: string | undefined) {
  const rating = Number(value);
  return value && Number.isFinite(rating) ? rating : null;
}

function initialClockFromTag(value: string | undefined) {
  if (!value || value === '-') return null;
  const initialSeconds = Number(value.split('+')[0]);
  return Number.isFinite(initialSeconds) ? initialSeconds : null;
}

function clockFromComment(comment: string | undefined) {
  const match = comment?.match(/\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/);
  if (!match) return null;

  const [, hours, minutes, seconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

function evaluationFromComment(comment: string | undefined): PositionEvaluation | null {
  const match = comment?.match(/\[%eval\s+([+-]?(?:#-?\d+|\d+(?:\.\d+)?))\]/);
  if (!match) return null;

  const rawEvaluation = match[1];
  if (rawEvaluation.includes('#')) {
    const value = Number(rawEvaluation.replace('#', ''));
    return Number.isFinite(value) ? { kind: 'mate', value } : null;
  }

  const value = Number(rawEvaluation) * 100;
  return Number.isFinite(value) ? { kind: 'centipawns', value: Math.round(value) } : null;
}

export function evaluationToWhiteWinPercent(evaluation: PositionEvaluation) {
  const centipawns = evaluation.kind === 'mate'
    ? Math.sign(evaluation.value || -1) * 1000
    : Math.max(-1000, Math.min(1000, evaluation.value));
  const winningChances = 2 / (1 + Math.exp(-0.00368208 * centipawns)) - 1;
  return 50 + 50 * winningChances;
}

export function classifyMove(
  before: PositionEvaluation | null,
  after: PositionEvaluation | null,
  mover: 'white' | 'black',
) {
  if (!before || !after) {
    return { judgement: null, winPercentLoss: null };
  }

  const beforeWhite = evaluationToWhiteWinPercent(before);
  const afterWhite = evaluationToWhiteWinPercent(after);
  const beforeMover = mover === 'white' ? beforeWhite : 100 - beforeWhite;
  const afterMover = mover === 'white' ? afterWhite : 100 - afterWhite;
  const winPercentLoss = Math.max(0, beforeMover - afterMover);
  const judgement: MoveJudgement | null = winPercentLoss >= 30
    ? 'blunder'
    : winPercentLoss >= 20
      ? 'mistake'
      : winPercentLoss >= 10
        ? 'inaccuracy'
        : null;

  return { judgement, winPercentLoss };
}

function materialBalanceFromFen(fen: string) {
  const pieceValues: Record<string, number> = {
    p: 1,
    n: 3,
    b: 3,
    r: 5,
    q: 9,
  };

  return [...fen.split(' ')[0]].reduce((balance, piece) => {
    const value = pieceValues[piece.toLowerCase()] ?? 0;
    if (value === 0) return balance;
    return piece === piece.toUpperCase() ? balance + value : balance - value;
  }, 0);
}

function parsePgn(source: string, username: string): ParsedGame[] {
  return source
    .trim()
    .split(/\r?\n\r?\n(?=\[Event )/)
    .map((pgn) => ({ pgn, tags: parseTags(pgn) }))
    .filter(({ tags }) => tags.Event && tags.White && tags.Black && tags.Result)
    .map(({ pgn, tags }) => {
      const playerIsWhite = tags.White.toLowerCase() === username.toLowerCase();
      const opponent = playerIsWhite ? tags.Black : tags.White;
      const resultKey = resultFromTags(tags, username);
      const result: GameRow['result'] = resultKey === 'draw'
        ? 'Ничья'
        : resultKey === 'win'
          ? 'Победа'
          : 'Поражение';

      return {
        id: tags.GameId ?? tags.Site?.split('/').at(-1) ?? crypto.randomUUID(),
        playedAt: parsePlayedAt(tags),
        control: formatControl(tags.TimeControl),
        opponent: opponent === 'Anonymous' ? 'Анонимный игрок' : opponent,
        ratingDiff: ratingDiffFromTags(tags, playerIsWhite),
        result,
        resultKey,
        speed: speedFromTags(tags),
        tags,
        pgn,
      };
    })
    .sort((first, second) => second.playedAt - first.playedAt);
}

const gamesByUsername = new Map<string, ParsedGame[]>();

function gamesFor(username: string) {
  const cacheKey = username.toLowerCase();
  const cached = gamesByUsername.get(cacheKey);
  if (cached) return cached;

  const uniqueGames = new Map<string, ParsedGame>();

  for (const source of Object.values(pgnFiles)) {
    for (const game of parsePgn(source, username)) {
      uniqueGames.set(game.id, game);
    }
  }

  const games = [...uniqueGames.values()]
    .sort((first, second) => second.playedAt - first.playedAt);
  gamesByUsername.set(cacheKey, games);
  return games;
}

export function getRecentGames(
  username: string,
  options: {
    page: number;
    speed?: GameSpeed;
    result?: GameResult;
    from?: number;
    to?: number;
  },
): GamesPage {
  const page = Math.max(1, options.page);
  const filteredGames = gamesFor(username).filter((game) => {
    const matchesSpeed = !options.speed || game.speed === options.speed;
    const matchesResult = !options.result || game.resultKey === options.result;
    const matchesFrom = options.from === undefined || game.playedAt >= options.from;
    const matchesTo = options.to === undefined || game.playedAt < options.to;
    return matchesSpeed && matchesResult && matchesFrom && matchesTo;
  });
  const start = (page - 1) * PAGE_SIZE;

  return {
    games: filteredGames.slice(start, start + PAGE_SIZE),
    page,
    hasNext: filteredGames.length > start + PAGE_SIZE,
    total: filteredGames.length,
  };
}

export function getGameById(username: string, id: string): GameDetails | undefined {
  const game = gamesFor(username).find((candidate) => candidate.id === id);
  if (!game) return undefined;

  const chess = new Chess();
  chess.loadPgn(game.pgn);
  const history = chess.history({ verbose: true });
  const initialFen = history[0]?.before ?? new Chess().fen();
  const initialClockSeconds = initialClockFromTag(game.tags.TimeControl);
  const initialEvaluation: PositionEvaluation = { kind: 'centipawns', value: 15 };
  const commentsByFen = new Map(
    chess.getComments().map(({ fen, comment }) => [fen, comment]),
  );
  let whiteClockSeconds = initialClockSeconds;
  let blackClockSeconds = initialClockSeconds;
  let previousEvaluation: PositionEvaluation | null = initialEvaluation;
  const moves = history.map((move, index): GameMove => {
    const comment = commentsByFen.get(move.after);
    const clockSeconds = clockFromComment(comment);
    const evaluation = evaluationFromComment(comment);
    const { judgement, winPercentLoss } = classifyMove(
      previousEvaluation,
      evaluation,
      move.color === 'w' ? 'white' : 'black',
    );
    if (move.color === 'w' && clockSeconds !== null) whiteClockSeconds = clockSeconds;
    if (move.color === 'b' && clockSeconds !== null) blackClockSeconds = clockSeconds;
    previousEvaluation = evaluation;

    return {
      ply: index + 1,
      san: move.san,
      from: move.from,
      to: move.to,
      fen: move.after,
      clockSeconds,
      whiteClockSeconds,
      blackClockSeconds,
      materialBalance: materialBalanceFromFen(move.after),
      evaluation,
      judgement,
      winPercentLoss,
    };
  });

  return {
    id: game.id,
    playedAt: game.playedAt,
    control: game.control,
    opponent: game.opponent,
    ratingDiff: game.ratingDiff,
    result: game.result,
    white: {
      name: game.tags.White,
      rating: ratingFromTag(game.tags.WhiteElo),
    },
    black: {
      name: game.tags.Black,
      rating: ratingFromTag(game.tags.BlackElo),
    },
    playerColor: game.tags.White.toLowerCase() === username.toLowerCase()
      ? 'white'
      : 'black',
    initialFen,
    initialClockSeconds,
    initialMaterialBalance: materialBalanceFromFen(initialFen),
    initialEvaluation,
    moves,
    siteUrl: game.tags.Site,
    termination: game.tags.Termination,
  };
}
