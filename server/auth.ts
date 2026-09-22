import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getDb } from './db/client';
import { users, sessions, accountsAuth, verifications } from './db/schema';
import { env, isProduction, hasDatabase, hasAuthSecret } from './env';
import { bootstrapUser } from './services/bootstrap';

/**
 * Better Auth owns identity. The rest of the app never accepts a user id from
 * the client — it is always derived from the session cookie here.
 */

function buildAuth() {
  return betterAuth({
    appName: 'Ledger',
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL ?? env.APP_URL,
    basePath: '/api/auth',
    trustedOrigins: [env.APP_URL],

    database: drizzleAdapter(getDb(), {
      provider: 'pg',
      schema: {
        user: users,
        session: sessions,
        account: accountsAuth,
        verification: verifications,
      },
    }),

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: true,
      requireEmailVerification: false,
      // Password reset is wired to the transport the deployment configures.
      // Until one is set, the token is surfaced to the server log only — never
      // to the client, and never to an unauthenticated response body.
      sendResetPassword: async ({ user, url }) => {
        if (isProduction) {
          console.info('[auth] password reset requested', { userId: user.id });
        } else {
          console.info(`[auth] password reset for ${user.email}: ${url}`);
        }
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },

    advanced: {
      useSecureCookies: isProduction,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
      },
    },

    databaseHooks: {
      user: {
        create: {
          // A brand new user gets their accounts, pools and categories —
          // structure only. Not one rupee of balance is created.
          after: async (user) => {
            try {
              await bootstrapUser(user.id);
            } catch (error) {
              console.error('[auth] failed to bootstrap user workspace', error);
            }
          },
        },
      },
    },
  });
}

type Auth = ReturnType<typeof buildAuth>;

let instance: Auth | null = null;

export function getAuth(): Auth {
  if (!hasDatabase) {
    throw new Error('Authentication requires DATABASE_URL to be configured.');
  }
  if (!hasAuthSecret) {
    // Without a secret, session cookies would be signed with a default — which
    // is to say, forgeable. Refuse rather than appear to work.
    throw new Error('Authentication requires BETTER_AUTH_SECRET (32+ characters).');
  }
  if (!instance) instance = buildAuth();
  return instance;
}

export type AuthSession = Awaited<ReturnType<Auth['api']['getSession']>>;
