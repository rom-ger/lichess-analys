import { GamesList } from './games-list';

const username = process.env.LICHESS_USERNAME?.trim();

export default function Home() {
  return (
    <main className="page-shell">
      <section className="games-panel" aria-labelledby="page-title">
        <header className="page-header">
          <div>
            <p className="eyebrow">Lichess · последние партии</p>
            <h1 id="page-title">Мои партии</h1>
          </div>
          {username && <p className="account">@{username}</p>}
        </header>

        {!username ? (
          <div className="state-message">
            <p className="state-title">Укажите аккаунт Lichess</p>
            <p>
              Создайте файл <code>.env.local</code> в папке <code>web</code> и добавьте
              в него <code>LICHESS_USERNAME=ваш_логин</code>.
            </p>
          </div>
        ) : (
          <GamesList username={username} />
        )}
      </section>
    </main>
  );
}
