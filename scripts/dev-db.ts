import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

/**
 * A throwaway Postgres for local development, on a TCP port.
 *
 * PGlite is real Postgres compiled to WebAssembly, so you can run the whole
 * app — migrations, constraint triggers and all — without installing anything.
 * It is NOT for production: data lives in memory unless you pass a directory,
 * and it accepts a single connection at a time.
 *
 *   npm run dev:db      # then point DATABASE_URL at postgresql://postgres@127.0.0.1:55432/postgres
 */

const PORT = Number(process.env.DEV_DB_PORT ?? 55432);
const DATA_DIR = process.env.DEV_DB_DIR ?? '.pglite';

const db = await PGlite.create({ dataDir: DATA_DIR });

const migrationsDir = path.join(process.cwd(), 'server', 'db', 'migrations');
const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

for (const file of files) {
  const sql = await readFile(path.join(migrationsDir, file), 'utf8');
  for (const statement of sql.split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    if (!trimmed) continue;
    try {
      await db.exec(trimmed);
    } catch (error) {
      // Re-running migrations against an existing data dir is expected.
      const message = error instanceof Error ? error.message : String(error);
      if (!/already exists/i.test(message)) throw error;
    }
  }
}

const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
await server.start();

console.info(`[dev-db] Postgres (PGlite) listening on 127.0.0.1:${PORT}`);
console.info(`[dev-db] DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres"`);
console.info('[dev-db] For local development only. Production uses Neon.');

const shutdown = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
