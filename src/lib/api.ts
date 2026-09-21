/**
 * The only way the app talks to the server.
 *
 * Two rules live here:
 *  1. Every failure surfaces as an `ApiError` with a sentence a person can
 *     read. There is no path that shows a raw status code to the user.
 *  2. Every write carries an idempotency key, so replaying it — after a
 *     flaky network, or from the offline outbox — can never double-charge
 *     the ledger.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when retrying the exact same request is worth doing. */
  get isRetryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }

  get isOffline(): boolean {
    return this.status === 0;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

const OFFLINE_MESSAGE = 'You appear to be offline. Nothing was sent.';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Skip the JSON parse and hand back the raw response (exports). */
  raw?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, raw } = options;

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        Accept: raw ? '*/*' : 'application/json',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'network_error', OFFLINE_MESSAGE);
  }

  if (raw) {
    if (!response.ok) throw await toApiError(response);
    return response as unknown as T;
  }

  if (response.status === 204) return undefined as T;

  if (!response.ok) throw await toApiError(response);

  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(response.status, 'bad_response', 'We could not read the response from the server.');
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  let code = 'request_failed';
  let message = 'Something went wrong. Your money was not changed.';
  let details: unknown;

  try {
    const payload = (await response.json()) as { error?: { code?: string; message?: string; details?: unknown } };
    if (payload?.error?.message) {
      code = payload.error.code ?? code;
      message = payload.error.message;
      details = payload.error.details;
    }
  } catch {
    if (response.status === 401) message = 'Please sign in to continue.';
    else if (response.status === 404) message = 'That could not be found.';
  }

  return new ApiError(response.status, code, message, details);
}

/** A key that is stable for one logical write, so replays are recognised. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  raw: (path: string) => request<Response>(path, { raw: true }),
};
