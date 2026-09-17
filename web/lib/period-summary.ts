import type { AnalysisFilters, PlayerColor, StatisticsGame } from './statistics';

export type SummaryPosition = {
  ply: number;
  fen: string;
  moveNumber: number;
  playedMove: string;
  bestMove: string | null;
  beforeEvaluation: number;
  afterEvaluation: number;
  evidence: string;
};

export type MetricSample = {
  opportunities: number;
  successes: number;
  failures: number;
  impact: number;
  positive: SummaryPosition[];
  negative: SummaryPosition[];
};

export type PeriodMetrics = Record<PlayerColor, { metrics: Record<string, MetricSample> }>;
export type SummarySourceGame = {
  gameId: string;
  playedAt: number;
  speed: string | null;
  result: 'win' | 'draw' | 'loss';
  timeControl: string | null;
};

export type SummaryExample = SummaryPosition & {
  gameId: string;
  playedAt: number;
  opponent: string;
  color: PlayerColor;
};

type MetricDefinition = {
  title: string;
  strength?: string;
  unit: string;
  explanation: string;
  exercise: string;
  progress: string;
  family: string;
};

export const ENDING_LABELS: Record<string, string> = {
  'pawn-opposite-wings': 'Пешечные окончания на разных флангах',
  'pawn-both-wings': 'Пешечные окончания на двух флангах',
  'pawn-one-wing': 'Пешечные окончания на одном фланге',
  'rook-one-each': 'Ладейные окончания: по одной ладье',
  'rook-two-each': 'Ладейные окончания: по две ладьи',
  'rook-unbalanced': 'Ладейные окончания с неравным числом ладей',
  'rook-with-minors': 'Ладьи с лёгкими фигурами',
  'bishop-same-color': 'Окончания с одноцветными слонами',
  'bishop-opposite-color': 'Окончания с разноцветными слонами',
  bishop: 'Слоновые окончания', knight: 'Коневые окончания',
  'bishop-vs-knight': 'Слон против коня', 'minor-mixed': 'Окончания с лёгкими фигурами',
  queen: 'Ферзевые окончания', 'queen-mixed': 'Ферзи с другими фигурами',
};

const definitions: Record<string, MetricDefinition> = {
  opening: {
    title: 'Неудачный выход из дебюта', strength: 'Выход из дебюта с преимуществом', unit: 'завершённых дебютов',
    explanation: 'Успех — оценка от +0.50 при выходе из дебюта; проблема — оценка ниже −0.50. Короткие партии без перехода к следующей стадии не учитываются.',
    exercise: 'Разберите 3 позиции перед последним дебютным ходом. Запишите план развития и два хода-кандидата. Проверьте, где возникло отставание, пройдя дебют назад.',
    progress: 'Снижать долю выходов из дебюта с оценкой ниже −0.50.', family: 'opening',
  },
  conversion: {
    title: 'Упущенное преимущество', strength: 'Победы с сохранением преимущества', unit: 'партий с преимуществом от +2.00',
    explanation: 'Успех — победа без падения оценки ниже +1.00 после позиции от +2.00 перед вашим ходом. Проблема — ваш ход, после которого оценка пересекла +1.00 вниз, даже если позже вы выиграли.',
    exercise: 'Возьмите 3 позиции перед потерей преимущества. За 5 минут найдите два продолжения, для каждого выпишите самый сильный ответ соперника и вариант на 3–5 полуходов. Затем сравните с анализом.',
    progress: 'Снижать долю партий, где собственным ходом отдано преимущество; повышать долю побед с его сохранением.', family: 'conversion',
  },
  punish: {
    title: 'Упущенные возможности после ошибок соперника', strength: 'Точные ответы на ошибки соперника', unit: 'возможностей ответить на ошибку',
    explanation: 'Возможность — соперник теряет от 1.50, оставляя вам оценку от −0.50 до +5.00. Успех — ответ с потерей не более 0.50; проблема — потеря от 1.00. Промежуточные ответы не относятся ни к одному из этих исходов.',
    exercise: 'В выбранных позициях сначала перечислите шахи, взятия и угрозы. Рассчитайте 2 кандидата до ответа соперника и своего следующего хода. Откройте решение только после записи варианта.',
    progress: 'Снижать долю ответов с потерей от 1.00 после ошибки соперника.', family: 'punish',
  },
  hold: {
    title: 'Потеря равенства в эндшпиле', strength: 'Сохранение позиции в равных окончаниях', unit: 'партий с равной эндшпильной позицией',
    explanation: 'Старт — эндшпиль с оценкой от −0.50 до +0.50 перед вашим ходом. Успех — минимум 5 ваших ходов, оценка не ниже −1.00 до конца и результат не поражение. Проблема — собственный ход с пересечением −1.00 вниз.',
    exercise: 'Для 3 позиций запишите угрозу соперника и защитный план. Рассчитайте активный и выжидательный ход, затем проверьте оба в просмотрщике партии.',
    progress: 'Снижать долю равных окончаний, в которых собственный ход опускает оценку ниже −1.00.', family: 'endgame',
  },
};

const themes: Record<string, [string, string]> = {
  material: ['Потеря материала в дебюте', 'Перед ходом составьте список атакованных и незащищённых фигур. Рассчитайте все взятия соперника и ваши ответы.'],
  'king-safety': ['Угрозы королю в дебюте', 'Перечислите шахи и прямые угрозы соперника. Сравните два способа защиты короля и проверьте продолжения.'],
  development: ['Отставание в развитии', 'Сравните развитие фигур и безопасность королей. Найдите ход развития и проверьте, почему он предпочтительнее сыгранного.'],
  'pawn-structure': ['Ослабление пешек в дебюте', 'Перед пешечным ходом отметьте поля и пешки, которые потеряют защиту. Сравните структуру после своего хода и рекомендации движка.'],
  other: ['Другие решающие дебютные ошибки', 'Найдите два хода-кандидата и сильнейший ответ соперника на каждый. Запишите, какая угроза осталась незамеченной.'],
};

export function metricDefinition(id: string): MetricDefinition {
  if (definitions[id]) return definitions[id];
  if (id.startsWith('theme:')) {
    const [title, exercise] = themes[id.slice(6)] ?? themes.other;
    return { title, exercise: `${exercise} Повторите на 3 выбранных позициях.`, family: 'opening',
      unit: 'партий с вашими дебютными ходами',
      explanation: 'Повторяющийся признак решающей дебютной ошибки в существующей подборке. Причина определена эвристически; одна партия может иметь несколько признаков.',
      progress: 'Снижать долю партий с этим признаком решающей дебютной ошибки.' };
  }
  if (id.startsWith('ending:')) {
    return { title: ENDING_LABELS[id.slice(7)] ?? 'Окончания', family: 'endgame',
      unit: 'партий с подходящими позициями этого окончания',
      explanation: 'Считаются партии, где в этом типе окончания был ваш ход при оценке от −2.00 до +5.00. Проблема — хотя бы одна потеря оценки от 1.50 на таком ходу.',
      exercise: 'Разберите 3 окончания этого типа: оцените активность короля и фигур, угрозы пешкам и возможность проходной. Запишите план и вариант, затем сравните с движком.',
      progress: 'Снижать долю партий с серьёзной ошибкой среди партий, где возникало это окончание.' };
  }
  const phase = id.slice(6);
  const title = phase === 'opening' ? 'Серьёзные ошибки в дебюте'
    : phase === 'endgame' ? 'Серьёзные ошибки в эндшпиле' : 'Серьёзные ошибки в миттельшпиле';
  return { title, family: phase, unit: 'ваших ходов в подходящих позициях стадии',
    explanation: 'Учитываются ваши ходы при оценке от −2.00 до +5.00. Серьёзная ошибка — потеря оценки от 1.50 за ход.',
    exercise: 'Три раза за неделю разберите по одной выбранной позиции: найдите угрозу соперника, запишите 2–3 кандидата и рассчитайте сильнейший ответ на каждый. Сравните с сохранённым анализом.',
    progress: 'Снижать число серьёзных ошибок на 100 подходящих ходов этой стадии.' };
}

export type SummaryMetric = Omit<MetricSample, 'positive' | 'negative'> & {
  id: string;
  definition: MetricDefinition;
  games: number;
  successGames: number;
  failureGames: number;
  failureGameIds: string[];
  positive: SummaryExample[];
  negative: SummaryExample[];
  score: number;
};

export type PeriodSlice = {
  selected: number;
  analyzed: number;
  coverage: number;
  metrics: SummaryMetric[];
  strengths: SummaryMetric[];
  weaknesses: SummaryMetric[];
  priorities: SummaryMetric[];
};

function matches(game: SummarySourceGame, filters: AnalysisFilters) {
  return (filters.from === undefined || game.playedAt >= filters.from)
    && (filters.to === undefined || game.playedAt < filters.to)
    && (!filters.speed || game.speed === filters.speed)
    && (!filters.result || game.result === filters.result);
}

export function previousPeriod(filters: AnalysisFilters): AnalysisFilters | null {
  if (filters.from === undefined || filters.to === undefined
    || !Number.isFinite(filters.from) || !Number.isFinite(filters.to) || filters.to <= filters.from) return null;
  return { ...filters, from: filters.from - (filters.to - filters.from), to: filters.from };
}

function aggregate(
  source: SummarySourceGame[], byId: Map<string, StatisticsGame>, username: string,
): PeriodSlice {
  const accumulators = new Map<string, SummaryMetric>();
  let analyzed = 0;
  for (const item of source) {
    const game = byId.get(item.gameId);
    if (!game) continue;
    const color = game.white.toLowerCase() === username.toLowerCase() ? 'white'
      : game.black.toLowerCase() === username.toLowerCase() ? 'black' : null;
    if (!color || !game.periodMetrics?.[color]) continue;
    analyzed += 1;
    for (const [id, sample] of Object.entries(game.periodMetrics[color].metrics)) {
      if (sample.opportunities <= 0) continue;
      let total = accumulators.get(id);
      if (!total) {
        total = { id, definition: metricDefinition(id), opportunities: 0, successes: 0, failures: 0,
          impact: 0, positive: [], negative: [], games: 0, successGames: 0, failureGames: 0,
          failureGameIds: [], score: 0 };
        accumulators.set(id, total);
      }
      total.opportunities += sample.opportunities;
      total.successes += sample.successes;
      total.failures += sample.failures;
      total.impact += Math.min(500, sample.impact);
      total.games += 1;
      if (sample.successes) total.successGames += 1;
      if (sample.failures) { total.failureGames += 1; total.failureGameIds.push(game.gameId); }
      for (const kind of ['positive', 'negative'] as const) {
        // One position per game in each topic makes the training set diverse.
        const position = sample[kind][0];
        if (position) total[kind].push({ ...position, gameId: game.gameId, playedAt: item.playedAt,
          color, opponent: color === 'white' ? game.black : game.white });
      }
    }
  }
  const metrics = [...accumulators.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const metric of metrics) {
    metric.score = metric.impact / Math.max(1, analyzed) * (0.5 + 0.5 * metric.failures / metric.opportunities);
    for (const kind of ['positive', 'negative'] as const) {
      metric[kind].sort((a, b) => b.playedAt - a.playedAt || a.gameId.localeCompare(b.gameId));
      metric[kind] = metric[kind].slice(0, 6);
    }
  }
  const coverage = source.length ? analyzed / source.length : 0;
  const strengths = metrics.filter((metric) => metric.definition.strength && metric.games >= 10
    && metric.successGames >= 7 && metric.successes / metric.opportunities >= 0.7)
    .sort((a, b) => b.successes / b.opportunities - a.successes / a.opportunities).slice(0, 3);
  const weaknesses = metrics.filter((metric) => metric.failureGames >= 3)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const priorities: SummaryMetric[] = [];
  // Prefer a specific recurring topic when its evidence substantially
  // overlaps a broad phase, instead of prescribing the same positions twice.
  const isBroad = (metric: SummaryMetric) => metric.id.startsWith('phase:') || metric.id === 'opening';
  const specific = weaknesses.filter((metric) => !isBroad(metric));
  const candidates = [...specific, ...weaknesses.filter(isBroad)];
  for (const metric of candidates) {
    if (priorities.some((chosen) => {
      const overlap = metric.failureGameIds.filter((id) => chosen.failureGameIds.includes(id)).length;
      return overlap / Math.max(metric.failureGames, chosen.failureGames) >= 0.7;
    })) continue;
    priorities.push(metric);
  }
  priorities.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return { selected: source.length, analyzed, coverage, metrics, strengths, weaknesses, priorities: priorities.slice(0, 3) };
}

export function summaryConfidence(games: number, coverage: number) {
  if (coverage < 0.8) return 'Предварительно: анализ неполный';
  if (games < 20) return 'Предварительно: мало партий';
  if (games < 50) return 'Умеренная уверенность';
  return 'Повторяется на большой выборке';
}

export function summarizePeriod(
  games: StatisticsGame[], source: SummarySourceGame[], username: string, filters: AnalysisFilters,
) {
  const byId = new Map(games.map((game) => [game.gameId, game]));
  const uniqueSource = [...new Map(source.map((game) => [game.gameId, game])).values()];
  const selected = uniqueSource.filter((game) => matches(game, filters));
  const current = aggregate(selected, byId, username);
  const previousFilters = previousPeriod(filters);
  const previous = previousFilters ? uniqueSource.filter((game) => matches(game, previousFilters)) : [];
  // Compare exact time controls, so a change from 3+0 to 5+3 is not
  // interpreted as growth even though both are blitz.
  const controls = [...new Set(selected.map((game) => game.timeControl).filter((control): control is string => Boolean(control && /^\d+\+\d+$/.test(control))))].sort();
  const comparisons = previousFilters ? controls.map((control) => ({
    control,
    current: aggregate(selected.filter((game) => game.timeControl === control), byId, username),
    previous: aggregate(previous.filter((game) => game.timeControl === control), byId, username),
  })) : [];
  return { ...current, previousFilters, comparisons,
    mixedControls: new Set(selected.map((game) => game.timeControl)).size > 1 };
}

// The interval measures sampling uncertainty, not engine certainty or causality.
export function rateInterval(count: number, total: number): [number, number] {
  if (!total) return [0, 1];
  const rate = count / total;
  const z2 = 1.96 ** 2;
  const center = (rate + z2 / (2 * total)) / (1 + z2 / total);
  const margin = 1.96 * Math.sqrt(rate * (1 - rate) / total + z2 / (4 * total * total)) / (1 + z2 / total);
  return [center - margin, center + margin];
}

export function compareMetric(current: SummaryMetric, previous: SummaryMetric, coverage: number, outcome: 'successes' | 'failures' = 'failures') {
  const success = outcome === 'successes';
  const currentCount = success ? current.successes : current.failures;
  const previousCount = success ? previous.successes : previous.failures;
  const delta = 100 * (currentCount / current.opportunities - previousCount / previous.opportunities);
  if (Math.min(current.games, previous.games) < 20 || coverage < 0.8) {
    return { delta, label: 'Предварительно: мало данных', direction: 'uncertain' };
  }
  // Move-level observations from a single game are dependent, so avoid
  // statistical claims for metrics counting several moves per game.
  if (current.opportunities !== current.games || previous.opportunities !== previous.games) {
    return { delta, label: 'Изменение частоты; не оценка устойчивости', direction: 'uncertain' };
  }
  const a = rateInterval(currentCount, current.opportunities);
  const b = rateInterval(previousCount, previous.opportunities);
  if (a[0] <= b[1] && b[0] <= a[1]) return { delta, label: 'Убедительного изменения пока нет', direction: 'uncertain' };
  const better = success ? delta > 0 : delta < 0;
  return { delta, label: better ? 'Положительная динамика' : 'Стоит обратить внимание', direction: better ? 'better' : 'worse' };
}
