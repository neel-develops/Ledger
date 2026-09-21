import { describe, it, expect } from 'vitest';
import { authErrorMessage } from './auth-client';

/**
 * Regression cover for a bad moment: signing in with an email that had no
 * account showed "We could not sign you in." The server had said exactly
 * why — INVALID_EMAIL_OR_PASSWORD — but the code was not where the UI looked
 * for it, so the one useful sentence was swallowed and replaced with a shrug.
 */

const FALLBACK = 'We could not sign you in.';

describe('auth error messages', () => {
  it('reads a code sitting directly on the error', () => {
    expect(authErrorMessage({ code: 'INVALID_EMAIL_OR_PASSWORD' }, FALLBACK)).toMatch(/do not match/);
  });

  it('reads a code nested one level down', () => {
    expect(
      authErrorMessage({ status: 401, error: { code: 'INVALID_EMAIL_OR_PASSWORD' } }, FALLBACK),
    ).toMatch(/do not match/);
  });

  it('falls back to the status when there is no code at all', () => {
    expect(authErrorMessage({ status: 401 }, FALLBACK)).toMatch(/do not match/);
    expect(authErrorMessage({ status: 429 }, FALLBACK)).toMatch(/Too many attempts/);
    expect(authErrorMessage({ status: 503 }, FALLBACK)).toMatch(/not reachable/);
    expect(authErrorMessage({ status: 500 }, FALLBACK)).toMatch(/our side/);
  });

  it('points a failed sign-in at Create account', () => {
    // The actual cause of the report: no account existed for that email.
    expect(authErrorMessage({ status: 401 }, FALLBACK)).toMatch(/Create account/);
  });

  it('explains a duplicate signup and a short password', () => {
    expect(authErrorMessage({ code: 'USER_ALREADY_EXISTS' }, FALLBACK)).toMatch(/already an account/);
    expect(authErrorMessage({ code: 'PASSWORD_TOO_SHORT' }, FALLBACK)).toMatch(/10 characters/);
  });

  it('uses the server sentence when that is all there is', () => {
    expect(authErrorMessage({ message: 'invalid email or password' }, FALLBACK)).toBe(
      'Invalid email or password',
    );
  });

  it('never returns an empty or useless string', () => {
    for (const error of [null, undefined, {}, 'nonsense', 42, { status: 418 }]) {
      const message = authErrorMessage(error, FALLBACK);
      expect(message.length).toBeGreaterThan(10);
    }
  });
});
