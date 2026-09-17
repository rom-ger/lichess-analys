'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  formatCentipawnEvaluation,
  loadStatisticsIndex,
  summarizeLostOpenings,
  type AnalysisFilters,
  type OpeningErrorGroup,
  type OpeningErrorType,
  type PlayerColor,
  type StatisticsIndex,
} from '../lib/statistics';

const pieces: Record<string, string> = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
};

const GROUP_PAGE_SIZE = 3;
const themeLabels: Record<OpeningErrorType, string> = {
  material: 'Потеря материала',
  'king-safety': 'Угрозы королю',
  development: 'Отставание в развитии',
  'pawn-structure': 'Ослабление пешечной структуры',
  other: 'Прочие ошибки',
};

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

export function MiniBoard({ fen, color, label = 'Позиция перед ошибкой' }: { fen: string; color: PlayerColor; label?: string }) {
  const squares = boardFromFen(fen);
  if (color === 'black') squares.reverse();

  return (
    <div
      className="opening-board"
      aria-label={`${label}, вид со стороны ${color === 'white' ? 'белых' : 'чёрных'}`}
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

function OpeningGroup({ group, featured }: { group: OpeningErrorGroup; featured: boolean }) {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(featured);
  const pages = Math.max(1, Math.ceil(group.examples.length / GROUP_PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const examples = group.examples.slice((currentPage - 1) * GROUP_PAGE_SIZE, currentPage * GROUP_PAGE_SIZE);

  return (
    <details className="opening-error-group" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span>{themeLabels[group.type]}</span>
        <strong>{group.examples.length} {plural(group.examples.length, 'партия', 'партии', 'партий')}</strong>
      </summary>
      <div className="opening-error-group-content">
        {examples.map((example) => {
          const theme = example.themes.find((item) => item.type === group.type)!;
          return (
            <article className="opening-mistake-card" key={example.gameId}>
              <MiniBoard color={example.color} fen={example.fen} />
              <div className="opening-mistake-content">
                <header>
                  <div>
                    <strong>Против {example.opponent}</strong>
                    <span>{dateFormatter.format(example.playedAt)} · {example.color === 'white' ? 'белыми' : 'чёрными'} · ход {example.moveNumber}</span>
                  </div>
                  <span className="opening-mistake-loss" title="Оценка за вас до и после ошибки">
                    {formatCentipawnEvaluation(example.beforeEvaluation)} → {formatCentipawnEvaluation(example.afterEvaluation)}
                  </span>
                </header>
                <div className="opening-mistake-answer">
                  <p><span>Вы сыграли</span><strong>{example.playedMove}</strong></p>
                  <span aria-hidden="true">→</span>
                  <p><span>Stockfish</span><strong>{example.bestMove ?? '—'}</strong></p>
                </div>
                <div className="opening-theme-evidence">
                  <strong>Почему в этой группе</strong>
                  <p>{theme.evidence}</p>
                  {theme.lineSan.length > 0 && (
                    <details>
                      <summary>Линия Stockfish после ошибки</summary>
                      <p className="opening-theme-line">{theme.lineSan.map((san, i) => moveLabel(example.ply + i + 1, san)).join(' ')}</p>
                    </details>
                  )}
                </div>
                <p className="opening-error-ending">
                  {example.badUntil === 'gameEnd'
                    ? 'Позиция не улучшалась до конца партии.'
                    : `Позиция не улучшалась до зевка соперника ${moveLabel(example.badUntilPly, example.opponentBlunderMove)}.`}
                </p>
                <Link className="opening-error-link" href={`/games/${encodeURIComponent(example.gameId)}?ply=${example.ply}`} rel="noopener noreferrer" target="_blank">
                  Открыть критический момент ↗
                </Link>
              </div>
            </article>
          );
        })}
        {pages > 1 && (
          <nav className="opening-mistakes-pagination" aria-label={`Страницы: ${themeLabels[group.type]}`}>
            <button className="page-button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} type="button">Назад</button>
            <span>{currentPage} из {pages}</span>
            <button className="page-button" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)} type="button">Вперёд</button>
          </nav>
        )}
      </div>
    </details>
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

  return (
    <section className="opening-mistakes" aria-labelledby="opening-mistakes-title">
      <header className="opening-mistakes-heading">
        <div>
          <span className="opening-mistakes-kicker">Где партия уходила из-под контроля</span>
          <h2 id="opening-mistakes-title">Проигранные дебюты</h2>
          <p>
            Ошибки сгруппированы по предполагаемым причинам, а не одинаковым позициям.
            Одна партия может входить в несколько групп; в общем счётчике она учтена один раз.
          </p>
          <details className="opening-selection-rules">
            <summary>Как отбираются партии</summary>
            <p>
              До {index.opening.earlyFullMoves}-го хода включительно — если ещё не наступил эндшпиль.
              С {index.opening.earlyFullMoves + 1}-го по {fullMoves}-й — пока хотя бы одна сторона
              не завершила развитие: вывела или разменяла минимум {index.opening.developedMinors} из 4
              исходных лёгких фигур и рокировала. Стадия определяется перед ошибкой.
              Оценка за вас падает с {formatCentipawnEvaluation(index.opening.notLostMinEvaluation)} или выше
              до {formatCentipawnEvaluation(index.opening.lostMaxEvaluation)} или ниже и больше
              не поднимается выше значения после ошибки — до конца партии или зевка соперника
              с потерей от {(index.opening.opponentBlunderLoss / 100).toFixed(2)} пешек.
              Учитываются любые результаты, включая победы по времени и после зевка соперника.
            </p>
          </details>
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

      {summary.groups.length === 0 ? (
        <div className="opening-mistakes-empty">
          <strong>Проигранных дебютов не найдено</strong>
          <p>
            {summary.selectedGames === 0
              ? 'Нет проанализированных партий с выбранными фильтрами.'
              : 'В выбранных партиях нет дебютных ходов, подходящих под эти условия.'}
          </p>
        </div>
      ) : (
        <div className="opening-mistakes-list">
          {summary.groups.map((group, i) => (
            <OpeningGroup group={group} featured={i === 0} key={`${username}:${filterKey}:${group.type}`} />
          ))}
        </div>
      )}
    </section>
  );
}
