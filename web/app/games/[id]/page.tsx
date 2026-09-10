import Link from 'next/link';
import { GameViewer } from './game-viewer';

const username = process.env.LICHESS_USERNAME?.trim();

export default async function GamePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ply?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const rawPly = Array.isArray(query.ply) ? query.ply[0] : query.ply;
  const parsedPly = Number(rawPly);
  const initialPly = Number.isInteger(parsedPly) && parsedPly >= 0 ? parsedPly : 0;

  return (
    <main className="game-page-shell">
      <header className="game-page-header">
        <Link className="back-link" href="/">
          <span aria-hidden="true">←</span> Все партии
        </Link>
        {username && <p className="account">@{username}</p>}
      </header>

      {!username ? (
        <div className="state-message game-state-message">
          <p className="state-title">Укажите аккаунт Lichess</p>
          <p>
            Добавьте <code>LICHESS_USERNAME=ваш_логин</code> в файл{' '}
            <code>web/.env.local</code>.
          </p>
        </div>
      ) : (
        <GameViewer
          gameId={decodeURIComponent(id)}
          initialPly={initialPly}
          key={`${id}:${initialPly}`}
          username={username}
        />
      )}
    </main>
  );
}
