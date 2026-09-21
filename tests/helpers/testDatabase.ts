import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../../server/db/schema';
import { __setDatabaseForTesting, type Database } from '../../server/db/client';

/**
 * A real Postgres, in this process.
 *
 * PGlite is Postgres compiled to WebAssembly, so the integration suite runs
 * the actual migrations — including the deferred constraint trigger — against
 * actual Postgres semantics, with no container to start. What the tests prove
 * is therefore what production enforces.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), 'server', 'db', 'migrations');

export async function createTestDatabase(): Promise<{ db: Database; close: () => Promise<void> }> {
  const client = await PGlite.create();
  const db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Database;

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    // Drizzle writes `--> statement-breakpoint` between statements; splitting
    // on it keeps plpgsql function bodies (full of semicolons) intact.
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) await client.exec(trimmed);
    }
  }

  __setDatabaseForTesting(db);

  return {
    db,
    close: async () => {
      __setDatabaseForTesting(null);
      await client.close();
    },
  };
}
