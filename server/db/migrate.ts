import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDb, closeDb } from './client';
import { hasDatabase } from '../env';

if (!hasDatabase) {
  console.error('DATABASE_URL is not set. Nothing to migrate.');
  process.exit(1);
}

try {
  await migrate(getDb(), { migrationsFolder: './server/db/migrations' });
  console.info('[db] migrations applied');
} catch (error) {
  console.error('[db] migration failed', error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
