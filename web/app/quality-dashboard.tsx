'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  loadStatisticsIndex,
  summarizeAdvantage,
  summarizeDefense,
  summarizePhases,
  summarizeQuality,
  type GamePhase,
  type QualityFilters,
  type QualityGame,
} from '../lib/statistics';
import { ExtendedDashboard } from './extended-dashboard';

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

const defenseBandLabels = {
  35: 'Сложная позиция',
  20: 'Проигранная позиция',
  5: 'Почти безнадёжная',
} as const;

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
  const advantageOverview = useMemo(
    () => games ? summarizeAdvantage(games, username, filters) : null,
    [filters, games, username],
  );
  const defenseOverview = useMemo(
    () => games ? summarizeDefense(games, username, filters) : null,
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
  const winningBand = advantageOverview?.bands.find((band) => band.threshold === 80);
  const losingBand = defenseOverview?.bands.find((band) => band.threshold === 20);

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

      {advantageOverview && (
        <section className="advantage-dashboard" aria-labelledby="advantage-title">
          <header className="quality-heading advantage-heading">
            <div>
              <p className="eyebrow">Группа 3</p>
              <h2 id="advantage-title">Реализация преимущества</h2>
            </div>
            {winningBand && winningBand.games > 0 && (
              <p>
                Реализовано <strong>{winningBand.wins}</strong> из{' '}
                <strong>{winningBand.games}</strong> выигранных позиций
              </p>
            )}
          </header>

          <div className="advantage-summary">
            <article className="advantage-card advantage-card--primary">
              <span>Конверсия при 80%+</span>
              <strong>{formatPercent(winningBand?.conversionRate ?? null, 0)}</strong>
              <p>{advantageOverview.convertedGames} побед из {advantageOverview.winningPositions} партий</p>
            </article>
            <article className="advantage-card">
              <span>Упущено</span>
              <strong>{advantageOverview.squanderedGames}</strong>
              <p>
                {advantageOverview.squanderedDraws} ничьих ·{' '}
                {advantageOverview.squanderedLosses} поражений
              </p>
            </article>
            <article className="advantage-card">
              <span>Чистая реализация</span>
              <strong>{formatPercent(advantageOverview.cleanConversionRate, 0)}</strong>
              <p>побед без новых ошибок и зевков после перевеса</p>
            </article>
            <article className="advantage-card">
              <span>Лучший шанс в поражениях</span>
              <strong>{formatPercent(advantageOverview.averagePeakInLosses, 0)}</strong>
              <p>средний пик шансов в проигранных партиях</p>
            </article>
          </div>

          <div className="conversion-panel">
            <header>
              <div>
                <h3>Конверсия по силе позиции</h3>
                <p>Как часто преимущество каждого уровня превращается в победу</p>
              </div>
              <small>Показываем размер выборки для каждого порога</small>
            </header>
            <div className="conversion-bands">
              {advantageOverview.bands.map((band) => (
                <article key={band.threshold}>
                  <div className="conversion-band-title">
                    <span>Шансы {band.threshold}%+</span>
                    <strong>{formatPercent(band.conversionRate, 0)}</strong>
                  </div>
                  <div className="conversion-track" aria-hidden="true">
                    <span style={{ width: `${band.conversionRate ?? 0}%` }} />
                  </div>
                  <p>
                    {band.games} партий · {band.wins} побед · {band.draws} ничьих ·{' '}
                    {band.losses} поражений
                  </p>
                </article>
              ))}
            </div>
          </div>

          <div className="advantage-followup">
            <article>
              <span>Первые 5 решений</span>
              <strong>{formatPercent(advantageOverview.firstFiveAccuracy)}</strong>
              <p>точность на {advantageOverview.firstFiveMoves} ходах после достижения 80%</p>
              <small>
                Потеря шансов за ход: {formatOptional(advantageOverview.firstFiveWinPercentLoss)}
              </small>
            </article>
            <article>
              <span>Удержание перевеса</span>
              <strong>{formatOptional(advantageOverview.postAdvantageSeriousErrorsPer100)}</strong>
              <p>ошибок и зевков на 100 ходов после достижения 80%</p>
              <small>
                В среднем преимущество возникает на {formatOptional(advantageOverview.averageFirstWinningMove)} ходу
              </small>
            </article>
            <aside>
              <strong>Что считается выигранной позицией</strong>
              <p>
                Позиция, в которой Stockfish оценивает ваши шансы на победу не ниже
                80%. Упущенной считается такая партия, если она закончилась ничьей
                или поражением.
              </p>
            </aside>
          </div>
        </section>
      )}

      {defenseOverview && (
        <section className="defense-dashboard" aria-labelledby="defense-title">
          <header className="quality-heading defense-heading">
            <div>
              <p className="eyebrow">Группа 4</p>
              <h2 id="defense-title">Защита плохих позиций</h2>
            </div>
            {losingBand && losingBand.games > 0 && (
              <p>
                Спасено <strong>{losingBand.saved}</strong> из{' '}
                <strong>{losingBand.games}</strong> проигранных позиций
              </p>
            )}
          </header>

          <div className="defense-summary">
            <article className="defense-card defense-card--primary">
              <span>Процент спасения</span>
              <strong>{formatPercent(losingBand?.saveRate ?? null, 0)}</strong>
              <p>результат не проигран после падения шансов до 20%</p>
            </article>
            <article className="defense-card">
              <span>Спасено партий</span>
              <strong>{defenseOverview.savedGames}</strong>
              <p>{defenseOverview.savedWins} побед · {defenseOverview.savedDraws} ничьих</p>
            </article>
            <article className="defense-card">
              <span>Возвращение в игру</span>
              <strong>{formatPercent(defenseOverview.recoveryRate, 0)}</strong>
              <p>позиций, где шансы снова поднимались хотя бы до 45%</p>
            </article>
            <article className="defense-card">
              <span>Длина сопротивления</span>
              <strong>{formatOptional(defenseOverview.averageResistanceMoves)}</strong>
              <p>ваших ходов после первого падения ниже 20%</p>
            </article>
          </div>

          <div className="defense-panel">
            <header>
              <div>
                <h3>Спасение по тяжести позиции</h3>
                <p>Победы и ничьи после попадания под разные пороги</p>
              </div>
              <small>Чем ниже порог, тем тяжелее исходная позиция</small>
            </header>
            <div className="defense-bands">
              {defenseOverview.bands.map((band) => (
                <article key={band.threshold}>
                  <div className="defense-band-title">
                    <span>{defenseBandLabels[band.threshold]} · ≤{band.threshold}%</span>
                    <strong>{formatPercent(band.saveRate, 0)}</strong>
                  </div>
                  <div className="defense-track" aria-hidden="true">
                    <span style={{ width: `${band.saveRate ?? 0}%` }} />
                  </div>
                  <p>
                    {band.games} партий · {band.wins} побед · {band.draws} ничьих ·{' '}
                    {band.losses} поражений
                  </p>
                </article>
              ))}
            </div>
          </div>

          <div className="defense-followup">
            <article>
              <span>Первые 5 ходов под давлением</span>
              <strong>{formatPercent(defenseOverview.firstFiveAccuracy)}</strong>
              <p>точность на {defenseOverview.firstFiveMoves} ходах после падения ниже 20%</p>
              <small>
                Потеря шансов: {formatOptional(defenseOverview.firstFiveWinPercentLoss)} за ход
              </small>
            </article>
            <article>
              <span>Следующие ходы после зевка</span>
              <strong>{formatPercent(defenseOverview.postBlunderAccuracy)}</strong>
              <p>точность на {defenseOverview.postBlunderMoves} последующих решениях</p>
              <small>
                Потеря шансов: {formatOptional(defenseOverview.postBlunderWinPercentLoss)} за ход
              </small>
            </article>
            <article>
              <span>Цепочка ошибок</span>
              <strong>{formatPercent(defenseOverview.errorCascadeRate, 0)}</strong>
              <p>партий, где за зевком следовала новая ошибка в течение трёх ходов</p>
              <small>Выборка: {defenseOverview.blunderedGames} партий с ходами после зевка</small>
            </article>
          </div>

          <div className="defense-ending">
            <p>
              <strong>{defenseOverview.lossesWithChances}</strong>
              <span>поражений закончились, когда движок ещё оставлял не менее 10% шансов</span>
            </p>
            <p>
              <strong>{defenseOverview.prolongedHopelessGames}</strong>
              <span>
                из {defenseOverview.hopelessGames} почти безнадёжных партий продолжались ещё минимум 10 ваших ходов
              </span>
            </p>
            <aside>
              <strong>Как читается этот блок</strong>
              <p>
                Проигранной считается позиция с шансами не выше 20%. Возвратом в
                игру — последующий подъём до 45%. Средний момент первого попадания
                в такую позицию: {formatOptional(defenseOverview.averageFirstLosingMove)} ход.
              </p>
              <small>
                После попадания в плохую позицию: {formatOptional(defenseOverview.postDisadvantageSeriousErrorsPer100)}
                {' '}ошибок и зевков на 100 ходов
              </small>
            </aside>
          </div>
        </section>
      )}

      {games && <ExtendedDashboard filters={filters} games={games} username={username} />}
    </>
  );
}
