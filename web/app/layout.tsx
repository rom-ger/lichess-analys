import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Мои партии · Lichess',
  description: 'Десять последних сыгранных партий на Lichess.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
