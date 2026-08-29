'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getGameById,
  type GameDetails,
  type GameMove,
  type GamePlayer,
} from '../../../lib/lichess';

const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];

const pieces: Record<string, string> = {
  K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
};

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Moscow',
});

function boardFromFen(fen: string) {
  const position = new Map<string, string>();
  const fenRanks = fen.split(' ')[0].split('/');

  fenRanks.forEach((rank, rankIndex) => {
    let fileIndex = 0;
    for (const symbol of rank) {
      const emptySquares = Number(symbol);
      if (Number.isInteger(emptySquares) && emptySquares > 0) {
        fileIndex += emptySquares;
      } else {
        position.set(`${files[fileIndex]}${8 - rankIndex}`, symbol);
        fileIndex += 1;
      }
    }
  });

  return position;
}

function ChessBoard({
  fen,
  orientation,
  lastMove,
}: {
  fen: string;
  orientation: GameDetails['playerColor'];
  lastMove?: GameMove;
}) {
  const position = useMemo(() => boardFromFen(fen), [fen]);
  const shownFiles = orientation === 'white' ? files : [...files].reverse();
  const shownRanks = orientation === 'white' ? ranks : [...ranks].reverse();

  return (
    <div
      aria-label={`Шахматная доска, ход ${lastMove?.san ?? 'начальная позиция'}`}
      className="chess-board"
      role="img"
    >
      {shownRanks.flatMap((rank, rankIndex) => shownFiles.map((file, fileIndex) => {
        const square = `${file}${rank}`;
        const piece = position.get(square);
        const isDark = (files.indexOf(file) + Number(rank)) % 2 === 1;
        const isLastMove = square === lastMove?.from || square === lastMove?.to;

        return (
          <div
            className={`board-square board-square--${isDark ? 'dark' : 'light'}${isLastMove ? ' board-square--last' : ''}`}
            key={square}
          >
            {fileIndex === 0 && <span className="rank-label">{rank}</span>}
            {rankIndex === 7 && <span className="file-label">{file}</span>}
            {piece && (
              <span
                aria-label={`${piece === piece.toUpperCase() ? 'Белая' : 'Чёрная'} фигура на ${square}`}
                className={`chess-piece chess-piece--${piece === piece.toUpperCase() ? 'white' : 'black'}`}
              >
                {pieces[piece]}
              </span>
            )}
          </div>
        );
      }))}
    </div>
  );
}

function formatClock(seconds: number | null) {
  if (seconds === null) return null;
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const secondsLabel = String(wholeSeconds).padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${secondsLabel}`;
  }
  return `${minutes}:${secondsLabel}`;
}

function PlayerBar({
  clockSeconds,
  materialAdvantage,
  player,
  score,
}: {
  clockSeconds: number | null;
  materialAdvantage: number;
  player: GamePlayer;
  score: string;
}) {
  const clock = formatClock(clockSeconds);

  return (
    <div className="player-bar">
      <span className="player-avatar" aria-hidden="true">
        {player.name.slice(0, 1).toUpperCase()}
      </span>
      <strong>{player.name}</strong>
      {player.rating !== null && <span className="player-rating">{player.rating}</span>}
      <div className="player-position-data">
        {materialAdvantage > 0 && (
          <span
            aria-label={`Преимущество по материалу: ${materialAdvantage}`}
            className="material-advantage"
            title="Преимущество по материалу"
          >
            +{materialAdvantage}
          </span>
        )}
        {clock && <time className="player-clock">{clock}</time>}
        <span className="player-score">{score}</span>
      </div>
    </div>
  );
}

function scoresFor(game: GameDetails) {
  if (game.result === 'Ничья') return { white: '½', black: '½' };
  const playerWon = game.result === 'Победа';
  const whiteWon = (game.playerColor === 'white' && playerWon)
    || (game.playerColor === 'black' && !playerWon);
  return whiteWon ? { white: '1', black: '0' } : { white: '0', black: '1' };
}

export function GameViewer({ gameId, username }: { gameId: string; username: string }) {
  const game = useMemo(() => getGameById(username, gameId), [gameId, username]);
  const [currentPly, setCurrentPly] = useState(0);
  const activeMoveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!game) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setCurrentPly((ply) => Math.max(0, ply - 1));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setCurrentPly((ply) => Math.min(game.moves.length, ply + 1));
      } else if (event.key === 'Home') {
        event.preventDefault();
        setCurrentPly(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        setCurrentPly(game.moves.length);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [game]);

  useEffect(() => {
    activeMoveRef.current?.scrollIntoView({ block: 'nearest' });
  }, [currentPly]);

  if (!game) {
    return (
      <div className="state-message game-state-message">
        <p className="state-title">Партия не найдена</p>
        <p>Возможно, её больше нет среди локальных PGN-файлов.</p>
        <Link className="state-link" href="/">Вернуться к списку</Link>
      </div>
    );
  }

  const currentMove = currentPly > 0 ? game.moves[currentPly - 1] : undefined;
  const fen = currentMove?.fen ?? game.initialFen;
  const whiteClockSeconds = currentMove?.whiteClockSeconds ?? game.initialClockSeconds;
  const blackClockSeconds = currentMove?.blackClockSeconds ?? game.initialClockSeconds;
  const materialBalance = currentMove?.materialBalance ?? game.initialMaterialBalance;
  const score = scoresFor(game);
  const bottomPlayer = game.playerColor === 'white' ? game.white : game.black;
  const topPlayer = game.playerColor === 'white' ? game.black : game.white;
  const bottomScore = game.playerColor === 'white' ? score.white : score.black;
  const topScore = game.playerColor === 'white' ? score.black : score.white;
  const whiteMaterialAdvantage = Math.max(0, materialBalance);
  const blackMaterialAdvantage = Math.max(0, -materialBalance);
  const bottomClock = game.playerColor === 'white' ? whiteClockSeconds : blackClockSeconds;
  const topClock = game.playerColor === 'white' ? blackClockSeconds : whiteClockSeconds;
  const bottomMaterialAdvantage = game.playerColor === 'white'
    ? whiteMaterialAdvantage
    : blackMaterialAdvantage;
  const topMaterialAdvantage = game.playerColor === 'white'
    ? blackMaterialAdvantage
    : whiteMaterialAdvantage;
  const moveRows = Array.from({ length: Math.ceil(game.moves.length / 2) }, (_, index) => ({
    number: index + 1,
    white: game.moves[index * 2],
    black: game.moves[index * 2 + 1],
  }));

  return (
    <section className="game-viewer" aria-labelledby="game-title">
      <div className="board-column">
        <PlayerBar
          clockSeconds={topClock}
          materialAdvantage={topMaterialAdvantage}
          player={topPlayer}
          score={topScore}
        />
        <ChessBoard fen={fen} lastMove={currentMove} orientation={game.playerColor} />
        <PlayerBar
          clockSeconds={bottomClock}
          materialAdvantage={bottomMaterialAdvantage}
          player={bottomPlayer}
          score={bottomScore}
        />
      </div>

      <aside className="moves-panel">
        <header className="moves-header">
          <p className="eyebrow">{game.control} · {game.result}</p>
          <h1 id="game-title">{game.white.name} — {game.black.name}</h1>
          <p className="game-meta">
            <time dateTime={new Date(game.playedAt).toISOString()}>
              {dateFormatter.format(game.playedAt)} МСК
            </time>
            {game.termination && <span>{game.termination}</span>}
          </p>
        </header>

        <div className="moves-list" aria-label="Ходы партии">
          {moveRows.map((row) => (
            <div className="move-row" key={row.number}>
              <span className="move-number">{row.number}.</span>
              {[row.white, row.black].map((move, colorIndex) => move ? (
                <button
                  aria-current={currentPly === move.ply ? 'step' : undefined}
                  className="move-button"
                  key={move.ply}
                  onClick={() => setCurrentPly(move.ply)}
                  ref={currentPly === move.ply ? activeMoveRef : undefined}
                  type="button"
                >
                  <span>{move.san}</span>
                  {move.clockSeconds !== null && (
                    <time>{formatClock(move.clockSeconds)}</time>
                  )}
                </button>
              ) : <span key={colorIndex} />)}
            </div>
          ))}
        </div>

        <div className="move-controls" aria-label="Навигация по ходам">
          <button aria-label="В начало" disabled={currentPly === 0} onClick={() => setCurrentPly(0)} type="button">«</button>
          <button aria-label="На ход назад" disabled={currentPly === 0} onClick={() => setCurrentPly((ply) => ply - 1)} type="button">‹</button>
          <span>{currentPly} / {game.moves.length}</span>
          <button aria-label="На ход вперёд" disabled={currentPly === game.moves.length} onClick={() => setCurrentPly((ply) => ply + 1)} type="button">›</button>
          <button aria-label="В конец" disabled={currentPly === game.moves.length} onClick={() => setCurrentPly(game.moves.length)} type="button">»</button>
        </div>

        <footer className="moves-footer">
          <span>Навигация: ← → Home End</span>
          {game.siteUrl && (
            <a href={game.siteUrl} rel="noreferrer" target="_blank">Открыть на Lichess ↗</a>
          )}
        </footer>
      </aside>
    </section>
  );
}
