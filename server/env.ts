import 'dotenv/config';
import { z } from 'zod';

/**
 * Secrets only ever live here, read from the process environment. Nothing in
 * this file may be imported from `src/` — the client bundle must never be able
 * to reach a credential.
 *
 * Nothing here throws at import time. An earlier version did, and on a
 * serverless host that means the function dies before it can say anything:
 * every route, including the health check, returns an opaque
 * FUNCTION_INVOCATION_FAILED and you are left guessing. A misconfigured
 * deployment should be able to tell you exactly what it is missing.
 */

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  /** Neon Postgres. The single source of truth for all financial data. */
  DATABASE_URL: z.string().url().optional(),

  /**
   * Connection pool size. Serverless instances should stay small so they do
   * not exhaust the database's connection limit. Set to 1 against a
   * single-connection development database.
   */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).optional(),

  /** Better Auth. Must be a strong random value in production. */
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  BETTER_AUTH_URL: z.string().url().optional(),

  /** Public origin of the app, used for cookies, CORS and auth callbacks. */
  APP_URL: z.string().url().default('http://localhost:5173'),

  /** Supabase Storage — attachments and encrypted backups only. Never data. */
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default('ledger-files'),
});

const parsed = schema.safeParse(process.env);

/**
 * Variables that are present but malformed — a DATABASE_URL that is not a URL,
 * a secret that is too short. Kept separate from "missing" because the fix is
 * different: you set it, it is just wrong.
 */
export const invalidEnv: string[] = parsed.success
  ? []
  : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);

// Fall back to raw values so the app can still boot far enough to explain itself.
export const env = parsed.success
  ? parsed.data
  : ({
      ...process.env,
      NODE_ENV: (process.env.NODE_ENV as 'development' | 'test' | 'production') ?? 'development',
      PORT: Number(process.env.PORT ?? 3001),
      APP_URL: process.env.APP_URL ?? 'http://localhost:5173',
      SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET ?? 'ledger-files',
    } as z.infer<typeof schema>);

export const isProduction = env.NODE_ENV === 'production';

/** True when a real database is wired up. The app degrades honestly when not. */
export const hasDatabase = Boolean(env.DATABASE_URL);

export const hasAuthSecret = Boolean(env.BETTER_AUTH_SECRET && env.BETTER_AUTH_SECRET.length >= 32);

export const hasStorage = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);

/** What a production deployment cannot run without. */
export const missingEnv: string[] = [
  ...(hasDatabase ? [] : ['DATABASE_URL']),
  ...(hasAuthSecret ? [] : ['BETTER_AUTH_SECRET']),
];

/** In production, refuse to serve money endpoints while misconfigured. */
export const isConfigured = missingEnv.length === 0 && invalidEnv.length === 0;

if (!isConfigured) {
  // Goes to the platform log, where whoever deployed it will look first.
  console.error(
    '[env] the deployment is not fully configured.' +
      (missingEnv.length ? ` Missing: ${missingEnv.join(', ')}.` : '') +
      (invalidEnv.length ? ` Invalid: ${invalidEnv.join('; ')}.` : ''),
  );
}

if (isProduction && env.APP_URL === 'http://localhost:5173') {
  console.warn(
    '[env] APP_URL is still localhost in production. Writes will be rejected because the request ' +
      'Origin will not match it. Set APP_URL to your deployed origin.',
  );
}
