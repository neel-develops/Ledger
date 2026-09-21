import { and, eq, desc } from 'drizzle-orm';
import type { z } from 'zod';
import { getDb } from '../db/client';
import { accounts, reconciliations, auditLogs } from '../db/schema';
import { getPositionBalance } from './balances';
import { createTransaction } from './transactions';
import type { reconciliationSchema } from '../domain/inputs';
import { notFound } from '../http/errors';
import { normalizeZero } from '@shared/money';

/**
 * A cash count. Comparing what the ledger expects against what is actually in
 * your pocket.
 *
 * Reconciliation NEVER edits history. If the numbers disagree, the only way to
 * make them agree is a new, dated adjustment transaction that says so out loud.
 */

export interface ReconciliationResult {
  accountId: string;
  accountName: string;
  expectedAmount: number;
  actualAmount: number;
  /** actual - expected. Negative means money is missing. */
  differenceAmount: number;
  adjustmentTransactionId: string | null;
  recordedAt: string | null;
}

export async function reconcile(
  userId: string,
  input: z.infer<typeof reconciliationSchema>,
): Promise<ReconciliationResult> {
  const db = getDb();

  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, userId)));
  if (!account) throw notFound('That account');

  const expectedAmount = await getPositionBalance(userId, input.accountId, input.poolId);
  const differenceAmount = normalizeZero(input.actualAmount - expectedAmount);

  // A dry run: tell the truth about the gap, change nothing.
  if (!input.createAdjustment || differenceAmount === 0) {
    return {
      accountId: account.id,
      accountName: account.name,
      expectedAmount,
      actualAmount: input.actualAmount,
      differenceAmount,
      adjustmentTransactionId: null,
      recordedAt: null,
    };
  }

  const { transaction } = await createTransaction(userId, {
    kind: 'adjustment',
    amount: Math.abs(differenceAmount),
    direction: differenceAmount > 0 ? 'increase' : 'decrease',
    accountId: input.accountId,
    poolId: input.poolId ?? null,
    occurredAt: new Date(),
    note: input.note ?? `Cash check on ${account.name}`,
    idempotencyKey: null,
  });

  const [row] = await db
    .insert(reconciliations)
    .values({
      userId,
      accountId: input.accountId,
      expectedAmount,
      actualAmount: input.actualAmount,
      differenceAmount,
      adjustmentTransactionId: transaction.id,
      note: input.note ?? null,
    })
    .returning();

  await db.insert(auditLogs).values({
    userId,
    action: 'reconciliation.adjust',
    entityType: 'account',
    entityId: input.accountId,
    metadata: { expectedAmount, actualAmount: input.actualAmount, differenceAmount },
  });

  return {
    accountId: account.id,
    accountName: account.name,
    expectedAmount,
    actualAmount: input.actualAmount,
    differenceAmount,
    adjustmentTransactionId: transaction.id,
    recordedAt: row?.createdAt.toISOString() ?? null,
  };
}

export async function listReconciliations(userId: string, limit = 20) {
  const db = getDb();
  return db
    .select({
      id: reconciliations.id,
      accountId: reconciliations.accountId,
      accountName: accounts.name,
      expectedAmount: reconciliations.expectedAmount,
      actualAmount: reconciliations.actualAmount,
      differenceAmount: reconciliations.differenceAmount,
      adjustmentTransactionId: reconciliations.adjustmentTransactionId,
      note: reconciliations.note,
      createdAt: reconciliations.createdAt,
    })
    .from(reconciliations)
    .innerJoin(accounts, eq(accounts.id, reconciliations.accountId))
    .where(eq(reconciliations.userId, userId))
    .orderBy(desc(reconciliations.createdAt))
    .limit(limit);
}
