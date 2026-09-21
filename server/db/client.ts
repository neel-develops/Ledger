import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { env, hasDatabase, isProduction } from '../env';

/**
 * Neon speaks the standard Postgres wire protocol, so we use node-postgres
 * rather than a Neon-specific driver. Two reasons, both about correctness:
 *
 *  - Real interactive transactions. A money write is BEGIN, several
 *    statements, COMMIT; anything less cannot guarantee atomicity.
 *  - One code path. The same driver runs against Neon in production and a
 *    plain Postgres locally, so the tests exercise what actually ships.
 *
 * Always point DATABASE_URL at Neon's POOLED endpoint (`-pooler`) in
 * production — serverless functions open connections faster than a single
 * Postgres instance can accept them.
 */

/**
 * `bigint` is how money is stored. node-postgres hands bigints back as strings
 * to avoid silent precision loss; we convert explicitly and refuse anything
 * outside the safe integer range rather than rounding it.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`A stored amount (${value}) is outside the safe integer range`);
  }
  return n;
});

export type Database = NodePgDatabase<typeof schema>;

let pool: pg.Pool | null = null;
let database: Database | null = null;

export class DatabaseUnavailableError extends Error {
  readonly code = 'database_unavailable';
  constructor() {
    super('The ledger database is not configured.');
    this.name = 'DatabaseUnavailableError';
  }
}

export function getDb(): Database {
  if (database) return database;
  if (!hasDatabase) throw new DatabaseUnavailableError();

  {
    pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      // Serverless invocations are short-lived and numerous; a small pool per
      // instance keeps us well inside Neon's connection limits.
      max: env.DB_POOL_MAX ?? (isProduction ? 3 : 8),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ...(requiresTls(env.DATABASE_URL) ? { ssl: { rejectUnauthorized: true } } : {}),
    });

    // An idle client erroring out must never take the process down with it.
    pool.on('error', (error) => {
      console.error('[db] idle client error', error);
    });

    database = drizzle(pool, { schema, casing: 'snake_case' });
  }

  return database;
}

function requiresTls(url: string | undefined): boolean {
  if (!url) return false;
  if (/sslmode=disable/.test(url)) return false;
  return /sslmode=require|\.neon\.tech|\.aws\.|amazonaws\.com/.test(url);
}

/**
 * Test-only seam. The integration suite runs against an in-process Postgres
 * (PGlite) so the real services, the real SQL and the real constraint triggers
 * are all exercised without needing a server. Production never calls this.
 */
export function __setDatabaseForTesting(instance: Database | null): void {
  if (isProduction) throw new Error('The database cannot be replaced in production');
  database = instance;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
  database = null;
}

export { schema };
