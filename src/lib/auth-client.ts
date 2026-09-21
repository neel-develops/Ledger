import { createAuthClient } from 'better-auth/react';

/**
 * The browser half of Better Auth. It only ever moves cookies around — no
 * token is stored in JavaScript, so nothing readable by a script can be
 * replayed as your identity.
 */
export const authClient = createAuthClient({
  basePath: '/api/auth',
});

export const { signIn, signUp, signOut, useSession } = authClient;

/**
 * Turn whatever the client hands back into a sentence worth reading.
 *
 * The error's shape is not something to rely on: depending on the version the
 * code can sit on the error, nested under `error`, or be absent entirely with
 * only an HTTP status to go on. Being told "we could not sign you in" when the
 * server said precisely why is a bad way to find out your password is wrong,
 * so every one of those places is checked before falling back.
 */
export function authErrorMessage(error: unknown, fallback: string): string {
  const code = extract(error, 'code');
  const status = extractStatus(error);

  switch (code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'That email and password do not match. If you have not made an account yet, use Create account.';
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return 'There is already an account with that email. Try signing in instead.';
    case 'PASSWORD_TOO_SHORT':
      return 'Use at least 10 characters for your password.';
    case 'PASSWORD_TOO_LONG':
      return 'That password is too long.';
    case 'INVALID_EMAIL':
      return 'That does not look like an email address.';
    case 'EMAIL_NOT_VERIFIED':
      return 'Please verify your email address first.';
  }

  // No usable code. The status still tells us plenty.
  if (status === 401 || status === 403) {
    return 'That email and password do not match. If you have not made an account yet, use Create account.';
  }
  if (status === 429) return 'Too many attempts. Please wait a few minutes and try again.';
  if (status === 503) return 'The ledger is not reachable right now. Nothing was changed.';
  if (status && status >= 500) return 'Something went wrong on our side. Please try again.';
  if (status === 0 || status === undefined) {
    const message = extract(error, 'message');
    // A server sentence is better than our guess, when there is one.
    if (message && message.length < 120) return capitalise(message);
  }

  return fallback;
}

/** Look for a string field on the error, or one level down under `error`. */
function extract(error: unknown, key: 'code' | 'message'): string | undefined {
  if (!error || typeof error !== 'object') return undefined;

  const direct = (error as Record<string, unknown>)[key];
  if (typeof direct === 'string' && direct) return direct;

  const nested = (error as { error?: unknown }).error;
  if (nested && typeof nested === 'object') {
    const value = (nested as Record<string, unknown>)[key];
    if (typeof value === 'string' && value) return value;
  }

  return undefined;
}

function extractStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
