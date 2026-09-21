import 'dotenv/config';
import { z } from 'zod';

/**
 * Secrets only ever live here, read from the process environment. Nothing in
 * this file may be imported from `src/` — the client bundle must never be able
 * to reach a credential.
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

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';

/** True when a real database is wired up. The app degrades honestly when not. */
export const hasDatabase = Boolean(env.DATABASE_URL);

export const hasStorage = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);

if (isProduction) {
  const missing: string[] = [];
  if (!env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!env.BETTER_AUTH_SECRET) missing.push('BETTER_AUTH_SECRET');
  if (missing.length) {
    throw new Error(`Refusing to start in production without: ${missing.join(', ')}`);
  }
}
