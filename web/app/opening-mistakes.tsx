'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  formatCentipawnEvaluation,
  loadStatisticsIndex,
  summarizeLostOpenings,
  type AnalysisFilters,
  type PlayerColor,
  type StatisticsIndex,
} from '../lib/statistics';

const pieces: Record<string, string> = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
};

const OPENINGS_PAGE_SIZE = 5;

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/Moscow',
});

function moveLabel(ply: number, move: string | null) {
  const number = Math.ceil(ply / 2);
  return `${number}${ply % 2 === 1 ? '.' : '...'}${move ?? ''}`;
}

function plural(value: number, one: string, few: string, many: string) {
  const lastTwo = value % 100;
  const last = value % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function boardFromFen(fen: string) {
  return fen.split(' ')[0].split('/').flatMap((row, rowIndex) => {
    const rank = 8 - rowIndex;
    let file = 0;
    const squares: Array<{ id: string; piece: string | null; dark: boolean }> = [];

    for (const token of row) {
      const empty = Number(token);
      if (Number.isInteger(empty) && empty > 0) {
        for (let offset = 0; offset < empty; offset += 1) {
          squares.push({
            id: `${String.fromCharCode(97 + file)}${rank}`,
            piece: null,
            dark: (file + rank) % 2 === 1,
          });
          file += 1;
        }
      } else {
        squares.push({
          id: `${String.fromCharCode(97 + file)}${rank}`,
          piece: pieces[token] ?? null,
          dark: (file + rank) % 2 === 1,
        });
        file += 1;
      }
    }

    return squares;
  });
}

export function MiniBoard({ fen, color }: { fen: string; color: PlayerColor }) {
  const squares = boardFromFen(fen);
  if (color === 'black') squares.reverse();

  return (
    <div
      className="opening-board"
      aria-label={`Позиция перед ошибкой, вид со стороны ${color === 'white' ? 'белых' : 'чёрных'}`}
      role="img"
    >
      {squares.map((square) => (
        <span
          className={square.dark ? 'opening-board-square opening-board-square--dark' : 'opening-board-square'}
          key={square.id}
        >
          {square.piece && <b aria-hidden="true">{square.piece}</b>}
        </span>
      ))}
    </div>
  );
}

export function OpeningMistakes({
  filters,
  username,
}: {
  filters: AnalysisFilters;
  username: string;
}) {
  const [index, setIndex] = useState<StatisticsIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({ filterKey: '', page: 1 });

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
    index
      ? summarizeLostOpenings(index.games, username, filters)
      : null
  ), [filters, index, username]);

  if (error) {
    return <div className="opening-mistakes-state opening-mistakes-state--error">{error}</div>;
  }

  if (!summary || !index) {
    return <div className="opening-mistakes-state">Ищу проигранные дебюты…</div>;
  }

  const fullMoves = Math.ceil(index.opening.plies / 2);
  const filterKey = `${filters.from ?? ''}:${filters.to ?? ''}:${filters.speed ?? ''}:${filters.result ?? ''}`;
  const totalPages = Math.max(1, Math.ceil(summary.positions.length / OPENINGS_PAGE_SIZE));
  const requestedPage = pagination.filterKey === filterKey ? pagination.page : 1;
  const currentPage = Math.min(requestedPage, totalPages);
  const pageStart = (currentPage - 1) * OPENINGS_PAGE_SIZE;
  const visiblePositions = summary.positions.slice(pageStart, pageStart + OPENINGS_PAGE_SIZE);

  return (
    <section className="opening-mistakes" aria-labelledby="opening-mistakes-title">
      <header className="opening-mistakes-heading">
        <div>
          <span className="opening-mistakes-kicker">Где партия уходила из-под контроля</span>
          <h2 id="opening-mistakes-title">Проигранные дебюты</h2>
          <p>
            Первый ход в первые {fullMoves} ходов, ухудшивший оценку минимум на{' '}
            {(index.opening.minimumEvaluationLoss / 100).toFixed(2)} пешки и оставивший
            оценку за вас не выше {formatCentipawnEvaluation(index.opening.badPositionMaxEvaluation)}.
            После него позиция уже не
            восстанавливалась без явного зевка соперника.
          </p>
        </div>
        <div className="opening-mistakes-sample">
          <strong>{summary.gamesWithLostOpening}</strong>
          <span>
            {plural(
              summary.gamesWithLostOpening,
              'проигранный дебют',
              'проигранных дебюта',
              'проигранных дебютов',
            )}
          </span>
        </div>
      </header>

      {summary.positions.length === 0 ? (
        <div className="opening-mistakes-empty">
          <strong>Проигранных дебютов не найдено</strong>
          <p>
            {summary.lostGames === 0
              ? 'В выбранных партиях нет поражений. Измените фильтр результата или период.'
              : 'В поражениях этого периода позиция после дебютных ошибок либо оставалась приемлемой, либо затем восстанавливалась.'}
          </p>
        </div>
      ) : (
        <>
          <div className="opening-mistakes-list">
            {visiblePositions.map((position, indexValue) => (
              <article className="opening-mistake-card" key={position.positionKey}>
                <div className="opening-mistake-rank" aria-label={`Место ${pageStart + indexValue + 1}`}>
                  {pageStart + indexValue + 1}
                </div>
                <MiniBoard color={position.color} fen={position.fen} />
                <div className="opening-mistake-content">
                  <header>
                    <div>
                      <strong>
                        {position.games}{' '}
                        {plural(position.games, 'проигранный дебют', 'проигранных дебюта', 'проигранных дебютов')}
                      </strong>
                      <span>После этого хода положение не исправлялось без зевка соперника</span>
                    </div>
                    <span className="opening-mistake-loss">
                      {formatCentipawnEvaluation(position.averageAfterEvaluation)} за вас
                    </span>
                  </header>

                  <div className="opening-mistake-answer">
                    <p>
                      <span>Вы сыграли</span>
                      <strong>{position.playedMove}</strong>
                      {position.playedMoveCount > 1 && <small>{position.playedMoveCount} раза</small>}
                    </p>
                    <span aria-hidden="true">→</span>
                    <p>
                      <span>Стоило сыграть</span>
                      <strong>{position.bestMove ?? '—'}</strong>
                      <small>Stockfish</small>
                    </p>
                  </div>

                  <details className="opening-mistake-games">
                    <summary>Посмотреть партии ({position.games})</summary>
                    <div>
                      {position.examples.map((example) => (
                        <Link
                          href={`/games/${encodeURIComponent(example.gameId)}?ply=${example.ply}`}
                          key={example.gameId}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          <span>против {example.opponent}</span>
                          <small>
                            {dateFormatter.format(example.playedAt)} · {example.moveNumber}
                            {position.color === 'white' ? '.' : '...'}{example.playedMove} ·{' '}
                            {example.badUntil === 'gameEnd'
                              ? 'плохо до конца'
                              : `до зевка ${moveLabel(example.badUntilPly, example.opponentBlunderMove)}`}
                          </small>
                        </Link>
                      ))}
                    </div>
                  </details>
                </div>
              </article>
            ))}
          </div>
          {totalPages > 1 && (
            <nav className="opening-mistakes-pagination" aria-label="Страницы проигранных дебютов">
              <button
                className="page-button"
                disabled={currentPage === 1}
                onClick={() => setPagination({ filterKey, page: currentPage - 1 })}
                type="button"
              >
                Назад
              </button>
              <span>
                Страница {currentPage} из {totalPages} · {summary.positions.length}{' '}
                {plural(summary.positions.length, 'позиция', 'позиции', 'позиций')}
              </span>
              <button
                className="page-button"
                disabled={currentPage === totalPages}
                onClick={() => setPagination({ filterKey, page: currentPage + 1 })}
                type="button"
              >
                Вперёд
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
