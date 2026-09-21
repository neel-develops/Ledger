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

/** Better Auth surfaces errors as codes; these are the sentences we show. */
export function authErrorMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'That email and password do not match.';
    case 'USER_ALREADY_EXISTS':
      return 'There is already an account with that email.';
    case 'PASSWORD_TOO_SHORT':
      return 'Use at least 10 characters for your password.';
    case 'INVALID_EMAIL':
      return 'That does not look like an email address.';
    default:
      return fallback;
  }
}
