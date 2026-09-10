import {
  aggregateMetrics,
  resultFor,
  selectGames,
  type CenterType,
  type EndgameType,
  type GamePhase,
  type QualityFilters,
  type QualityGame,
  type TacticalMotif,
} from './statistics';

type SelectedGame = ReturnType<typeof selectGames>[number];

function average(values: number[]) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function scorePercent(entries: SelectedGame[], username: string) {
  if (entries.length === 0) return null;
  const points = entries.reduce((sum, { game }) => {
    const result = resultFor(game, username);
    return sum + (result === 'win' ? 1 : result === 'draw' ? 0.5 : 0);
  }, 0);
  return points / entries.length * 100;
}

export type TimeBand = {
  seconds: 60 | 30 | 10;
  moves: number;
  accuracy: number | null;
  winPercentLoss: number | null;
  seriousErrorsPer100: number | null;
};

export type TimeOverview = {
  timedMoves: number;
  averageMoveSeconds: number | null;
  quickMoves: number;
  quickAccuracy: number | null;
  quickErrorRate: number | null;
  longMoves: number;
  longAccuracy: number | null;
  unusedTimeInLosses: number | null;
  bands: TimeBand[];
  phases: Array<{ phase: GamePhase; moves: number; averageSeconds: number | null }>;
};

export function summarizeTime(
  games: QualityGame[],
  username: string,
  filters: QualityFilters,
): TimeOverview {
  const selected = selectGames(games, username, filters);
  const timedMoves = selected.reduce((sum, { game, color }) => sum + game.time[color].timedMoves, 0);
  const totalSeconds = selected.reduce((sum, { game, color }) => sum + game.time[color].totalSeconds, 0);
  const quick = aggregateMetrics(selected.map(({ game, color }) => game.time[color].quickMetrics));
  const long = aggregateMetrics(selected.map(({ game, color }) => game.time[color].longMetrics));
  const quickErrors = selected.reduce((sum, { game, color }) => sum + game.time[color].quickErrors, 0);
  const losses = selected.filter(({ game }) => resultFor(game, username) === 'loss');
  const unused = losses
    .map(({ game, color }) => game.time[color].finalClock)
    .filter((value): value is number => value !== null);
  const bandMetrics = [
    [60, 'lowTime60Metrics'],
    [30, 'lowTime30Metrics'],
    [10, 'lowTime10Metrics'],
  ] as const;
  const phases: GamePhase[] = ['opening', 'middlegame', 'endgame'];

  return {
    timedMoves,
    averageMoveSeconds: timedMoves > 0 ? totalSeconds / timedMoves : null,
    quickMoves: quick.moves,
    quickAccuracy: quick.accuracyPerMove,
    quickErrorRate: quick.moves > 0 ? quickErrors / quick.moves * 100 : null,
    longMoves: long.moves,
    longAccuracy: long.accuracyPerMove,
    unusedTimeInLosses: average(unused),
    bands: bandMetrics.map(([seconds, key]) => {
      const metrics = aggregateMetrics(selected.map(({ game, color }) => game.time[color][key]));
      return {
        seconds,
        moves: metrics.moves,
        accuracy: metrics.accuracyPerMove,
        winPercentLoss: metrics.winPercentLossPerMove,
        seriousErrorsPer100: metrics.seriousErrorsPer100,
      };
    }),
    phases: phases.map((phase) => {
      const moves = selected.reduce(
        (sum, { game, color }) => sum + game.time[color].phaseTime[phase].moves,
        0,
      );
      const seconds = selected.reduce(
        (sum, { game, color }) => sum + game.time[color].phaseTime[phase].totalSeconds,
        0,
      );
      return { phase, moves, averageSeconds: moves > 0 ? seconds / moves : null };
    }),
  };
}

export type OpeningRow = {
  family: string;
  line: string;
  games: number;
  whiteGames: number;
  blackGames: number;
  score: number | null;
  accuracy: number | null;
  exitWinPercent: number | null;
  errorsPer100: number | null;
  firstErrorRate: number | null;
  averageFirstErrorMove: number | null;
};

export type OpeningOverview = {
  families: number;
  rows: OpeningRow[];
};

export function summarizeOpenings(
  games: QualityGame[],
  username: string,
  filters: QualityFilters,
): OpeningOverview {
  const selected = selectGames(games, username, filters);
  const grouped = new Map<string, SelectedGame[]>();
  for (const entry of selected) {
    const family = entry.game.opening[entry.color].family;
    grouped.set(family, [...(grouped.get(family) ?? []), entry]);
  }
  const rows = [...grouped.entries()].map(([family, entries]): OpeningRow => {
    const metrics = aggregateMetrics(entries.map(({ game, color }) => game.opening[color].metrics));
    const firstErrors = entries
      .map(({ game, color }) => game.opening[color].firstErrorPly)
      .filter((ply): ply is number => ply !== null);
    const lines = new Map<string, number>();
    for (const { game, color } of entries) {
      const line = game.opening[color].line;
      lines.set(line, (lines.get(line) ?? 0) + 1);
    }
    const line = [...lines.entries()].sort((first, second) => second[1] - first[1])[0]?.[0] ?? '';
    return {
      family,
      line,
      games: entries.length,
      whiteGames: entries.filter(({ color }) => color === 'white').length,
      blackGames: entries.filter(({ color }) => color === 'black').length,
      score: scorePercent(entries, username),
      accuracy: metrics.accuracyPerMove,
      exitWinPercent: average(entries.map(({ game, color }) => game.opening[color].exitWinPercent)),
      errorsPer100: metrics.seriousErrorsPer100,
      firstErrorRate: entries.length > 0 ? firstErrors.length / entries.length * 100 : null,
      averageFirstErrorMove: average(firstErrors.map((ply) => Math.ceil(ply / 2))),
    };
  }).sort((first, second) => second.games - first.games);
  return { families: rows.length, rows: rows.slice(0, 10) };
}

export type LossScenario =
  | 'time'
  | 'missedWin'
  | 'opening'
  | 'endgame'
  | 'cascade'
  | 'singleBlunder'
  | 'gradual';

export type LossScenarioRow = {
  scenario: LossScenario;
  games: number;
  share: number;
  averageFirstLosingMove: number | null;
  examples: string[];
};

export type LossOverview = { losses: number; rows: LossScenarioRow[] };

function lossScenario(entry: SelectedGame): LossScenario {
  const { game, color } = entry;
  if ((game.termination ?? '').toLowerCase().includes('time')) return 'time';
  if (game.advantage[color].maxWinPercent >= 80) return 'missedWin';
  const losingPly = game.defense[color].firstLosingPly;
  if (losingPly !== null && losingPly <= 24) return 'opening';
  const endgamePly = game.endgame[color].startPly;
  if (losingPly !== null && endgamePly !== null && losingPly >= endgamePly) return 'endgame';
  if (game.defense[color].errorCascade) return 'cascade';
  if (game.metrics[color].blunders === 1 && game.metrics[color].mistakes === 0) {
    return 'singleBlunder';
  }
  return 'gradual';
}

export function summarizeLosses(
  games: QualityGame[],
  username: string,
  filters: QualityFilters,
): LossOverview {
  const losses = selectGames(games, username, filters)
    .filter(({ game }) => resultFor(game, username) === 'loss');
  const order: LossScenario[] = [
    'time', 'missedWin', 'opening', 'endgame', 'cascade', 'singleBlunder', 'gradual',
  ];
  const rows = order.map((scenario): LossScenarioRow => {
    const entries = losses.filter((entry) => lossScenario(entry) === scenario);
    const firstPlies = entries
      .map(({ game, color }) => game.defense[color].firstLosingPly)
      .filter((ply): ply is number => ply !== null);
    return {
      scenario,
      games: entries.length,
      share: losses.length > 0 ? entries.length / losses.length * 100 : 0,
      averageFirstLosingMove: average(firstPlies.map((ply) => Math.ceil(ply / 2))),
      examples: entries.slice(0, 3).map(({ game }) => game.gameId),
    };
  }).filter((row) => row.games > 0).sort((first, second) => second.games - first.games);
  return { losses: losses.length, rows };
}

export type TacticalRow = {
  motif: TacticalMotif | 'other';
  count: number;
  games: number;
  totalWinPercentLoss: number;
  averageLoss: number | null;
};

export type TacticalOverview = { rows: TacticalRow[]; seriousMoments: number };

export function summarizeTactics(
  games: QualityGame[],
  username: string,
  filters: QualityFilters,
): TacticalOverview {
  const selected = selectGames(games, username, filters);
  const motifs: Array<TacticalMotif | 'other'> = [
    'missedCheck', 'missedCapture', 'materialLoss', 'kingSafety', 'promotion', 'other',
  ];
  const rows = motifs.map((motif): TacticalRow => {
    if (motif === 'other') {
      const moments = selected.flatMap(({ game, color }) => (
        game.tactical[color].criticalMoments.filter((moment) => moment.motif === 'other')
      ));
      return {
        motif,
        count: moments.length,
        games: selected.filter(({ game, color }) => (
          game.tactical[color].criticalMoments.some((moment) => moment.motif === 'other')
        )).length,
        totalWinPercentLoss: moments.reduce((sum, moment) => sum + moment.winPercentLoss, 0),
        averageLoss: average(moments.map((moment) => moment.winPercentLoss)),
      };
    }
    const count = selected.reduce((sum, { game, color }) => (
      sum + game.tactical[color].motifs[motif].count
    ), 0);
    const totalWinPercentLoss = selected.reduce((sum, { game, color }) => (
      sum + game.tactical[color].motifs[motif].totalWinPercentLoss
    ), 0);
    return {
      motif,
      count,
      games: selected.filter(({ game, color }) => game.tactical[color].motifs[motif].count > 0).length,
      totalWinPercentLoss,
      averageLoss: count > 0 ? totalWinPercentLoss / count : null,
    };
  }).filter((row) => row.count > 0)
    .sort((first, second) => second.totalWinPercentLoss - first.totalWinPercentLoss);
  return {
    rows,
    seriousMoments: selected.reduce(
      (sum, { game, color }) => sum + game.tactical[color].criticalMoments.length,
      0,
    ),
  };
}

export type CenterRow = {
  center: CenterType;
  games: number;
  score: number | null;
  accuracy: number | null;
  winPercentLoss: number | null;
};

export type PositionalOverview = {
  games: number;
  earlyQueenRate: number | null;
  delayedDevelopmentRate: number | null;
  uncastledRate: number | null;
  doubledPawnMoves: number;
  doubledPawnAccuracy: number | null;
  doubledPawnWinPercentLoss: number | null;
  centers: CenterRow[];
};

export function summarizePositionally(
  games: QualityGame[],
  username: string,
  filters: QualityFilters,
): PositionalOverview {
  const selected = selectGames(games, username, filters);
  const castlingSamples = selected.filter(({ game, color }) => (
    game.positional[color].uncastledAt15 !== null
  ));
  const doubled = aggregateMetrics(
    selected.map(({ game, color }) => game.positional[color].doubledPawnMetrics),
  );
  const centerTypes: CenterType[] = ['open', 'mixed', 'closed'];
  return {
    games: selected.length,
    earlyQueenRate: selected.length > 0
      ? selected.filter(({ game, color }) => game.positional[color].earlyQueenMoves >= 2).length
        / selected.length * 100
      : null,
    delayedDevelopmentRate: selected.length > 0
      ? selected.filter(({ game, color }) => game.positional[color].undevelopedPiecesAt10 >= 2).length
        / selected.length * 100
      : null,
    uncastledRate: castlingSamples.length > 0
      ? castlingSamples.filter(({ game, color }) => game.positional[color].uncastledAt15).length
        / castlingSamples.length * 100
      : null,
    doubledPawnMoves: doubled.moves,
    doubledPawnAccuracy: doubled.accuracyPerMove,
    doubledPawnWinPercentLoss: doubled.winPercentLossPerMove,
    centers: centerTypes.map((center): CenterRow => {
      const entries = selected.filter(({ game, color }) => game.positional[color].centerType === center);
      const metrics = aggregateMetrics(entries.map(({ game, color }) => (
        game.phaseMetrics[color].middlegame
      )));
      return {
        center,
        games: entries.length,
        score: scorePercent(entries, username),
        accuracy: metrics.accuracyPerMove,
        winPercentLoss: metrics.winPercentLossPerMove,
      };
    }).filter((row) => row.games > 0),
  };
}

export type EndgameRow = {
  type: EndgameType;
  games: number;
  score: number | null;
  accuracy: number | null;
  winPercentLoss: number | null;
  averageStartChance: number | null;
  conversionRate: number | null;
  saveRate: number | null;
};

export type EndgameOverview = {
  games: number;
  score: number | null;
  accuracy: number | null;
  rows: EndgameRow[];
};

export function summarizeEndgames(
  games: QualityGame[],
  username: string,
  filters: QualityFilters,
): EndgameOverview {
  const selected = selectGames(games, username, filters)
    .filter(({ game, color }) => game.endgame[color].type !== null);
  const types: EndgameType[] = ['rook', 'minor', 'pawn', 'queen', 'mixed'];
  const overall = aggregateMetrics(selected.map(({ game, color }) => game.phaseMetrics[color].endgame));
  const rows = types.map((type): EndgameRow => {
    const entries = selected.filter(({ game, color }) => game.endgame[color].type === type);
    const metrics = aggregateMetrics(entries.map(({ game, color }) => game.phaseMetrics[color].endgame));
    const winning = entries.filter(({ game, color }) => (game.endgame[color].startWinPercent ?? 0) >= 65);
    const worse = entries.filter(({ game, color }) => (game.endgame[color].startWinPercent ?? 100) <= 35);
    return {
      type,
      games: entries.length,
      score: scorePercent(entries, username),
      accuracy: metrics.accuracyPerMove,
      winPercentLoss: metrics.winPercentLossPerMove,
      averageStartChance: average(entries
        .map(({ game, color }) => game.endgame[color].startWinPercent)
        .filter((value): value is number => value !== null)),
      conversionRate: winning.length > 0
        ? winning.filter(({ game }) => resultFor(game, username) === 'win').length / winning.length * 100
        : null,
      saveRate: worse.length > 0
        ? worse.filter(({ game }) => resultFor(game, username) !== 'loss').length / worse.length * 100
        : null,
    };
  }).filter((row) => row.games > 0).sort((first, second) => second.games - first.games);
  return {
    games: selected.length,
    score: scorePercent(selected, username),
    accuracy: overall.accuracyPerMove,
    rows,
  };
}

export type ConditionRow = {
  label: string;
  games: number;
  score: number | null;
  accuracy: number | null;
  winPercentLoss: number | null;
};

export type ConditionSection = { id: string; title: string; rows: ConditionRow[] };
export type ConditionsOverview = { sections: ConditionSection[]; months: ConditionRow[] };

function conditionRow(label: string, entries: SelectedGame[], username: string): ConditionRow {
  const metrics = aggregateMetrics(entries.map(({ game, color }) => game.metrics[color]));
  return {
    label,
    games: entries.length,
    score: scorePercent(entries, username),
    accuracy: metrics.accuracyPerMove,
    winPercentLoss: metrics.winPercentLossPerMove,
  };
}

function moscowHour(timestamp: number) {
  return new Date(timestamp + 3 * 60 * 60 * 1_000).getUTCHours();
}

export function summarizeConditions(
  games: QualityGame[],
  username: string,
  filters: QualityFilters,
): ConditionsOverview {
  const selected = selectGames(games, username, filters);
  const byId = new Map(games.map((game) => [game.gameId, game]));
  const group = (
    id: string,
    title: string,
    definitions: Array<[string, (entry: SelectedGame) => boolean]>,
  ): ConditionSection => ({
    id,
    title,
    rows: definitions.map(([label, predicate]) => (
      conditionRow(label, selected.filter(predicate), username)
    )).filter((row) => row.games > 0),
  });
  const sections = [
    group('speed', 'Контроль времени', [
      ['Пуля', ({ game }) => game.speed === 'bullet'],
      ['Блиц', ({ game }) => game.speed === 'blitz'],
      ['Рапид', ({ game }) => game.speed === 'rapid'],
    ]),
    group('color', 'Цвет фигур', [
      ['Белые', ({ color }) => color === 'white'],
      ['Чёрные', ({ color }) => color === 'black'],
    ]),
    group('opponent', 'Сила соперника', [
      ['Сильнее на 100+', ({ game, color }) => {
        const own = color === 'white' ? game.whiteRating : game.blackRating;
        const opponent = color === 'white' ? game.blackRating : game.whiteRating;
        return own !== null && opponent !== null && opponent - own >= 100;
      }],
      ['Равный рейтинг', ({ game, color }) => {
        const own = color === 'white' ? game.whiteRating : game.blackRating;
        const opponent = color === 'white' ? game.blackRating : game.whiteRating;
        return own !== null && opponent !== null && Math.abs(opponent - own) < 100;
      }],
      ['Слабее на 100+', ({ game, color }) => {
        const own = color === 'white' ? game.whiteRating : game.blackRating;
        const opponent = color === 'white' ? game.blackRating : game.whiteRating;
        return own !== null && opponent !== null && own - opponent >= 100;
      }],
    ]),
    group('daytime', 'Время суток · МСК', [
      ['Утро', ({ game }) => moscowHour(game.playedAt) >= 6 && moscowHour(game.playedAt) < 12],
      ['День', ({ game }) => moscowHour(game.playedAt) >= 12 && moscowHour(game.playedAt) < 18],
      ['Вечер', ({ game }) => moscowHour(game.playedAt) >= 18],
      ['Ночь', ({ game }) => moscowHour(game.playedAt) < 6],
    ]),
    group('session', 'Место в игровой сессии', [
      ['Первая партия', ({ game }) => game.sessionGameNumber === 1],
      ['2–4 партия', ({ game }) => game.sessionGameNumber >= 2 && game.sessionGameNumber <= 4],
      ['5-я и позже', ({ game }) => game.sessionGameNumber >= 5],
    ]),
    group('rated', 'Тип партии', [
      ['Рейтинговые', ({ game }) => game.rated],
      ['Товарищеские', ({ game }) => !game.rated],
    ]),
    group('previous', 'После предыдущей партии', [
      ['После победы', ({ game }) => {
        const previous = game.previousGameId ? byId.get(game.previousGameId) : undefined;
        return previous ? resultFor(previous, username) === 'win' : false;
      }],
      ['После ничьей', ({ game }) => {
        const previous = game.previousGameId ? byId.get(game.previousGameId) : undefined;
        return previous ? resultFor(previous, username) === 'draw' : false;
      }],
      ['После поражения', ({ game }) => {
        const previous = game.previousGameId ? byId.get(game.previousGameId) : undefined;
        return previous ? resultFor(previous, username) === 'loss' : false;
      }],
    ]),
  ].filter((section) => section.rows.length > 0);
  const months = new Map<string, SelectedGame[]>();
  for (const entry of selected) {
    const date = new Date(entry.game.playedAt + 3 * 60 * 60 * 1_000);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    months.set(key, [...(months.get(key) ?? []), entry]);
  }
  return {
    sections,
    months: [...months.entries()]
      .sort(([first], [second]) => first.localeCompare(second))
      .slice(-8)
      .map(([label, entries]) => conditionRow(label, entries, username)),
  };
}

export type TrainingMoment = {
  gameId: string;
  playedAt: number;
  ply: number;
  san: string;
  winPercentLoss: number;
  phase: GamePhase;
  bestMove: string | null;
  motif: TacticalMotif | 'other';
};

export type Recommendation = { title: string; reason: string; weight: number };

export type TrainingOverview = {
  moments: TrainingMoment[];
  missedWins: Array<{
    gameId: string;
    playedAt: number;
    peak: number;
    result: 'win' | 'draw' | 'loss';
  }>;
  recurringOpenings: Array<{ family: string; errors: number; games: number }>;
  recommendations: Recommendation[];
};

export function summarizeTraining(
  games: QualityGame[],
  username: string,
  filters: QualityFilters,
): TrainingOverview {
  const selected = selectGames(games, username, filters);
  const moments = selected.flatMap(({ game, color }) => (
    game.tactical[color].criticalMoments.map((moment) => ({
      gameId: game.gameId,
      playedAt: game.playedAt,
      ...moment,
    }))
  )).sort((first, second) => second.winPercentLoss - first.winPercentLoss).slice(0, 12);
  const missedWins = selected
    .filter(({ game, color }) => (
      game.advantage[color].maxWinPercent >= 80 && resultFor(game, username) !== 'win'
    ))
    .map(({ game, color }) => ({
      gameId: game.gameId,
      playedAt: game.playedAt,
      peak: game.advantage[color].maxWinPercent,
      result: resultFor(game, username),
    }))
    .sort((first, second) => second.peak - first.peak)
    .slice(0, 8);
  const openings = new Map<string, { errors: number; games: number }>();
  for (const { game, color } of selected) {
    const family = game.opening[color].family;
    const current = openings.get(family) ?? { errors: 0, games: 0 };
    current.games += 1;
    if (game.opening[color].firstErrorPly !== null) current.errors += 1;
    openings.set(family, current);
  }
  const recurringOpenings = [...openings.entries()]
    .map(([family, values]) => ({ family, ...values }))
    .filter((row) => row.errors >= 2)
    .sort((first, second) => second.errors - first.errors)
    .slice(0, 6);
  const time = summarizeTime(games, username, filters);
  const tactics = summarizeTactics(games, username, filters);
  const positional = summarizePositionally(games, username, filters);
  const endgames = summarizeEndgames(games, username, filters);
  const winning = selected.filter(({ game, color }) => game.advantage[color].maxWinPercent >= 80);
  const conversion = winning.length > 0
    ? winning.filter(({ game }) => resultFor(game, username) === 'win').length / winning.length * 100
    : null;
  const recommendations: Recommendation[] = [];
  const topMotif = tactics.rows[0];
  if (topMotif) recommendations.push({
    title: 'Разбирать тактические ошибки',
    reason: `${topMotif.count} эпизодов ведущего мотива; суммарно потеряно ${topMotif.totalWinPercentLoss.toFixed(0)} п.п. шансов.`,
    weight: topMotif.totalWinPercentLoss,
  });
  if (time.quickErrorRate !== null && time.quickErrorRate >= 5) recommendations.push({
    title: 'Замедляться перед быстрыми решениями',
    reason: `${time.quickErrorRate.toFixed(0)}% ходов быстрее трёх секунд оказались неточностями или хуже.`,
    weight: time.quickErrorRate * 3,
  });
  if (conversion !== null && conversion < 80) recommendations.push({
    title: 'Тренировать реализацию преимущества',
    reason: `Конверсия позиций с шансами 80%+ составляет ${conversion.toFixed(0)}%.`,
    weight: 100 - conversion,
  });
  if (positional.delayedDevelopmentRate !== null && positional.delayedDevelopmentRate >= 20) {
    recommendations.push({
      title: 'Ускорить развитие фигур',
      reason: `В ${positional.delayedDevelopmentRate.toFixed(0)}% партий к 10-му ходу не развиты минимум две лёгкие фигуры.`,
      weight: positional.delayedDevelopmentRate,
    });
  }
  if (endgames.games >= 5 && endgames.score !== null && endgames.score < 50) recommendations.push({
    title: 'Добавить практику эндшпилей',
    reason: `Набрано ${endgames.score.toFixed(0)}% очков в ${endgames.games} окончаниях.`,
    weight: 100 - endgames.score,
  });
  if (recurringOpenings[0]) recommendations.push({
    title: `Повторить: ${recurringOpenings[0].family}`,
    reason: `${recurringOpenings[0].errors} ранних ошибок в ${recurringOpenings[0].games} партиях.`,
    weight: recurringOpenings[0].errors * 10,
  });
  return {
    moments,
    missedWins,
    recurringOpenings,
    recommendations: recommendations.sort((first, second) => second.weight - first.weight).slice(0, 5),
  };
}
