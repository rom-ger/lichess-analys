'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  loadStatisticsIndex,
  summarizePhases,
  summarizeQuality,
  type GamePhase,
  type QualityFilters,
  type QualityGame,
} from '../lib/statistics';

type MetricCardProps = {
  label: string;
  value: number | null;
  suffix?: string;
  digits?: number;
  hint: string;
  comparison?: number | null;
  lowerIsBetter?: boolean;
};

function MetricCard({
  label,
  value,
  suffix = '',
  digits = 1,
  hint,
  comparison,
  lowerIsBetter = false,
}: MetricCardProps) {
  const delta = value !== null && comparison !== null && comparison !== undefined
    ? value - comparison
    : null;
  const improved = delta !== null && (lowerIsBetter ? delta < 0 : delta > 0);

  return (
    <article className="quality-card">
      <span>{label}</span>
      <strong>{value === null ? '—' : `${value.toFixed(digits)}${suffix}`}</strong>
      <p>{hint}</p>
      {delta !== null && Math.abs(delta) >= 0.05 && (
        <small className={improved ? 'metric-delta metric-delta--good' : 'metric-delta metric-delta--bad'}>
          {delta > 0 ? '+' : ''}{delta.toFixed(digits)}{suffix} к предыдущему периоду
        </small>
      )}
    </article>
  );
}

function previousFilters(filters: QualityFilters) {
  if (filters.from === undefined || filters.to === undefined) return null;
  const duration = filters.to - filters.from;
  return { ...filters, from: filters.from - duration, to: filters.from };
}

function formatOptional(value: number | null, digits = 1) {
  return value === null ? '—' : value.toFixed(digits);
}

function formatPercent(value: number | null, digits = 1) {
  return value === null ? '—' : `${value.toFixed(digits)}%`;
}

const phaseLabels: Record<GamePhase, string> = {
  opening: 'Дебют',
  middlegame: 'Миттельшпиль',
  endgame: 'Эндшпиль',
};

export function QualityDashboard({
  filters,
  username,
}: {
  filters: QualityFilters;
  username: string;
}) {
  const [games, setGames] = useState<QualityGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadStatisticsIndex()
      .then((index) => {
        if (!cancelled) setGames(index.games);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить статистику.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(
    () => games ? summarizeQuality(games, username, filters) : null,
    [filters, games, username],
  );
  const comparison = useMemo(() => {
    const previous = previousFilters(filters);
    return games && previous ? summarizeQuality(games, username, previous) : null;
  }, [filters, games, username]);
  const phaseOverview = useMemo(
    () => games ? summarizePhases(games, username, filters) : null,
    [filters, games, username],
  );

  if (error) {
    return <div className="quality-state quality-state--error">{error}</div>;
  }
  if (!summary) {
    return <div className="quality-state">Собираем показатели качества…</div>;
  }
  if (summary.games === 0) {
    return <div className="quality-state">В выбранном периоде нет проанализированных партий.</div>;
  }

  const rankedPhases = phaseOverview?.phases
    .filter((phase) => phase.moves >= 20 && phase.averageWinPercentLoss !== null)
    .sort((first, second) => (
      (first.averageWinPercentLoss ?? 0) - (second.averageWinPercentLoss ?? 0)
    )) ?? [];
  const strongestPhase = rankedPhases.at(0)?.phase;
  const weakestPhase = rankedPhases.at(-1)?.phase;

  return (
    <>
      <section className="quality-dashboard" aria-labelledby="quality-title">
        <header className="quality-heading">
          <div>
            <p className="eyebrow">Stockfish 18 · глубина 18</p>
            <h2 id="quality-title">Базовое качество игры</h2>
          </div>
          <p><strong>{summary.games}</strong> партий · <strong>{summary.moves}</strong> ваших ходов</p>
        </header>

        <div className="quality-grid">
          <MetricCard
            comparison={comparison?.accuracy}
            hint="Средняя точность отдельных ходов"
            label="Точность"
            suffix="%"
            value={summary.accuracy}
          />
          <MetricCard
            comparison={comparison?.averageWinPercentLoss}
            hint="Потерянные процентные пункты за ход"
            label="Потеря шансов"
            lowerIsBetter
            value={summary.averageWinPercentLoss}
          />
          <MetricCard
            comparison={comparison?.averageCentipawnLoss}
            hint="Средняя потеря оценки за ход"
            label="ACPL"
            lowerIsBetter
            value={summary.averageCentipawnLoss}
          />
          <MetricCard
            comparison={comparison?.bestMoveRate}
            hint="Совпадение с первой линией движка"
            label="Лучшие ходы"
            suffix="%"
            value={summary.bestMoveRate}
          />
        </div>

        <div className="quality-details">
          <div className="error-rates">
            <h3>Ошибки на 100 ходов</h3>
            <div>
              <span><i className="error-dot error-dot--inaccuracy" />Неточности <strong>{formatOptional(summary.inaccuraciesPer100)}</strong></span>
              <span><i className="error-dot error-dot--mistake" />Ошибки <strong>{formatOptional(summary.mistakesPer100)}</strong></span>
              <span><i className="error-dot error-dot--blunder" />Зевки <strong>{formatOptional(summary.blundersPer100)}</strong></span>
            </div>
          </div>
          <div className="quality-facts">
            <p><strong>{formatPercent(summary.cleanGamesRate, 0)}</strong><span>партий без ошибок и зевков</span></p>
            <p><strong>{formatOptional(summary.averageFirstSeriousErrorMove)}</strong><span>средний ход первой серьёзной ошибки</span></p>
          </div>
        </div>
      </section>

      {phaseOverview && (
        <section className="phase-dashboard" aria-labelledby="phase-title">
          <header className="quality-heading phase-heading">
            <div>
              <p className="eyebrow">Группа 2</p>
              <h2 id="phase-title">Качество по стадиям</h2>
            </div>
            {strongestPhase && weakestPhase && strongestPhase !== weakestPhase && (
              <p className="phase-conclusion">
                Сильнее всего: <strong>{phaseLabels[strongestPhase]}</strong>
                <span>·</span>
                Зона роста: <strong>{phaseLabels[weakestPhase]}</strong>
              </p>
            )}
          </header>

          <div className="phase-grid">
            {phaseOverview.phases.map((phase) => {
              const modifier = phase.phase === strongestPhase
                ? ' phase-card--strongest'
                : phase.phase === weakestPhase
                  ? ' phase-card--weakest'
                  : '';
              return (
                <article className={`phase-card${modifier}`} key={phase.phase}>
                  <header>
                    <div>
                      <span>{phaseLabels[phase.phase]}</span>
                      <small>{phase.games} партий · {phase.moves} ходов</small>
                    </div>
                    <strong>{formatPercent(phase.accuracy)}</strong>
                  </header>
                  <div className="phase-accuracy-track" aria-hidden="true">
                    <span style={{ width: `${phase.accuracy ?? 0}%` }} />
                  </div>
                  <dl>
                    <div><dt>Потеря шансов</dt><dd>{formatOptional(phase.averageWinPercentLoss)}</dd></div>
                    <div><dt>ACPL</dt><dd>{formatOptional(phase.averageCentipawnLoss)}</dd></div>
                    <div><dt>Ошибки / 100</dt><dd>{formatOptional(phase.seriousErrorsPer100)}</dd></div>
                    <div><dt>Лучшие ходы</dt><dd>{formatPercent(phase.bestMoveRate)}</dd></div>
                  </dl>
                </article>
              );
            })}
          </div>

          <div className="phase-facts">
            <article>
              <span>Выход из дебюта</span>
              <strong>{formatPercent(phaseOverview.openingHeldRate, 0)}</strong>
              <p>партий с шансами на победу не ниже 45%</p>
              <small>Средние шансы: {formatPercent(phaseOverview.averageOpeningExitWinPercent)}</small>
            </article>
            <article>
              <span>Позиции без ферзей</span>
              <strong>{formatPercent(phaseOverview.queenlessAccuracy)}</strong>
              <p>точность на {phaseOverview.queenlessMoves} ходах</p>
              <small>Потеря шансов за ход: {formatOptional(phaseOverview.queenlessWinPercentLoss)}</small>
            </article>
            <aside>
              <strong>Как определяются стадии</strong>
              <p>
                Дебют — первые 12 ходов. Эндшпиль начинается при заметном сокращении
                фигур; остальные позиции относятся к миттельшпилю.
              </p>
            </aside>
          </div>
        </section>
      )}
    </>
  );
}
