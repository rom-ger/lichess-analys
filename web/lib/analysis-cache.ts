import {
  STOCKFISH_VERSION,
  type StockfishAnalysis,
} from './stockfish';

const DATABASE_NAME = 'lichess-analysis';
const STORE_NAME = 'positions';
const DATABASE_VERSION = 1;

function cacheKey(gameId: string, ply: number, fen: string, depth: number) {
  return `${STOCKFISH_VERSION}:${depth}:${gameId}:${ply}:${fen}`;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    });
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });
}

export async function getCachedAnalysis(
  gameId: string,
  ply: number,
  fen: string,
  depth: number,
) {
  if (typeof indexedDB === 'undefined') return null;

  try {
    const database = await openDatabase();
    return await new Promise<StockfishAnalysis | null>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(cacheKey(gameId, ply, fen, depth));
      request.addEventListener('success', () => resolve(request.result ?? null));
      request.addEventListener('error', () => reject(request.error));
      transaction.addEventListener('complete', () => database.close());
    });
  } catch {
    return null;
  }
}

export async function cacheAnalysis(
  gameId: string,
  ply: number,
  analysis: StockfishAnalysis,
) {
  if (typeof indexedDB === 'undefined') return;

  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(
        analysis,
        cacheKey(gameId, ply, analysis.fen, analysis.depth),
      );
      transaction.addEventListener('complete', () => {
        database.close();
        resolve();
      });
      transaction.addEventListener('error', () => reject(transaction.error));
    });
  } catch {
    // IndexedDB can be unavailable in private browsing; analysis still works in memory.
  }
}
