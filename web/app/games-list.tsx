'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  getRecentGames,
  type GameResult,
  type GameRow,
  type GameSpeed,
} from '../lib/lichess';
import type { QualityFilters } from '../lib/statistics';
import { QualityDashboard } from './quality-dashboard';

type Period = '30d' | '90d' | 'year' | 'all' | 'custom';

const DAY_MS = 24 * 60 * 60 * 1_000;

const periodFilters: Array<{ value: Period; label: string }> = [
  { value: '30d', label: '30 дней' },
  { value: '90d', label: '90 дней' },
  { value: 'year', label: 'Этот год' },
  { value: 'all', label: 'Всё время' },
  { value: 'custom', label: 'Свой период' },
];

const speedFilters: Array<{ value: GameSpeed | ''; label: string }> = [
  { value: '', label: 'Все' },
  { value: 'bullet', label: 'Пуля' },
  { value: 'blitz', label: 'Блиц' },
  { value: 'rapid', label: 'Рапид' },
];

const resultFilters: Array<{ value: GameResult | ''; label: string }> = [
  { value: '', label: 'Все' },
  { value: 'draw', label: 'Ничья' },
  { value: 'loss', label: 'Поражение' },
  { value: 'win', label: 'Победа' },
];

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/Moscow',
});

const timeFormatter = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Moscow',
});

function ResultBadge({ result }: { result: GameRow['result'] }) {
  const className =
    result === 'Победа'
      ? 'result result--win'
      : result === 'Поражение'
        ? 'result result--loss'
        : 'result result--draw';

  return <span className={className}>{result}</span>;
}

function RatingChange({ value }: { value: GameRow['ratingDiff'] }) {
  const label = value === null
    ? 'Изменение рейтинга неизвестно'
    : `Изменение рейтинга: ${value > 0 ? `плюс ${value}` : value}`;
  const text = value === null ? '—' : value > 0 ? `+${value}` : String(value);
  const modifier = value === null || value === 0
    ? 'rating-change--neutral'
    : value > 0
      ? 'rating-change--positive'
      : 'rating-change--negative';

  return (
    <span className={`rating-change ${modifier}`} aria-label={label} title="Изменение рейтинга">
      {text}
    </span>
  );
}

function moscowDateStart(value: string) {
  const timestamp = Date.parse(`${value}T00:00:00+03:00`);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function rangeFor(period: Period, customFrom: string, customTo: string) {
  const now = Date.now();
  if (period === '30d') return { from: now - 30 * DAY_MS, to: now + 1 };
  if (period === '90d') return { from: now - 90 * DAY_MS, to: now + 1 };
  if (period === 'year') {
    const year = new Intl.DateTimeFormat('en', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
    }).format(now);
    return { from: Date.parse(`${year}-01-01T00:00:00+03:00`), to: now + 1 };
  }
  if (period === 'custom') {
    const from = customFrom ? moscowDateStart(customFrom) : undefined;
    const toStart = customTo ? moscowDateStart(customTo) : undefined;
    return { from, to: toStart === undefined ? undefined : toStart + DAY_MS };
  }
  return {};
}

export function GamesList({ username }: { username: string }) {
  const [period, setPeriod] = useState<Period>('90d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [speed, setSpeed] = useState<GameSpeed | ''>('');
  const [result, setResult] = useState<GameResult | ''>('');
  const [page, setPage] = useState(1);
  const range = useMemo(
    () => rangeFor(period, customFrom, customTo),
    [customFrom, customTo, period],
  );
  const qualityFilters = useMemo<QualityFilters>(() => ({
    ...range,
    speed: speed || undefined,
    result: result || undefined,
  }), [range, result, speed]);
  const { games, hasNext, total } = useMemo(
    () => getRecentGames(username, {
      page,
      speed: speed || undefined,
      result: result || undefined,
      ...range,
    }),
    [page, range, result, speed, username],
  );

  function changePeriod(nextPeriod: Period) {
    setPeriod(nextPeriod);
    setPage(1);
  }

  function changeSpeed(nextSpeed: GameSpeed | '') {
    setSpeed(nextSpeed);
    setPage(1);
  }

  function changeResult(nextResult: GameResult | '') {
    setResult(nextResult);
    setPage(1);
  }

  return (
    <div>
      <div className="filters" aria-label="Фильтры партий">
        <fieldset className="filter-group filter-group--period">
          <legend>Период</legend>
          <div className="filter-options">
            {periodFilters.map((filter) => (
              <button
                className="filter-chip"
                aria-pressed={period === filter.value}
                key={filter.value}
                onClick={() => changePeriod(filter.value)}
                type="button"
              >
                {filter.label}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <div className="custom-period">
              <label>
                <span>С</span>
                <input
                  onChange={(event) => {
                    setCustomFrom(event.target.value);
                    setPage(1);
                  }}
                  type="date"
                  value={customFrom}
                />
              </label>
              <label>
                <span>По</span>
                <input
                  min={customFrom || undefined}
                  onChange={(event) => {
                    setCustomTo(event.target.value);
                    setPage(1);
                  }}
                  type="date"
                  value={customTo}
                />
              </label>
            </div>
          )}
        </fieldset>

        <fieldset className="filter-group">
          <legend>Контроль</legend>
          <div className="filter-options">
            {speedFilters.map((filter) => (
              <button
                className="filter-chip"
                aria-pressed={speed === filter.value}
                key={filter.value || 'all-speeds'}
                onClick={() => changeSpeed(filter.value)}
                type="button"
              >
                {filter.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="filter-group">
          <legend>Результат</legend>
          <div className="filter-options">
            {resultFilters.map((filter) => (
              <button
                className="filter-chip"
                aria-pressed={result === filter.value}
                key={filter.value || 'all-results'}
                onClick={() => changeResult(filter.value)}
                type="button"
              >
                {filter.label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <QualityDashboard filters={qualityFilters} username={username} />

      {games.length === 0 ? (
        <div className="state-message">
          <p className="state-title">Подходящих партий нет</p>
          <p>Попробуйте изменить выбранные фильтры.</p>
        </div>
      ) : (
        <div className="games-list" aria-label="Список партий">
          <div className="table-header" aria-hidden="true">
            <span>Дата и время</span>
            <span>Контроль</span>
            <span>Соперник</span>
            <span>Результат / рейтинг</span>
          </div>
          {games.map((game) => (
            <Link
              aria-label={`Открыть партию против ${game.opponent}, результат: ${game.result}`}
              className="game-row"
              href={`/games/${encodeURIComponent(game.id)}`}
              key={game.id}
            >
              <div className="date-cell">
                <time dateTime={new Date(game.playedAt).toISOString()}>
                  <span>{dateFormatter.format(game.playedAt)}</span>
                  <small>{timeFormatter.format(game.playedAt)} МСК</small>
                </time>
              </div>
              <div className="game-cell" data-label="Контроль">
                <span className="clock-mark" aria-hidden="true" />
                <strong>{game.control}</strong>
              </div>
              <div className="game-cell opponent-cell" data-label="Соперник">
                <span className="avatar" aria-hidden="true">
                  {game.opponent.slice(0, 1).toUpperCase()}
                </span>
                <strong>{game.opponent}</strong>
              </div>
              <div className="result-cell" data-label="Результат">
                <ResultBadge result={game.result} />
                <RatingChange value={game.ratingDiff} />
              </div>
            </Link>
          ))}
        </div>
      )}

      {(page > 1 || hasNext) && (
        <nav className="pagination" aria-label="Страницы партий">
          <button
            className="page-button"
            disabled={page === 1}
            onClick={() => setPage((currentPage) => currentPage - 1)}
            type="button"
          >
            Назад
          </button>
          <span>Страница {page} · {total} партий</span>
          <button
            className="page-button"
            disabled={!hasNext}
            onClick={() => setPage((currentPage) => currentPage + 1)}
            type="button"
          >
            Вперёд
          </button>
        </nav>
      )}
    </div>
  );
}
