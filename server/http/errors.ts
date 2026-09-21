/**
 * Errors the user is allowed to read. Every message must be true, specific,
 * and must never claim a financial change that did not happen.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, code = 'bad_request', details?: unknown) =>
  new AppError(400, code, message, details);

export const unauthorized = (message = 'Please sign in to continue.') =>
  new AppError(401, 'unauthorized', message);

export const forbidden = (message = 'You do not have access to that.') =>
  new AppError(403, 'forbidden', message);

export const notFound = (what = 'That') => new AppError(404, 'not_found', `${what} could not be found.`);

export const conflict = (message: string, code = 'conflict') => new AppError(409, code, message);

export const tooManyRequests = (message = 'Too many attempts. Please wait a moment.') =>
  new AppError(429, 'rate_limited', message);

export const serviceUnavailable = (message: string, code = 'service_unavailable') =>
  new AppError(503, code, message);

/** The honest message when the ledger database is not reachable. */
export const databaseUnavailable = () =>
  serviceUnavailable(
    'We could not reach your ledger. Your money was not changed.',
    'database_unavailable',
  );
