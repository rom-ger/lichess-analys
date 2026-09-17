import type { Metadata } from 'next';
import './globals.css';
import './opening-mistakes.css';
import './endgame-errors.css';
import './period-summary.css';

export const metadata: Metadata = {
  title: 'Анализ моих партий · Lichess',
  description: 'Проигранные дебюты и просмотр локальной истории партий Lichess.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
