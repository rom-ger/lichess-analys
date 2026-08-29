import Link from 'next/link';
import { GameViewer } from './game-viewer';

const username = process.env.LICHESS_USERNAME?.trim();

export default async function GamePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

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
        <GameViewer key={id} gameId={decodeURIComponent(id)} username={username} />
      )}
    </main>
  );
}
