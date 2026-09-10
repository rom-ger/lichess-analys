'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  loadStatisticsIndex,
  summarizeDecisiveEndgames,
  type AnalysisFilters,
  type DecisiveEndgameGroup,
  type EndgameType,
  type StatisticsIndex,
} from '../lib/statistics';
import { MiniBoard } from './opening-mistakes';

const GROUP_PAGE_SIZE = 3;

const endgameLabels: Record<EndgameType, string> = {
  'pawn-opposite-wings': 'Пешечный · пешки на разных флангах',
  'pawn-both-wings': 'Пешечный · игра на двух флангах',
  'pawn-one-wing': 'Пешечный · пешки на одном фланге',
  'rook-one-each': 'Ладейный · по одной ладье',
  'rook-two-each': 'Ладейный · по две ладьи',
  'rook-unbalanced': 'Ладейный · неравное число ладей',
  'rook-with-minors': 'Ладьи с лёгкими фигурами',
  'bishop-same-color': 'Слоны одного цвета',
  'bishop-opposite-color': 'Разноцветные слоны',
  bishop: 'Слоновый эндшпиль',
  knight: 'Коневой эндшпиль',
  'bishop-vs-knight': 'Слон против коня',
  'minor-mixed': 'Смешанные лёгкие фигуры',
  queen: 'Ферзевый эндшпиль',
  'queen-mixed': 'Ферзи с другими фигурами',
};

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/Moscow',
});

function plural(value: number, one: string, few: string, many: string) {
  const lastTwo = value % 100;
  const last = value % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function EndgameGroup({ group, featured }: { group: DecisiveEndgameGroup; featured: boolean }) {
  const pageKey = group.examples.map(({ gameId }) => gameId).join(',');
  const [pagination, setPagination] = useState({ key: pageKey, page: 1 });
  const [open, setOpen] = useState(featured);
  const requestedPage = pagination.key === pageKey ? pagination.page : 1;
  const totalPages = Math.max(1, Math.ceil(group.examples.length / GROUP_PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * GROUP_PAGE_SIZE;
  const examples = group.examples.slice(start, start + GROUP_PAGE_SIZE);

  return (
    <details
      className="endgame-group"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary>
        <span>{endgameLabels[group.type]}</span>
        <strong>
          {group.examples.length}{' '}
          {plural(group.examples.length, 'партия', 'партии', 'партий')}
        </strong>
      </summary>
      <div className="endgame-group-content">
        {examples.map((example) => (
          <article className="endgame-error-card" key={example.gameId}>
            <MiniBoard color={example.color} fen={example.fen} />
            <div className="endgame-error-content">
              <header>
                <div>
                  <strong>Против {example.opponent}</strong>
                  <span>{dateFormatter.format(example.playedAt)} · ход {example.moveNumber}</span>
                </div>
                <span className="endgame-evaluation-drop">
                  {example.beforeWinPercent.toFixed(0)}% → {example.afterWinPercent.toFixed(0)}%
                </span>
              </header>
              <div className="opening-mistake-answer">
                <p>
                  <span>Вы сыграли</span>
                  <strong>{example.playedMove}</strong>
                </p>
                <span aria-hidden="true">→</span>
                <p>
                  <span>Удерживало позицию</span>
                  <strong>{example.bestMove ?? '—'}</strong>
                  <small>Stockfish</small>
                </p>
              </div>
              <Link
                className="endgame-game-link"
                href={`/games/${encodeURIComponent(example.gameId)}?ply=${example.ply}`}
                rel="noopener noreferrer"
                target="_blank"
              >
                Открыть партию ↗
              </Link>
            </div>
          </article>
        ))}

        {totalPages > 1 && (
          <nav className="endgame-group-pagination" aria-label={`Страницы: ${endgameLabels[group.type]}`}>
            <button
              className="page-button"
              disabled={page === 1}
              onClick={() => setPagination({ key: pageKey, page: page - 1 })}
              type="button"
            >
              Назад
            </button>
            <span>{page} из {totalPages}</span>
            <button
              className="page-button"
              disabled={page === totalPages}
              onClick={() => setPagination({ key: pageKey, page: page + 1 })}
              type="button"
            >
              Вперёд
            </button>
          </nav>
        )}
      </div>
    </details>
  );
}

export function EndgameErrors({
  filters,
  username,
}: {
  filters: AnalysisFilters;
  username: string;
}) {
  const [index, setIndex] = useState<StatisticsIndex | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadStatisticsIndex()
      .then((value) => {
        if (active) setIndex(value);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { active = false; };
  }, []);

  const summary = useMemo(() => (
    index ? summarizeDecisiveEndgames(index.games, username, filters) : null
  ), [filters, index, username]);

  if (error) {
    return <div className="endgame-state endgame-state--error">{error}</div>;
  }
  if (!summary || !index) {
    return <div className="endgame-state">Ищу решающие ошибки в эндшпилях…</div>;
  }

  return (
    <section className="endgame-errors" aria-labelledby="endgame-errors-title">
      <header className="endgame-heading">
        <div>
          <span className="endgame-kicker">Где удерживаемая позиция стала проигранной</span>
          <h2 id="endgame-errors-title">Решающие ошибки в эндшпиле</h2>
          <p>
            До вашего хода было не меньше {index.endgame.notLostMinWinPercent}% шансов,
            после — не больше {index.endgame.lostMaxWinPercent}%, и затем позиция уже не восстановилась.
          </p>
        </div>
        <div className="endgame-sample">
          <strong>{summary.gamesWithDecisiveError}</strong>
          <span>{plural(summary.gamesWithDecisiveError, 'партия', 'партии', 'партий')}</span>
        </div>
      </header>

      {summary.groups.length === 0 ? (
        <div className="endgame-empty">
          <strong>Таких окончаний не найдено</strong>
          <p>
            {summary.lostGames === 0
              ? 'В выбранных партиях нет поражений.'
              : 'В поражениях этого периода не было одного решающего хода в удерживаемом эндшпиле.'}
          </p>
        </div>
      ) : (
        <div className="endgame-groups">
          {summary.groups.map((group, groupIndex) => (
            <EndgameGroup featured={groupIndex === 0} group={group} key={group.type} />
          ))}
        </div>
      )}
    </section>
  );
}
