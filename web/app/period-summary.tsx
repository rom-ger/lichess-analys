'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { getSummarySourceGames } from '../lib/lichess';
import { formatCentipawnEvaluation, loadStatisticsIndex, type AnalysisFilters, type StatisticsIndex } from '../lib/statistics';
import {
  compareMetric, summarizePeriod, summaryConfidence,
  type SummaryExample, type SummaryMetric,
} from '../lib/period-summary';
import { MiniBoard } from './opening-mistakes';

const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Moscow' });
const percent = (count: number, total: number) => total ? `${Math.round(100 * count / total)}%` : '—';

function Evidence({ examples, training = false }: { examples: SummaryExample[]; training?: boolean }) {
  return (
    <details className="summary-evidence">
      <summary>{training ? 'Тренировочные позиции' : 'Примеры из партий'} · {examples.length}</summary>
      {training && <p>На доске позиция перед вашим ходом. Запишите свой ход и вариант, затем откройте решение.</p>}
      <div className="summary-positions">
        {examples.map((example) => (
          <article className="summary-position" key={`${example.gameId}:${example.ply}`}>
            <MiniBoard color={example.color} fen={example.fen} label="Позиция для разбора" />
            <div>
              <strong>Против {example.opponent}</strong>
              <p>{date.format(example.playedAt)} · ход {example.moveNumber} · {example.color === 'white' ? 'ход белых' : 'ход чёрных'}</p>
              <details className="summary-solution">
                <summary>{training ? 'Показать ход и анализ' : 'Показать подтверждение'}</summary>
                <p>{example.evidence}</p>
                <p>Ваш ход: <b>{example.playedMove}</b>. Рекомендация: <b>{example.bestMove ?? 'Нет сохранённого хода'}</b>.</p>
                <p>Оценка за вас: {formatCentipawnEvaluation(example.beforeEvaluation)} → {formatCentipawnEvaluation(example.afterEvaluation)}</p>
              </details>
              <Link href={`/games/${encodeURIComponent(example.gameId)}?ply=${example.ply - 1}`} target="_blank" rel="noopener noreferrer">
                Разобрать позицию ↗
              </Link>
            </div>
          </article>
        ))}
      </div>
    </details>
  );
}

function MetricCard({ metric, positive, coverage }: { metric: SummaryMetric; positive: boolean; coverage: number }) {
  const count = positive ? metric.successes : metric.failures;
  return (
    <article className={`summary-finding ${positive ? 'summary-finding--positive' : ''}`}>
      <header><h4>{positive ? metric.definition.strength : metric.definition.title}</h4><strong>{percent(count, metric.opportunities)}</strong></header>
      <p>{count} из {metric.opportunities} {metric.definition.unit}.</p>
      <p className="summary-confidence">{summaryConfidence(metric.games, coverage)} · {positive ? metric.successGames : metric.failureGames} партий с примерами</p>
      <details className="summary-explanation"><summary>Как получен вывод</summary><p>{metric.definition.explanation}</p></details>
      <Evidence examples={positive ? metric.positive : metric.negative} />
    </article>
  );
}

function Comparison({ report }: { report: ReturnType<typeof summarizePeriod> }) {
  if (!report.previousFilters) return <p className="summary-note">Для сравнения выберите период с начальной и конечной датой: сравним с предшествующим отрезком той же длительности.</p>;
  if (!report.comparisons.length) return <p className="summary-note">В выборке нет партий с известным контролем времени для сравнения.</p>;
  const previous = report.previousFilters;
  const rows = [
    ...['opening', 'conversion', 'punish', 'hold'].map((id) => ({ id, outcome: 'successes' as const })),
    ...[...new Set(['phase:opening', 'phase:middlegame', 'phase:endgame', ...report.priorities.map((metric) => metric.id)])]
      .map((id) => ({ id, outcome: 'failures' as const })),
  ];
  return (
    <div className="summary-comparisons">
      <p>Предыдущий период: {date.format(previous.from!)} — {date.format(previous.to! - 1)}. Сравнение по загруженным партиям, отдельно для каждого точного контроля. Проценты в таблице сопровождаются числом случаев и возможностей.</p>
      {report.comparisons.map((comparison) => {
        const controlParts = comparison.control.split('+').map(Number);
        return (
          <details className="summary-comparison" key={comparison.control}>
            <summary>{controlParts[0] / 60}+{controlParts[1]} · сейчас {comparison.current.analyzed}/{comparison.current.selected} партий с анализом · раньше {comparison.previous.analyzed}/{comparison.previous.selected}</summary>
            {comparison.previous.analyzed === 0 ? <p>За предыдущий период нет проанализированных партий с этим контролем.</p> : (
              <div className="summary-table-wrap">
                <table>
                  <caption>Динамика при контроле {controlParts[0] / 60}+{controlParts[1]}</caption>
                  <thead><tr><th scope="col">Показатель</th><th scope="col">Раньше</th><th scope="col">Сейчас</th><th scope="col">Изменение</th></tr></thead>
                  <tbody>{rows.map(({ id, outcome }) => {
                    const current = comparison.current.metrics.find((metric) => metric.id === id);
                    const before = comparison.previous.metrics.find((metric) => metric.id === id);
                    if (!current && !before) return null;
                    const definition = (current ?? before)!.definition;
                    const trend = current && before ? compareMetric(current, before, Math.min(comparison.current.coverage, comparison.previous.coverage), outcome) : null;
                    return (
                      <tr key={`${id}:${outcome}`}>
                        <th scope="row">{outcome === 'successes' ? definition.strength : definition.title}<small>{definition.unit}</small></th>
                        <td>{before ? <>{percent(before[outcome], before.opportunities)}<small>{before[outcome]} / {before.opportunities}</small></> : 'Нет подходящих данных'}</td>
                        <td>{current ? <>{percent(current[outcome], current.opportunities)}<small>{current[outcome]} / {current.opportunities}</small></> : 'Нет подходящих данных'}</td>
                        <td className={`summary-trend--${trend?.direction ?? 'uncertain'}`}>{trend ? <>{trend.delta > 0 ? '+' : ''}{trend.delta.toFixed(1)} п. п.<small>{trend.label}</small></> : 'Недостаточно данных'}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            )}
          </details>
        );
      })}
    </div>
  );
}

export function PeriodSummary({ filters, username }: { filters: AnalysisFilters; username: string }) {
  const [index, setIndex] = useState<StatisticsIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    loadStatisticsIndex().then((value) => { if (active) setIndex(value); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [attempt]);
  const source = useMemo(() => getSummarySourceGames(username), [username]);
  const report = useMemo(() => index ? summarizePeriod(index.games, source, username, filters) : null, [index, source, username, filters]);

  if (error) return <div className="summary-state" role="alert"><p>{error}</p><button className="page-button" onClick={() => { setError(null); setAttempt((value) => value + 1); }} type="button">Повторить загрузку</button></div>;
  if (!report || !index) return <div className="summary-state" role="status">Собираем резюме по сохранённому анализу…</div>;
  if (filters.from !== undefined && filters.to !== undefined && filters.from >= filters.to) return <div className="summary-state">Начало периода должно быть не позже его окончания.</div>;
  if (!report.selected) return <div className="summary-state"><h2>В этом периоде нет подходящих партий</h2><p>Измените период, контроль или результат.</p></div>;

  return (
    <section className="period-summary" aria-labelledby="summary-heading">
      <header className="summary-heading">
        <div><span className="eyebrow">Резюме периода</span><h2 id="summary-heading">От партий к плану роста</h2><p>Выводы по вашим ходам в выбранных партиях. Каждый приоритет связан с позициями для самостоятельного разбора.</p></div>
        <div className="summary-coverage"><strong>{report.analyzed} <span>/ {report.selected}</span></strong><span>партий с полным анализом · {percent(report.analyzed, report.selected)}</span></div>
      </header>
      <div className="summary-notices">
        <p>{summaryConfidence(report.analyzed, report.coverage)}. Данные: загруженные PGN и сохранённый анализ Stockfish {index.engine.version}, глубина {index.engine.depth}.</p>
        {report.analyzed < report.selected && <p>Без полного анализа: {report.selected - report.analyzed}. Выводы относятся только к проанализированной части выборки.</p>}
        {filters.result && <p>Выбран один результат. Это резюме только таких партий; для общей оценки сильных сторон и прогресса выберите «Все» в фильтре результата.</p>}
        {report.mixedControls && <p>В резюме объединены разные контроли. Для плана под один формат используйте фильтр; динамика ниже сравнивается отдельно для каждого точного контроля.</p>}
      </div>

      {report.analyzed === 0 ? <div className="summary-state"><h3>Для резюме пока нет данных анализа</h3><p>В выбранных партиях нужен полный сохранённый анализ. После его добавления и обновления индекса здесь появятся выводы.</p></div> : <>
        <section className="summary-training" aria-labelledby="training-heading">
          <div className="summary-section-heading"><span className="eyebrow">Главный фокус</span><h3 id="training-heading">Над чем работать дальше</h3></div>
          {report.priorities.length === 0 ? <p className="summary-note">Пока нет проблемы, подтверждённой хотя бы в трёх разных партиях. Не назначаем приоритет по единичному случаю. Ниже доступны показатели для наблюдения.</p> : <>
            <p>Начните с первого пункта. План на ближайшую неделю — три разбора по 10–15 минут; после самостоятельного решения сравните варианты и повторите позиции через несколько дней.</p>
            <ol className="summary-priorities">{report.priorities.map((metric, position) => (
              <li key={metric.id}>
                <article>
                  <header><span className="summary-rank">{position + 1}</span><h4>{metric.definition.title}</h4></header>
                  <p><b>Почему это приоритет:</b> {metric.failures} из {metric.opportunities} {metric.definition.unit} ({percent(metric.failures, metric.opportunities)}), в {metric.failureGames} разных партиях. Учтены частота и тяжесть потери оценки.</p>
                  <p className="summary-confidence">{summaryConfidence(metric.games, report.coverage)}</p>
                  <p><b>Как тренировать:</b> {metric.definition.exercise}</p>
                  <p><b>Как проверить прогресс:</b> {metric.definition.progress} Сравните следующий период при том же контроле времени.</p>
                  <details className="summary-explanation"><summary>Критерий отбора</summary><p>{metric.definition.explanation}</p></details>
                  <Evidence examples={metric.negative.slice(0, 3)} training />
                </article>
              </li>
            ))}</ol>
          </>}
        </section>

        <div className="summary-findings">
          <section aria-labelledby="strengths-heading"><h3 id="strengths-heading">Сильные стороны</h3>
            {report.strengths.length ? report.strengths.map((metric) => <MetricCard key={metric.id} metric={metric} positive coverage={report.coverage} />)
              : <p className="summary-note">Пока недостаточно повторяющихся положительных примеров: нужно хотя бы 10 партий с подходящими ситуациями, успехи в 7 разных партиях и не менее 70% успешных случаев. Отсутствие ошибок само по себе не считается сильной стороной.</p>}
          </section>
          <section aria-labelledby="weaknesses-heading"><h3 id="weaknesses-heading">Главные слабости</h3>
            {report.weaknesses.length ? report.weaknesses.slice(0, 5).map((metric) => <MetricCard key={metric.id} metric={metric} positive={false} coverage={report.coverage} />)
              : <p className="summary-note">Повторяющиеся проблемы пока не подтверждены в трёх разных партиях. Это не означает, что в игре нет ошибок.</p>}
          </section>
        </div>

        <section className="summary-progress" aria-labelledby="progress-heading"><h3 id="progress-heading">Что меняется со временем</h3><Comparison report={report} /></section>
        <details className="summary-all-metrics"><summary>Все показатели выбранного периода</summary>
          <div className="summary-table-wrap"><table><caption>Частоты относительно подходящих ситуаций</caption>
            <thead><tr><th scope="col">Показатель</th><th scope="col">Возможности</th><th scope="col">Успехи</th><th scope="col">Проблемы</th></tr></thead>
            <tbody>{report.metrics.map((metric) => <tr key={metric.id}>
              <th scope="row">{metric.definition.strength ?? metric.definition.title}<small>{metric.definition.unit}</small><details><summary>Критерий</summary><p>{metric.definition.explanation}</p></details></th>
              <td>{metric.opportunities}<small>в {metric.games} партиях</small></td>
              <td>{metric.definition.strength ? `${metric.successes} (${percent(metric.successes, metric.opportunities)})` : 'Не оценивается'}</td>
              <td>{metric.failures} ({percent(metric.failures, metric.opportunities)})</td>
            </tr>)}</tbody>
          </table></div>
        </details>
      </>}
      <details className="summary-method"><summary>Как читать это резюме</summary>
        <p>Оценки даны за вашу сторону. Показатели дебюта, реализации, ответов на ошибки и удержания окончания имеют отдельные критерии успеха и проблемы: их проценты не обязаны складываться в 100%.</p>
        <p>Частота считается от подходящих ситуаций: типов окончания — от партий с этим окончанием, ошибок по стадиям — от ваших ходов в позициях с оценкой от −2.00 до +5.00. Отсутствие данных не заменяется нулём.</p>
        <p>Для приоритета нужны ошибки минимум в 3 разных партиях. Темы ранжируются по сумме тяжести ошибок и частоте; вклад каждой партии ограничен, чтобы одна катастрофа не определяла весь план. Перекрывающиеся подборки объединяются в пользу более конкретной темы.</p>
        <p>Уверенность зависит от числа партий с подходящими ситуациями: менее 20 — предварительный вывод, 20–49 — умеренная уверенность, от 50 — большая выборка. При покрытии анализом менее 80% вывод всегда предварительный. Это рабочие пороги, а не сравнение с игроками вашего рейтинга.</p>
        <p>Для динамики партийных показателей проверяется пересечение 95% интервалов долей. Непересечение — лишь сигнал изменения; сила соперников и состав позиций могут отличаться. Для показателей по отдельным ходам показывается изменение частоты без вывода об устойчивости. Партии с неизвестным контролем времени не сравниваются.</p>
        <p>Дебютные причины — эвристические признаки. Оценки движка не объясняют, почему вы ошиблись, и не дают оснований приписывать спешку, невнимательность или психологические причины. Изменение расстояния до мата не считается потерей пешек.</p>
      </details>
    </section>
  );
}
