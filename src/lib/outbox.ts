import { get, set } from 'idb-keyval';
import { api, ApiError, newIdempotencyKey } from './api';
import type { CreateTransactionPayload } from './types';

/**
 * The offline outbox.
 *
 * When a write cannot reach the server, it is parked here with the
 * idempotency key it was created with — never a new one. On reconnect every
 * entry is replayed in order; the server recognises a key it has already
 * committed and returns the original transaction instead of writing a second.
 *
 * That is the whole duplicate-prevention story: the key is minted once, on
 * the device, before the first attempt.
 */

const STORE_KEY = 'ledger.outbox.v1';
const MAX_ATTEMPTS = 8;

export interface OutboxEntry {
  id: string;
  payload: CreateTransactionPayload;
  queuedAt: number;
  attempts: number;
  lastError: string | null;
}

type Listener = (entries: OutboxEntry[]) => void;

const listeners = new Set<Listener>();
let cache: OutboxEntry[] | null = null;
let flushing = false;

async function read(): Promise<OutboxEntry[]> {
  if (cache) return cache;
  cache = (await get<OutboxEntry[]>(STORE_KEY)) ?? [];
  return cache;
}

async function write(entries: OutboxEntry[]): Promise<void> {
  cache = entries;
  await set(STORE_KEY, entries);
  listeners.forEach((listener) => listener(entries));
}

export function subscribeToOutbox(listener: Listener): () => void {
  listeners.add(listener);
  void read().then(listener);
  return () => listeners.delete(listener);
}

export async function getOutbox(): Promise<OutboxEntry[]> {
  return read();
}

/** Park a write that could not be delivered. */
export async function enqueue(payload: CreateTransactionPayload): Promise<OutboxEntry> {
  const entries = await read();
  const entry: OutboxEntry = {
    id: payload.idempotencyKey ?? newIdempotencyKey(),
    payload: { ...payload, idempotencyKey: payload.idempotencyKey ?? newIdempotencyKey() },
    queuedAt: Date.now(),
    attempts: 0,
    lastError: null,
  };
  await write([...entries, entry]);
  return entry;
}

export async function removeFromOutbox(id: string): Promise<void> {
  const entries = await read();
  await write(entries.filter((e) => e.id !== id));
}

export interface FlushResult {
  sent: number;
  failed: number;
  remaining: number;
}

/**
 * Replay the queue oldest-first. Stops at the first network failure so the
 * order in which transactions were entered is preserved.
 */
export async function flushOutbox(): Promise<FlushResult> {
  if (flushing) return { sent: 0, failed: 0, remaining: (await read()).length };
  flushing = true;

  try {
    let entries = await read();
    let sent = 0;
    let failed = 0;

    for (const entry of [...entries]) {
      try {
        await api.post('/transactions', entry.payload);
        entries = entries.filter((e) => e.id !== entry.id);
        await write(entries);
        sent += 1;
      } catch (error) {
        const apiError = error instanceof ApiError ? error : null;

        // Still offline: leave the rest of the queue untouched and in order.
        if (apiError?.isOffline) break;

        const attempts = entry.attempts + 1;
        const permanent = apiError !== null && !apiError.isRetryable;

        if (permanent || attempts >= MAX_ATTEMPTS) {
          // The server rejected it outright (a deleted account, say). Keeping
          // it forever would be dishonest, so it is dropped and reported.
          entries = entries.filter((e) => e.id !== entry.id);
          failed += 1;
        } else {
          entries = entries.map((e) =>
            e.id === entry.id
              ? { ...e, attempts, lastError: apiError?.message ?? 'Could not send' }
              : e,
          );
        }
        await write(entries);
        if (!permanent) break;
      }
    }

    return { sent, failed, remaining: entries.length };
  } finally {
    flushing = false;
  }
}

/** Replay whenever the browser tells us the network is back. */
export function startOutboxSync(onResult: (result: FlushResult) => void): () => void {
  const run = () => {
    void flushOutbox().then((result) => {
      if (result.sent > 0 || result.failed > 0) onResult(result);
    });
  };

  window.addEventListener('online', run);
  const onVisible = () => {
    if (document.visibilityState === 'visible' && navigator.onLine) run();
  };
  document.addEventListener('visibilitychange', onVisible);

  if (navigator.onLine) run();

  return () => {
    window.removeEventListener('online', run);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
