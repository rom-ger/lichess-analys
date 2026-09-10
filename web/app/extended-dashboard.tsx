'use client';

import { useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import {
  summarizeConditions,
  summarizeEndgames,
  summarizeLosses,
  summarizeOpenings,
  summarizePositionally,
  summarizeTactics,
  summarizeTime,
  summarizeTraining,
  type ConditionRow,
  type LossScenario,
} from '../lib/extended-statistics';
import type {
  CenterType,
  EndgameType,
  GamePhase,
  QualityFilters,
  QualityGame,
  TacticalMotif,
} from '../lib/statistics';

function optional(value: number | null, digits = 1) {
  return value === null ? '—' : value.toFixed(digits);
}

function percent(value: number | null, digits = 0) {
  return value === null ? '—' : `${value.toFixed(digits)}%`;
}

function seconds(value: number | null) {
  if (value === null) return '—';
  if (value < 60) return `${value.toFixed(1)} с`;
  return `${Math.floor(value / 60)}:${String(Math.round(value % 60)).padStart(2, '0')}`;
}

function Section({
  group,
  title,
  description,
  tone,
  children,
}: {
  group: number;
  title: string;
  description: string;
  tone: string;
  children: ReactNode;
}) {
  const id = `statistics-group-${group}`;
  return (
    <section className={`statistics-section statistics-section--${tone}`} aria-labelledby={id}>
      <header className="statistics-section-heading">
        <div>
          <p className="eyebrow">Группа {group}</p>
          <h2 id={id}>{title}</h2>
        </div>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}

function SummaryCard({ label, value, hint, primary = false }: {
  label: string;
  value: string;
  hint: string;
  primary?: boolean;
}) {
  return (
    <article className={`statistics-summary-card${primary ? ' statistics-summary-card--primary' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{hint}</p>
    </article>
  );
}

function ConditionTable({ rows }: { rows: ConditionRow[] }) {
  return (
    <div className="compact-table">
      <div className="compact-table-head">
        <span>Условие</span><span>Партий</span><span>Очки</span><span>Точность</span><span>Потеря</span>
      </div>
      {rows.map((row) => (
        <div className="compact-table-row" key={row.label}>
          <strong>{row.label}</strong>
          <span>{row.games}</span>
          <span>{percent(row.score)}</span>
          <span>{percent(row.accuracy, 1)}</span>
          <span>{optional(row.winPercentLoss)}</span>
        </div>
      ))}
    </div>
  );
}

const phaseLabels: Record<GamePhase, string> = {
  opening: 'Дебют',
  middlegame: 'Миттельшпиль',
  endgame: 'Эндшпиль',
};

const scenarioLabels: Record<LossScenario, string> = {
  time: 'Поражение по времени',
  missedWin: 'Упущенная победа',
  opening: 'Провал в дебюте',
  endgame: 'Ошибка в эндшпиле',
  cascade: 'Серия ошибок',
  singleBlunder: 'Один решающий зевок',
  gradual: 'Постепенное ухудшение',
};

const motifLabels: Record<TacticalMotif | 'other', string> = {
  missedCheck: 'Неиспользованный шах',
  missedCapture: 'Неиспользованное взятие',
  materialLoss: 'Потеря материала',
  kingSafety: 'Безопасность короля',
  promotion: 'Проходная пешка',
  other: 'Другие критические решения',
};

const centerLabels: Record<CenterType, string> = {
  open: 'Открытый центр',
  mixed: 'Подвижный центр',
  closed: 'Закрытый центр',
};

const endgameLabels: Record<EndgameType, string> = {
  rook: 'Ладейные',
  minor: 'Лёгкофигурные',
  pawn: 'Пешечные',
  queen: 'Ферзевые',
  mixed: 'Смешанные',
};

const resultLabels = { win: 'победа', draw: 'ничья', loss: 'поражение' } as const;

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: '2-digit',
  timeZone: 'Europe/Moscow',
});

export function ExtendedDashboard({
  games,
  username,
  filters,
}: {
  games: QualityGame[];
  username: string;
  filters: QualityFilters;
}) {
  const data = useMemo(() => ({
    time: summarizeTime(games, username, filters),
    openings: summarizeOpenings(games, username, filters),
    losses: summarizeLosses(games, username, filters),
    tactics: summarizeTactics(games, username, filters),
    positional: summarizePositionally(games, username, filters),
    endgames: summarizeEndgames(games, username, filters),
    conditions: summarizeConditions(games, username, filters),
    training: summarizeTraining(games, username, filters),
  }), [filters, games, username]);

  return (
    <>
      <Section
        description={`${data.time.timedMoves} ходов с доступными показаниями часов`}
        group={5}
        title="Управление временем"
        tone="time"
      >
        <div className="statistics-summary-grid">
          <SummaryCard hint="среднее время на собственный ход" label="Темп решений" primary value={seconds(data.time.averageMoveSeconds)} />
          <SummaryCard hint={`${data.time.quickMoves} ходов сделаны за три секунды или быстрее`} label="Ошибки на быстрых ходах" value={percent(data.time.quickErrorRate)} />
          <SummaryCard hint={`точность на ${data.time.longMoves} ходах длительностью 30+ секунд`} label="После долгого расчёта" value={percent(data.time.longAccuracy, 1)} />
          <SummaryCard hint="средний остаток часов в проигранных партиях" label="Неиспользованное время" value={seconds(data.time.unusedTimeInLosses)} />
        </div>
        <div className="split-statistics-grid">
          <div className="statistics-panel">
            <h3>Качество в цейтноте</h3>
            {data.time.bands.map((band) => (
              <div className="metric-line" key={band.seconds}>
                <div><strong>≤ {band.seconds} секунд</strong><small>{band.moves} ходов</small></div>
                <span>{percent(band.accuracy, 1)} точность</span>
                <span>{optional(band.seriousErrorsPer100)} ошибок / 100</span>
              </div>
            ))}
          </div>
          <div className="statistics-panel">
            <h3>Расход времени по стадиям</h3>
            {data.time.phases.map((phase) => (
              <div className="metric-line" key={phase.phase}>
                <div><strong>{phaseLabels[phase.phase]}</strong><small>{phase.moves} ходов</small></div>
                <span>{seconds(phase.averageSeconds)} / ход</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section
        description={`${data.openings.families} дебютных семейств в выбранной выборке`}
        group={6}
        title="Дебютный профиль"
        tone="opening"
      >
        <div className="wide-table opening-table">
          <div className="wide-table-head">
            <span>Дебют</span><span>Партий</span><span>Очки</span><span>Выход</span><span>Точность</span><span>Ранняя ошибка</span>
          </div>
          {data.openings.rows.map((row) => (
            <div className="wide-table-row" key={row.family}>
              <div><strong>{row.family}</strong><small>{row.line || 'Линия не определена'}</small></div>
              <span>{row.games}<small>{row.whiteGames} белыми · {row.blackGames} чёрными</small></span>
              <span>{percent(row.score)}</span>
              <span>{percent(row.exitWinPercent)}</span>
              <span>{percent(row.accuracy, 1)}</span>
              <span>{percent(row.firstErrorRate)}<small>в среднем {optional(row.averageFirstErrorMove)} ход</small></span>
            </div>
          ))}
        </div>
        <p className="heuristic-note">Названия определяются по первым ходам; редкие варианты объединяются в широкие семейства.</p>
      </Section>

      <Section
        description={`${data.losses.losses} поражений классифицировано по главному сценарию`}
        group={7}
        title="Типичные сценарии поражений"
        tone="losses"
      >
        <div className="scenario-list">
          {data.losses.rows.map((row) => (
            <article key={row.scenario}>
              <div className="scenario-title">
                <strong>{scenarioLabels[row.scenario]}</strong>
                <span>{row.games} · {percent(row.share)}</span>
              </div>
              <div className="scenario-track" aria-hidden="true"><span style={{ width: `${row.share}%` }} /></div>
              <footer>
                <span>Критическая позиция: {optional(row.averageFirstLosingMove)} ход</span>
                <span className="example-links">
                  {row.examples.map((id) => <Link href={`/games/${encodeURIComponent(id)}`} key={id}>{id}</Link>)}
                </span>
              </footer>
            </article>
          ))}
        </div>
      </Section>

      <Section
        description={`${data.tactics.seriousMoments} крупнейших ошибок вошли в профиль`}
        group={8}
        title="Тактический профиль"
        tone="tactics"
      >
        <div className="motif-grid">
          {data.tactics.rows.map((row, index) => (
            <article className={index === 0 ? 'motif-card motif-card--primary' : 'motif-card'} key={row.motif}>
              <span>{motifLabels[row.motif]}</span>
              <strong>{row.count}</strong>
              <p>в {row.games} партиях · средняя потеря {optional(row.averageLoss)} п.п.</p>
              <small>Суммарно потеряно {row.totalWinPercentLoss.toFixed(0)} п.п. шансов</small>
            </article>
          ))}
        </div>
        <p className="heuristic-note">Мотивы определяются эвристически по лучшему ходу Stockfish: шаху, взятию, материальной потере и угрозам королю. Один эпизод может относиться к нескольким мотивам.</p>
      </Section>

      <Section
        description="Повторяющиеся позиционные условия и качество игры в них"
        group={9}
        title="Позиционный профиль"
        tone="positional"
      >
        <div className="statistics-summary-grid">
          <SummaryCard hint="минимум два ранних хода ферзём" label="Ранняя активность ферзя" primary value={percent(data.positional.earlyQueenRate)} />
          <SummaryCard hint="к 10-му ходу не развиты минимум две лёгкие фигуры" label="Задержка развития" value={percent(data.positional.delayedDevelopmentRate)} />
          <SummaryCard hint="король не рокировал к 15-му ходу в достаточно длинных партиях" label="Без рокировки" value={percent(data.positional.uncastledRate)} />
          <SummaryCard hint={`${data.positional.doubledPawnMoves} решений в таких структурах`} label="Точность со сдвоенными" value={percent(data.positional.doubledPawnAccuracy, 1)} />
        </div>
        <div className="compact-table positional-table">
          <div className="compact-table-head"><span>Тип центра</span><span>Партий</span><span>Очки</span><span>Точность</span><span>Потеря</span></div>
          {data.positional.centers.map((row) => (
            <div className="compact-table-row" key={row.center}>
              <strong>{centerLabels[row.center]}</strong><span>{row.games}</span><span>{percent(row.score)}</span><span>{percent(row.accuracy, 1)}</span><span>{optional(row.winPercentLoss)}</span>
            </div>
          ))}
        </div>
        <p className="heuristic-note">Это диагностические эвристики, а не шахматные вердикты: они помогают находить повторяющиеся позиции для ручного разбора.</p>
      </Section>

      <Section
        description={`${data.endgames.games} партий дошли до эндшпиля`}
        group={10}
        title="Эндшпили"
        tone="endgame"
      >
        <div className="statistics-summary-grid statistics-summary-grid--three">
          <SummaryCard hint="доля набранных очков во всех окончаниях" label="Результативность" primary value={percent(data.endgames.score)} />
          <SummaryCard hint="средняя точность собственных ходов в эндшпиле" label="Точность" value={percent(data.endgames.accuracy, 1)} />
          <SummaryCard hint="размер выборки окончаний" label="Партий" value={String(data.endgames.games)} />
        </div>
        <div className="wide-table endgame-table">
          <div className="wide-table-head"><span>Тип окончания</span><span>Партий</span><span>Очки</span><span>Точность</span><span>Шансы на входе</span><span>Реализация / спасение</span></div>
          {data.endgames.rows.map((row) => (
            <div className="wide-table-row" key={row.type}>
              <strong>{endgameLabels[row.type]}</strong><span>{row.games}</span><span>{percent(row.score)}</span><span>{percent(row.accuracy, 1)}</span><span>{percent(row.averageStartChance)}</span><span>{percent(row.conversionRate)} / {percent(row.saveRate)}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        description="Сравнение качества при разных внешних условиях"
        group={11}
        title="Зависимость от условий"
        tone="conditions"
      >
        <div className="condition-sections">
          {data.conditions.sections.map((section) => (
            <article key={section.id}>
              <h3>{section.title}</h3>
              <ConditionTable rows={section.rows} />
            </article>
          ))}
        </div>
        {data.conditions.months.length > 1 && (
          <article className="monthly-trend">
            <h3>Динамика по месяцам</h3>
            <ConditionTable rows={data.conditions.months} />
          </article>
        )}
      </Section>

      <Section
        description="Приоритеты и позиции собраны из выбранного периода"
        group={12}
        title="Персональная подборка для обучения"
        tone="training"
      >
        <div className="training-layout">
          <div className="recommendations">
            <h3>Что тренировать в первую очередь</h3>
            {data.training.recommendations.length === 0 ? (
              <p className="empty-statistics">Недостаточно повторяющихся сигналов в выбранной выборке.</p>
            ) : data.training.recommendations.map((item, index) => (
              <article key={item.title}>
                <span>{index + 1}</span><div><strong>{item.title}</strong><p>{item.reason}</p></div>
              </article>
            ))}
          </div>
          <div className="training-moments">
            <h3>Самые дорогие решения</h3>
            {data.training.moments.slice(0, 8).map((moment) => (
              <Link href={`/games/${encodeURIComponent(moment.gameId)}`} key={`${moment.gameId}-${moment.ply}`}>
                <span>{dateFormatter.format(moment.playedAt)} · ход {Math.ceil(moment.ply / 2)}</span>
                <strong>{moment.san} · −{moment.winPercentLoss.toFixed(1)} п.п.</strong>
                <small>{phaseLabels[moment.phase]} · {motifLabels[moment.motif]}{moment.bestMove ? ` · лучше ${moment.bestMove}` : ''}</small>
              </Link>
            ))}
          </div>
        </div>
        <div className="training-secondary">
          <article>
            <h3>Упущенные выигранные позиции</h3>
            {data.training.missedWins.length === 0 ? <p>В выбранной выборке нет.</p> : data.training.missedWins.map((game) => (
              <Link href={`/games/${encodeURIComponent(game.gameId)}`} key={game.gameId}>
                <strong>{game.gameId}</strong><span>{dateFormatter.format(game.playedAt)} · пик {percent(game.peak)} · {resultLabels[game.result]}</span>
              </Link>
            ))}
          </article>
          <article>
            <h3>Повторяющиеся дебютные ошибки</h3>
            {data.training.recurringOpenings.length === 0 ? <p>Повторений пока недостаточно.</p> : data.training.recurringOpenings.map((opening) => (
              <div key={opening.family}><strong>{opening.family}</strong><span>{opening.errors} ошибок в {opening.games} партиях</span></div>
            ))}
          </article>
        </div>
      </Section>
    </>
  );
}
