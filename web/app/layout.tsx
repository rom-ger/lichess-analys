import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Анализ моих партий · Lichess',
  description: 'Статистика качества игры и просмотр локальной истории партий Lichess.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
