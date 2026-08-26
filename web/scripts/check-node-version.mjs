const [major, minor] = process.versions.node.split('.').map(Number);
const isSupported = major > 22 || (major === 22 && minor >= 13);

if (!isSupported) {
  console.error(`
Нужен Node.js 22.13 или новее. Сейчас используется ${process.versions.node}.

Переключите версию и повторите команду:
  nvm install
  nvm use
  npm run dev
`);
  process.exit(1);
}
