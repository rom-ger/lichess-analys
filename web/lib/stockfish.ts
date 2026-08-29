import { Chess } from 'chess.js';
import type { PositionEvaluation } from './lichess';

export const STOCKFISH_VERSION = '18-lite';
export const STOCKFISH_DEPTH = 14;

const STOCKFISH_READY_TIMEOUT_MS = 20_000;
const STOCKFISH_ANALYSIS_TIMEOUT_MS = 45_000;
const STOCKFISH_WORKER_URL = '/stockfish/stockfish-18-lite-single.js';
const STOCKFISH_WASM_URL = '/stockfish/stockfish-18-lite-single.wasm';

export type StockfishAnalysis = {
  fen: string;
  depth: number;
  evaluation: PositionEvaluation;
  bestMove: string | null;
  pv: string[];
  pvSan: string[];
};

type PendingAnalysis = {
  fen: string;
  depth: number;
  signal?: AbortSignal;
  aborted: boolean;
  latest: StockfishAnalysis | null;
  resolve: (analysis: StockfishAnalysis) => void;
  reject: (error: Error) => void;
  removeAbortListener?: () => void;
  timeout?: ReturnType<typeof setTimeout>;
};

function evaluationFromUci(fen: string, kind: 'cp' | 'mate', rawValue: number) {
  const sideToMoveValue = kind === 'mate' && rawValue === 0 ? -1 : rawValue;
  const whiteValue = fen.split(' ')[1] === 'b' ? -sideToMoveValue : sideToMoveValue;
  return kind === 'mate'
    ? { kind: 'mate' as const, value: whiteValue }
    : { kind: 'centipawns' as const, value: whiteValue };
}

function variationToSan(fen: string, variation: string[]) {
  const chess = new Chess(fen);
  const san: string[] = [];

  for (const uci of variation) {
    const match = uci.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
    if (!match) break;

    try {
      const move = chess.move({
        from: match[1],
        to: match[2],
        promotion: match[3],
      });
      if (!move) break;
      san.push(move.san);
    } catch {
      break;
    }
  }

  return san;
}

function parseInfoLine(fen: string, line: string): StockfishAnalysis | null {
  const depthMatch = line.match(/\bdepth (\d+)/);
  const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/);
  if (!depthMatch || !scoreMatch) return null;

  const pvMatch = line.match(/\bpv (.+)$/);
  const pv = pvMatch ? pvMatch[1].trim().split(/\s+/) : [];
  const depth = Number(depthMatch[1]);
  const rawValue = Number(scoreMatch[2]);

  return {
    fen,
    depth,
    evaluation: evaluationFromUci(fen, scoreMatch[1] as 'cp' | 'mate', rawValue),
    bestMove: pv[0] ?? null,
    pv,
    pvSan: variationToSan(fen, pv),
  };
}

class StockfishEngine {
  private worker: Worker | null = null;
  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;
  private readyTimeout: ReturnType<typeof setTimeout> | null = null;
  private queue: PendingAnalysis[] = [];
  private current: PendingAnalysis | null = null;

  private ensureReady() {
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    // Stockfish reads the WASM URL from the fragment. The optional `,worker`
    // marker is reserved for workers spawned internally by the threaded build;
    // adding it here makes the single-threaded entrypoint skip initialization.
    const workerUrl = `${STOCKFISH_WORKER_URL}#${encodeURIComponent(STOCKFISH_WASM_URL)}`;
    this.worker = new Worker(workerUrl, { name: 'stockfish-analysis' });
    this.worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (typeof event.data !== 'string') return;
      for (const line of event.data.split(/\r?\n/)) this.handleLine(line.trim());
    });
    this.worker.addEventListener('error', (event) => {
      const details = event.message ? `: ${event.message}` : '';
      this.fail(new Error(`Не удалось запустить Stockfish в этом браузере${details}`));
    });
    this.worker.addEventListener('messageerror', () => {
      this.fail(new Error('Браузер не смог прочитать ответ Stockfish.'));
    });
    this.readyTimeout = setTimeout(() => {
      this.fail(new Error('Stockfish не загрузился за 20 секунд. Обновите страницу и попробуйте снова.'));
    }, STOCKFISH_READY_TIMEOUT_MS);
    this.worker.postMessage('uci');

    return this.readyPromise;
  }

  private handleLine(line: string) {
    if (!line) return;
    if (line === 'uciok') {
      this.worker?.postMessage('isready');
      return;
    }
    if (line === 'readyok') {
      if (this.readyTimeout) clearTimeout(this.readyTimeout);
      this.readyTimeout = null;
      this.resolveReady?.();
      this.resolveReady = null;
      this.rejectReady = null;
      this.pump();
      return;
    }

    if (line.startsWith('info ') && this.current) {
      const analysis = parseInfoLine(this.current.fen, line);
      if (analysis && (!this.current.latest || analysis.depth >= this.current.latest.depth)) {
        this.current.latest = analysis;
      }
      return;
    }

    if (line.startsWith('bestmove ') && this.current) {
      const task = this.current;
      const bestMove = line.split(/\s+/)[1];
      this.current = null;
      if (task.timeout) clearTimeout(task.timeout);
      task.removeAbortListener?.();

      if (task.aborted) {
        task.reject(new DOMException('Анализ отменён.', 'AbortError'));
      } else if (task.latest) {
        task.resolve({
          ...task.latest,
          bestMove: bestMove && bestMove !== '(none)' ? bestMove : task.latest.bestMove,
        });
      } else {
        task.reject(new Error('Stockfish не вернул оценку позиции.'));
      }
      this.pump();
    }
  }

  private fail(error: Error) {
    if (this.readyTimeout) clearTimeout(this.readyTimeout);
    this.readyTimeout = null;
    this.rejectReady?.(error);
    this.rejectReady = null;
    this.resolveReady = null;
    if (this.current) {
      if (this.current.timeout) clearTimeout(this.current.timeout);
      this.current.removeAbortListener?.();
      this.current.reject(error);
    }
    for (const task of this.queue) {
      task.removeAbortListener?.();
      task.reject(error);
    }
    this.current = null;
    this.queue = [];
    this.worker?.terminate();
    this.worker = null;
    this.readyPromise = null;
  }

  private pump() {
    if (!this.worker || this.current) return;

    let task = this.queue.shift();
    while (task?.aborted) {
      task.removeAbortListener?.();
      task.reject(new DOMException('Анализ отменён.', 'AbortError'));
      task = this.queue.shift();
    }
    if (!task) return;

    this.current = task;
    task.timeout = setTimeout(() => {
      this.fail(new Error('Stockfish не завершил анализ за 45 секунд. Попробуйте ещё раз.'));
    }, STOCKFISH_ANALYSIS_TIMEOUT_MS);
    this.worker.postMessage(`position fen ${task.fen}`);
    this.worker.postMessage(`go depth ${task.depth}`);
  }

  async analyze(fen: string, options?: { depth?: number; signal?: AbortSignal }) {
    await this.ensureReady();
    const depth = options?.depth ?? STOCKFISH_DEPTH;
    const signal = options?.signal;

    return new Promise<StockfishAnalysis>((resolve, reject) => {
      const task: PendingAnalysis = {
        fen,
        depth,
        signal,
        aborted: signal?.aborted ?? false,
        latest: null,
        resolve,
        reject,
      };

      const abort = () => {
        task.aborted = true;
        if (this.current === task) this.worker?.postMessage('stop');
      };
      signal?.addEventListener('abort', abort, { once: true });
      task.removeAbortListener = () => signal?.removeEventListener('abort', abort);
      this.queue.push(task);
      this.pump();
    });
  }
}

const stockfishEngine = new StockfishEngine();

export function analyzePosition(
  fen: string,
  options?: { depth?: number; signal?: AbortSignal },
) {
  return stockfishEngine.analyze(fen, options);
}
