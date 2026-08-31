import { availableParallelism } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile, rename, stat, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const require = createRequire(import.meta.url);
const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = join(webRoot, '..');
const stockfishPackageRoot = dirname(require.resolve('stockfish/package.json'));
const stockfishScript = join(
  stockfishPackageRoot,
  'bin',
  'stockfish-18-lite-single.js',
);

const SCHEMA_VERSION = 1;
const ENGINE_NAME = 'Stockfish';
const ENGINE_VERSION = '18-lite';
const DEFAULT_DEPTH = 18;
const DEFAULT_WORKERS = Math.min(4, Math.max(1, availableParallelism() - 1));
const POSITION_TIMEOUT_MS = 120_000;
const ENGINE_READY_TIMEOUT_MS = 60_000;

function usage() {
  return `
Пакетный анализ PGN с помощью Stockfish 18 Lite.

Использование:
  npm run analyze:pgn -- [параметры]

Параметры:
  --pgn <путь>       PGN-файл или папка с PGN. Можно указать несколько раз.
                     По умолчанию: ${join(repositoryRoot, 'pgn')}
  --output <путь>    Папка с результатами.
  --depth <число>    Глубина анализа. По умолчанию: ${DEFAULT_DEPTH}
  --workers <число>  Число параллельных процессов. По умолчанию: ${DEFAULT_WORKERS}
  --force            Пересчитать даже уже готовые и актуальные партии.
  --dry-run          Только посчитать объём работы, не запускать Stockfish.
  --help             Показать эту справку.
`;
}

function parseArguments(argv) {
  const options = {
    depth: DEFAULT_DEPTH,
    dryRun: false,
    force: false,
    output: null,
    pgnPaths: [],
    workers: DEFAULT_WORKERS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];

    if (argument === '--help') {
      options.help = true;
    } else if (argument === '--force') {
      options.force = true;
    } else if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--pgn' && value) {
      options.pgnPaths.push(resolve(value));
      index += 1;
    } else if (argument === '--output' && value) {
      options.output = resolve(value);
      index += 1;
    } else if (argument === '--depth' && value) {
      options.depth = Number(value);
      index += 1;
    } else if (argument === '--workers' && value) {
      options.workers = Number(value);
      index += 1;
    } else {
      throw new Error(`Неизвестный или неполный параметр: ${argument}`);
    }
  }

  if (!Number.isInteger(options.depth) || options.depth < 1 || options.depth > 99) {
    throw new Error('--depth должен быть целым числом от 1 до 99.');
  }
  if (!Number.isInteger(options.workers) || options.workers < 1 || options.workers > 32) {
    throw new Error('--workers должен быть целым числом от 1 до 32.');
  }

  if (options.pgnPaths.length === 0) {
    options.pgnPaths.push(join(repositoryRoot, 'pgn'));
  }
  options.output ??= join(
    webRoot,
    'public',
    'analysis',
    `${ENGINE_NAME.toLowerCase()}-${ENGINE_VERSION}-depth-${options.depth}`,
  );

  return options;
}

async function resolvePgnFiles(paths) {
  const files = new Set();

  for (const path of paths) {
    const pathStat = await stat(path);
    if (pathStat.isDirectory()) {
      const names = await readdir(path);
      for (const name of names.sort()) {
        if (name.toLowerCase().endsWith('.pgn')) files.add(join(path, name));
      }
    } else if (pathStat.isFile() && path.toLowerCase().endsWith('.pgn')) {
      files.add(path);
    } else {
      throw new Error(`Ожидался PGN-файл или папка: ${path}`);
    }
  }

  if (files.size === 0) throw new Error('PGN-файлы не найдены.');
  return [...files];
}

function parseTags(gamePgn) {
  const header = gamePgn.split(/\r?\n\r?\n/, 1)[0];
  const tags = {};

  for (const match of header.matchAll(/^\[([A-Za-z0-9_]+) "(.*)"\]$/gm)) {
    tags[match[1]] = match[2].replaceAll('\\"', '"');
  }

  return tags;
}

function splitPgn(source) {
  return source.trim().split(/\r?\n\r?\n(?=\[Event )/);
}

function parseGame(gamePgn, sourceFile) {
  const tags = parseTags(gamePgn);
  if (!tags.Event || !tags.White || !tags.Black || !tags.Result) return null;
  if (tags.Variant && tags.Variant !== 'Standard') {
    throw new Error(`вариант ${tags.Variant} пока не поддерживается`);
  }

  const chess = new Chess();
  chess.loadPgn(gamePgn);
  const history = chess.history({ verbose: true });
  const initialFen = history[0]?.before ?? (tags.FEN ? new Chess(tags.FEN).fen() : new Chess().fen());
  const positions = [initialFen, ...history.map((move) => move.after)];
  const fallbackId = createHash('sha256').update(gamePgn).digest('hex').slice(0, 16);
  const id = tags.GameId ?? tags.Site?.split('/').at(-1) ?? fallbackId;
  const positionHash = createHash('sha256').update(positions.join('\n')).digest('hex');

  return {
    id,
    outputName: `${encodeURIComponent(id)}.json`,
    positionHash,
    positions,
    sourceFile,
  };
}

async function loadGames(pgnFiles) {
  const games = new Map();
  const failures = [];

  for (const file of pgnFiles) {
    const source = await readFile(file, 'utf8');
    const chunks = splitPgn(source);

    for (let index = 0; index < chunks.length; index += 1) {
      try {
        const game = parseGame(chunks[index], file);
        if (game) games.set(game.id, game);
      } catch (error) {
        failures.push({
          location: `${file}, партия ${index + 1}`,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return { games: [...games.values()], failures };
}

function isEvaluation(value) {
  return value
    && (value.kind === 'centipawns' || value.kind === 'mate')
    && Number.isFinite(value.value);
}

async function hasCompleteAnalysis(game, outputFile, depth) {
  try {
    const saved = JSON.parse(await readFile(outputFile, 'utf8'));
    return saved.schemaVersion === SCHEMA_VERSION
      && saved.gameId === game.id
      && saved.positionHash === game.positionHash
      && saved.engine?.name === ENGINE_NAME
      && saved.engine?.version === ENGINE_VERSION
      && saved.engine?.depth === depth
      && Array.isArray(saved.positions)
      && saved.positions.length === game.positions.length
      && saved.positions.every((position, ply) => (
        position.ply === ply
        && position.fen === game.positions[ply]
        && isEvaluation(position.evaluation)
        && (position.bestMove === null || typeof position.bestMove === 'string')
        && Array.isArray(position.pv)
        && position.pv.every((move) => typeof move === 'string')
      ));
  } catch {
    return false;
  }
}

function evaluationFromUci(fen, kind, rawValue) {
  const sideToMoveValue = kind === 'mate' && rawValue === 0 ? -1 : rawValue;
  const whiteValue = fen.split(' ')[1] === 'b' ? -sideToMoveValue : sideToMoveValue;
  return kind === 'mate'
    ? { kind: 'mate', value: whiteValue }
    : { kind: 'centipawns', value: whiteValue };
}

function parseInfoLine(fen, line) {
  const depthMatch = line.match(/\bdepth (\d+)/);
  const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/);
  if (!depthMatch || !scoreMatch) return null;

  const pvMatch = line.match(/\bpv (.+)$/);
  return {
    depth: Number(depthMatch[1]),
    evaluation: evaluationFromUci(fen, scoreMatch[1], Number(scoreMatch[2])),
    pv: pvMatch ? pvMatch[1].trim().split(/\s+/) : [],
  };
}

class UciEngine {
  constructor(label) {
    this.label = label;
    this.child = null;
    this.buffer = '';
    this.stderr = '';
    this.waiter = null;
    this.analysis = null;
    this.closing = false;
    this.exitPromise = null;
  }

  async start() {
    this.child = spawn(process.execPath, [stockfishScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.handleChunk(chunk));
    this.child.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-4_000);
    });
    this.child.on('error', (error) => this.fail(error));
    this.child.stdin.on('error', (error) => {
      // A process can close its input between the writable check and write().
      // During an intentional shutdown EPIPE is expected and can be ignored.
      if (!this.closing) this.fail(error);
    });
    this.exitPromise = new Promise((resolveExit) => {
      this.child.once('exit', (code, signal) => {
        resolveExit();
        if (!this.closing) {
          const details = this.stderr.trim();
          this.fail(new Error(
            `${this.label} завершился (${signal ?? code ?? 'неизвестно'})${details ? `: ${details}` : ''}`,
          ));
        }
      });
    });

    await this.commandUntil('uci', (line) => line === 'uciok', ENGINE_READY_TIMEOUT_MS);
    await this.commandUntil('isready', (line) => line === 'readyok', ENGINE_READY_TIMEOUT_MS);
  }

  write(command) {
    const child = this.child;
    if (
      !child
      || child.exitCode !== null
      || child.signalCode !== null
      || !child.stdin.writable
      || child.stdin.destroyed
      || child.stdin.writableEnded
    ) {
      throw new Error(`${this.label} недоступен.`);
    }
    child.stdin.write(`${command}\n`);
  }

  handleChunk(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';
    for (const line of lines) this.handleLine(line.trim());
  }

  handleLine(line) {
    if (!line) return;

    if (this.analysis) {
      if (line.startsWith('info ')) {
        const parsed = parseInfoLine(this.analysis.fen, line);
        if (parsed && (!this.analysis.latest || parsed.depth >= this.analysis.latest.depth)) {
          this.analysis.latest = parsed;
        }
      } else if (line.startsWith('bestmove ')) {
        const pending = this.analysis;
        this.analysis = null;
        clearTimeout(pending.timeout);
        const bestMove = line.split(/\s+/)[1];

        if (!pending.latest) {
          pending.reject(new Error('Stockfish не вернул оценку позиции.'));
        } else {
          pending.resolve({
            evaluation: pending.latest.evaluation,
            bestMove: bestMove && bestMove !== '(none)' ? bestMove : null,
            pv: pending.latest.pv,
          });
        }
      }
    }

    if (this.waiter?.predicate(line)) {
      const waiter = this.waiter;
      this.waiter = null;
      clearTimeout(waiter.timeout);
      waiter.resolve();
    }
  }

  commandUntil(command, predicate, timeoutMs) {
    if (!this.child?.stdin.writable) {
      return Promise.reject(new Error(`${this.label} недоступен.`));
    }
    if (this.waiter) {
      return Promise.reject(new Error(`${this.label} уже ожидает ответ на другую команду.`));
    }

    return new Promise((resolveCommand, rejectCommand) => {
      const timeout = setTimeout(() => {
        this.waiter = null;
        rejectCommand(new Error(`${this.label} не ответил на команду ${command}.`));
      }, timeoutMs);
      this.waiter = {
        predicate,
        reject: rejectCommand,
        resolve: resolveCommand,
        timeout,
      };
      try {
        this.write(command);
      } catch (error) {
        clearTimeout(timeout);
        this.waiter = null;
        rejectCommand(error);
      }
    });
  }

  analyze(fen, depth) {
    if (!this.child?.stdin.writable) {
      return Promise.reject(new Error(`${this.label} недоступен.`));
    }
    if (this.analysis) {
      return Promise.reject(new Error(`${this.label} уже анализирует позицию.`));
    }

    return new Promise((resolveAnalysis, rejectAnalysis) => {
      const timeout = setTimeout(() => {
        this.analysis = null;
        rejectAnalysis(new Error(`${this.label} не завершил позицию за 120 секунд.`));
        this.child?.kill();
      }, POSITION_TIMEOUT_MS);
      this.analysis = {
        fen,
        latest: null,
        reject: rejectAnalysis,
        resolve: resolveAnalysis,
        timeout,
      };
      try {
        this.write(`position fen ${fen}`);
        this.write(`go depth ${depth}`);
      } catch (error) {
        this.fail(error);
      }
    });
  }

  fail(error) {
    if (this.waiter) {
      clearTimeout(this.waiter.timeout);
      this.waiter.reject(error);
      this.waiter = null;
    }
    if (this.analysis) {
      clearTimeout(this.analysis.timeout);
      this.analysis.reject(error);
      this.analysis = null;
    }
  }

  async close() {
    const child = this.child;
    if (!child) return;
    this.closing = true;
    if (child.exitCode === null && child.signalCode === null) {
      try {
        this.write('quit');
      } catch {
        // The engine already stopped accepting commands; wait for exit below.
      }
    }
    await Promise.race([
      this.exitPromise,
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
    ]);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

async function writeJsonAtomically(outputFile, value) {
  const temporaryFile = join(
    dirname(outputFile),
    `.${randomUUID()}.${basename(outputFile)}.tmp`,
  );
  await writeFile(temporaryFile, `${JSON.stringify(value)}\n`, 'utf8');
  await rename(temporaryFile, outputFile);
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const rest = rounded % 60;
  return hours > 0
    ? `${hours}ч ${minutes}м`
    : `${minutes}м ${rest}с`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const pgnFiles = await resolvePgnFiles(options.pgnPaths);
  const { games, failures: parseFailures } = await loadGames(pgnFiles);

  const pending = [];
  let skippedGames = 0;
  let skippedPositions = 0;
  for (const game of games) {
    const outputFile = join(options.output, game.outputName);
    if (!options.force && await hasCompleteAnalysis(game, outputFile, options.depth)) {
      skippedGames += 1;
      skippedPositions += game.positions.length;
    } else {
      pending.push({ ...game, outputFile });
    }
  }

  const pendingPositions = pending.reduce((total, game) => total + game.positions.length, 0);
  console.log(`PGN-файлов: ${pgnFiles.length}`);
  console.log(`Партий: ${games.length}; позиций: ${games.reduce((sum, game) => sum + game.positions.length, 0)}`);
  console.log(`Уже готовы: ${skippedGames} партий (${skippedPositions} позиций)`);
  console.log(`Осталось: ${pending.length} партий (${pendingPositions} позиций)`);
  console.log(`Глубина: ${options.depth}; процессов: ${options.workers}`);
  console.log(`Результаты: ${options.output}`);

  if (parseFailures.length > 0) {
    console.warn(`Не удалось прочитать ${parseFailures.length} партий:`);
    for (const failure of parseFailures.slice(0, 20)) {
      console.warn(`  ${failure.location}: ${failure.message}`);
    }
  }
  if (options.dryRun || pending.length === 0) return;

  await mkdir(options.output, { recursive: true });

  let nextGameIndex = 0;
  let completedGames = 0;
  let completedPositions = 0;
  let stopRequested = false;
  const analysisFailures = [];
  const startedAt = Date.now();

  process.once('SIGINT', () => {
    stopRequested = true;
    console.log('\nОстановка запрошена. Текущие партии будут завершены и сохранены.');
  });

  async function workerLoop(workerNumber) {
    let engine = null;

    async function restartEngine() {
      await engine?.close();
      engine = new UciEngine(`Stockfish #${workerNumber}`);
      await engine.start();
    }

    async function analyzeWithRetry(fen, depth) {
      let lastError;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          if (!engine) await restartEngine();
          return await engine.analyze(fen, depth);
        } catch (error) {
          lastError = error;
          await engine?.close();
          engine = null;
          if (attempt < 2) console.warn(`Stockfish #${workerNumber}: перезапуск после ошибки.`);
        }
      }
      throw lastError;
    }

    try {
      while (!stopRequested) {
        const taskIndex = nextGameIndex;
        nextGameIndex += 1;
        const game = pending[taskIndex];
        if (!game) break;

        try {
          const positions = [];
          for (let ply = 0; ply < game.positions.length; ply += 1) {
            const fen = game.positions[ply];
            const analysis = await analyzeWithRetry(fen, options.depth);
            positions.push({ ply, fen, ...analysis });
          }

          await writeJsonAtomically(game.outputFile, {
            schemaVersion: SCHEMA_VERSION,
            gameId: game.id,
            positionHash: game.positionHash,
            engine: {
              name: ENGINE_NAME,
              version: ENGINE_VERSION,
              depth: options.depth,
            },
            analyzedAt: new Date().toISOString(),
            positions,
          });

          completedGames += 1;
          completedPositions += positions.length;
          const elapsedSeconds = (Date.now() - startedAt) / 1000;
          const positionsPerSecond = completedPositions / elapsedSeconds;
          const remainingSeconds = (pendingPositions - completedPositions) / positionsPerSecond;
          console.log(
            `[${completedGames}/${pending.length}] ${game.id}: ${positions.length} позиций; `
            + `${positionsPerSecond.toFixed(2)} поз/с; осталось ${formatDuration(remainingSeconds)}`,
          );
        } catch (error) {
          analysisFailures.push({
            gameId: game.id,
            message: error instanceof Error ? error.message : String(error),
          });
          console.error(`${game.id}: анализ не сохранён: ${analysisFailures.at(-1).message}`);
        }
      }
    } finally {
      await engine?.close();
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(options.workers, pending.length) },
      (_, index) => workerLoop(index + 1),
    ),
  );

  const manifestGames = [];
  for (const game of games) {
    const outputFile = join(options.output, game.outputName);
    if (await hasCompleteAnalysis(game, outputFile, options.depth)) {
      manifestGames.push({
        gameId: game.id,
        file: game.outputName,
        positionHash: game.positionHash,
        positions: game.positions.length,
      });
    }
  }
  await writeJsonAtomically(join(options.output, 'manifest.json'), {
    schemaVersion: SCHEMA_VERSION,
    engine: { name: ENGINE_NAME, version: ENGINE_VERSION, depth: options.depth },
    generatedAt: new Date().toISOString(),
    games: manifestGames,
  });

  console.log(`Готово за ${formatDuration((Date.now() - startedAt) / 1000)}.`);
  console.log(`Сохранено в этом запуске: ${completedGames} партий (${completedPositions} позиций).`);
  if (stopRequested) console.log('Запуск остановлен; при повторе готовые партии будут пропущены.');
  if (analysisFailures.length > 0 || parseFailures.length > 0) {
    console.error(`Ошибок анализа: ${analysisFailures.length}; ошибок PGN: ${parseFailures.length}.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
