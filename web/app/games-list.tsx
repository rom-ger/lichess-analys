'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  getRecentGames,
  type GameResult,
  type GameRow,
  type GameSpeed,
} from '../lib/lichess';

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

export function GamesList({ username }: { username: string }) {
  const [speed, setSpeed] = useState<GameSpeed | ''>('');
  const [result, setResult] = useState<GameResult | ''>('');
  const [page, setPage] = useState(1);
  const { games, hasNext } = useMemo(
    () => getRecentGames(username, {
      page,
      speed: speed || undefined,
      result: result || undefined,
    }),
    [page, result, speed, username],
  );

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
          <span>Страница {page}</span>
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
