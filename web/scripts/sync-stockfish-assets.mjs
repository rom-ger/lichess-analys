import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const stockfishRoot = join(projectRoot, 'node_modules', 'stockfish');
const outputRoot = join(projectRoot, 'public', 'stockfish');

await mkdir(outputRoot, { recursive: true });
await Promise.all([
  copyFile(
    join(stockfishRoot, 'bin', 'stockfish-18-lite-single.js'),
    join(outputRoot, 'stockfish-18-lite-single.js'),
  ),
  copyFile(
    join(stockfishRoot, 'bin', 'stockfish-18-lite-single.wasm'),
    join(outputRoot, 'stockfish-18-lite-single.wasm'),
  ),
  copyFile(
    join(stockfishRoot, 'Copying.txt'),
    join(outputRoot, 'COPYING.txt'),
  ),
]);
