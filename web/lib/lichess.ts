const pgnFiles = import.meta.glob('../../pgn/*.pgn', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

export type GameSpeed = 'bullet' | 'blitz' | 'rapid';
export type GameResult = 'draw' | 'loss' | 'win';

export type GameRow = {
  id: string;
  playedAt: number;
  control: string;
  opponent: string;
  ratingDiff: number | null;
  result: 'Победа' | 'Поражение' | 'Ничья';
};

export type GamesPage = {
  games: GameRow[];
  page: number;
  hasNext: boolean;
};

type ParsedGame = GameRow & {
  speed?: GameSpeed;
  resultKey: GameResult;
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

function parsePgn(source: string, username: string): ParsedGame[] {
  return source
    .trim()
    .split(/\r?\n\r?\n(?=\[Event )/)
    .map(parseTags)
    .filter((tags) => tags.Event && tags.White && tags.Black && tags.Result)
    .map((tags) => {
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
  options: { page: number; speed?: GameSpeed; result?: GameResult },
): GamesPage {
  const page = Math.max(1, options.page);
  const filteredGames = gamesFor(username).filter((game) => {
    const matchesSpeed = !options.speed || game.speed === options.speed;
    const matchesResult = !options.result || game.resultKey === options.result;
    return matchesSpeed && matchesResult;
  });
  const start = (page - 1) * PAGE_SIZE;

  return {
    games: filteredGames.slice(start, start + PAGE_SIZE),
    page,
    hasNext: filteredGames.length > start + PAGE_SIZE,
  };
}
