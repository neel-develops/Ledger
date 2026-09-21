import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { people } from '../db/schema';
import { getPeopleBalances } from './balances';
import { listTransactions } from './transactions';
import { notFound } from '../http/errors';
import type { PersonView, TransactionView } from '@shared/domain';

export interface PersonLedger {
  person: PersonView & { relation: string | null; note: string | null };
  transactions: TransactionView[];
  nextCursor: string | null;
}

/**
 * One person's complete history, plus their netted position.
 *
 * Netting is a presentation concern only — every transaction that ever ran
 * through this person is still here, in both directions.
 */
export async function getPersonLedger(
  userId: string,
  personId: string,
  options: { limit?: number; cursor?: string } = {},
): Promise<PersonLedger> {
  const db = getDb();

  const [row] = await db
    .select()
    .from(people)
    .where(and(eq(people.id, personId), eq(people.userId, userId)));
  if (!row) throw notFound('That person');

  const [balances, history] = await Promise.all([
    getPeopleBalances(userId, { includeArchived: true }),
    listTransactions(userId, { limit: options.limit ?? 50, cursor: options.cursor, personId }),
  ]);

  const balance = balances.find((b) => b.id === personId);

  return {
    person: {
      id: row.id,
      name: row.name,
      relation: row.relation,
      note: row.note,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      receivable: balance?.receivable ?? 0,
      payable: balance?.payable ?? 0,
      netBalance: balance?.netBalance ?? 0,
    },
    transactions: history.items,
    nextCursor: history.nextCursor,
  };
}
