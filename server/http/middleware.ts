import type { Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { ZodError, type ZodSchema } from 'zod';
import { getAuth } from '../auth';
import { AppError, databaseUnavailable, unauthorized } from './errors';
import { DatabaseUnavailableError } from '../db/client';
import { LedgerError } from '../domain/ledger';
import { isProduction, hasDatabase } from '../env';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `requireAuth`. Always derived from the session cookie. */
      userId?: string;
    }
  }
}

/** Wrap an async handler so a rejected promise reaches the error handler. */
export const handler =
  <T>(fn: (req: Request, res: Response) => Promise<T>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

/**
 * Identity comes from the session cookie and nowhere else. A user id in a
 * body, query string or header is ignored completely.
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!hasDatabase) return next(databaseUnavailable());

  getAuth()
    .api.getSession({ headers: toHeaders(req) })
    .then((session) => {
      if (!session?.user?.id) return next(unauthorized());
      req.userId = session.user.id;
      next();
    })
    .catch(next);
};

export function toHeaders(req: Request): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (value) headers.set(key, value);
  }
  return headers;
}

export function userIdOf(req: Request): string {
  if (!req.userId) throw unauthorized();
  return req.userId;
}

/** Validate `body`/`query` against a schema and replace it with the parsed value. */
export function validate<S extends ZodSchema>(schema: S, source: 'body' | 'query' = 'body'): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(source === 'body' ? req.body : req.query);
    if (!result.success) return next(result.error);
    if (source === 'body') req.body = result.data;
    else Object.defineProperty(req, 'validatedQuery', { value: result.data, configurable: true });
    next();
  };
}

export function validatedQuery<T>(req: Request): T {
  return (req as Request & { validatedQuery: T }).validatedQuery;
}

/* ------------------------------ rate limits ----------------------------- */

const limiter = (windowMs: number, max: number, message: string) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'rate_limited', message } });
    },
  });

/** Sign-in and sign-up: strict, because these are the credential endpoints. */
export const authLimiter = limiter(
  15 * 60 * 1000,
  isProduction ? 20 : 1000,
  'Too many attempts. Please wait a few minutes and try again.',
);

/** Writes: generous enough for offline replay, tight enough to matter. */
export const writeLimiter = limiter(
  60 * 1000,
  isProduction ? 120 : 10_000,
  'You are saving faster than we can keep up. Please wait a moment.',
);

export const importLimiter = limiter(
  60 * 60 * 1000,
  isProduction ? 10 : 1000,
  'Too many imports. Please wait before trying again.',
);

/* ---------------------------- error handling ---------------------------- */

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/**
 * Every error the client sees is a sentence a person can act on, and it never
 * claims a financial change happened when it did not.
 */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) return next(error);

  if (error instanceof ZodError) {
    const first = error.issues[0];
    res.status(400).json({
      error: {
        code: 'validation_failed',
        message: first?.message ?? 'Some of those details are not valid.',
        details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    } satisfies ErrorBody);
    return;
  }

  if (error instanceof AppError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    } satisfies ErrorBody);
    return;
  }

  if (error instanceof LedgerError) {
    res.status(400).json({
      error: { code: error.code, message: error.message },
    } satisfies ErrorBody);
    return;
  }

  if (error instanceof DatabaseUnavailableError) {
    const appError = databaseUnavailable();
    res.status(appError.status).json({
      error: { code: appError.code, message: appError.message },
    } satisfies ErrorBody);
    return;
  }

  console.error('[api] unhandled error', error);
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Something went wrong on our side. Your money was not changed.',
    },
  } satisfies ErrorBody);
}
