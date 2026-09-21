import { eq, sql, and } from 'drizzle-orm';
import { getDb } from '../db/client';
import { ledgerEntries, transactions, accounts, ownershipPools, people } from '../db/schema';
import { getBucketTotals } from './balances';
import { normalizeZero } from '@shared/money';

/**
 * Ledger health. Every check below runs a real query against the real data and
 * reports what it actually found. Nothing here is decorative: a green tick
 * means the database was asked and answered.
 */

export type CheckStatus = 'pass' | 'fail' | 'warn';

export interface HealthCheck {
  id: string;
  label: string;
  status: CheckStatus;
  /** Human-readable finding. Empty when everything is fine. */
  detail: string;
  /** Number of offending rows, when the check counts things. */
  count: number;
}

export interface LedgerHealthReport {
  checkedAt: string;
  healthy: boolean;
  checks: HealthCheck[];
  totals: {
    transactions: number;
    entries: number;
    netPosition: number;
  };
}

export async function getLedgerHealth(userId: string): Promise<LedgerHealthReport> {
  const db = getDb();

  const [
    unbalanced,
    orphanEntries,
    zeroEntries,
    brokenAssetRefs,
    brokenDebtRefs,
    crossUserRefs,
    danglingReversals,
    duplicateKeys,
    singleEntryTx,
    totals,
    counts,
  ] = await Promise.all([
    /* 1. Every transaction's entries must sum to zero. */
    db.execute<{ id: string; total: string }>(sql`
      select ${ledgerEntries.transactionId} as id, sum(${ledgerEntries.amount})::text as total
      from ${ledgerEntries}
      where ${ledgerEntries.userId} = ${userId}
      group by ${ledgerEntries.transactionId}
      having sum(${ledgerEntries.amount}) <> 0
    `),

    /* 2. No entry may point at a transaction that does not exist. */
    db.execute<{ count: string }>(sql`
      select count(*)::text as count
      from ${ledgerEntries} e
      left join ${transactions} t on t.id = e.transaction_id
      where e.user_id = ${userId} and t.id is null
    `),

    /* 3. A zero-amount entry is meaningless. */
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.userId, userId), eq(ledgerEntries.amount, 0))),

    /* 4. Asset entries must name both a location and an owner. */
    db.execute<{ count: string }>(sql`
      select count(*)::text as count
      from ${ledgerEntries} e
      left join ${accounts} a on a.id = e.account_id
      left join ${ownershipPools} p on p.id = e.pool_id
      where e.user_id = ${userId}
        and e.bucket = 'asset'
        and (a.id is null or p.id is null)
    `),

    /* 5. Debt entries must name a person who still exists. */
    db.execute<{ count: string }>(sql`
      select count(*)::text as count
      from ${ledgerEntries} e
      left join ${people} pe on pe.id = e.person_id
      where e.user_id = ${userId}
        and e.bucket in ('receivable', 'payable')
        and pe.id is null
    `),

    /* 6. No entry may reference another user's account, pool or person. */
    db.execute<{ count: string }>(sql`
      select count(*)::text as count
      from ${ledgerEntries} e
      left join ${accounts} a on a.id = e.account_id
      left join ${ownershipPools} p on p.id = e.pool_id
      left join ${people} pe on pe.id = e.person_id
      where e.user_id = ${userId}
        and (
          (a.id is not null and a.user_id <> ${userId}) or
          (p.id is not null and p.user_id <> ${userId}) or
          (pe.id is not null and pe.user_id <> ${userId})
        )
    `),

    /* 7. Reversal links must point both ways at real rows. */
    db.execute<{ count: string }>(sql`
      select count(*)::text as count
      from ${transactions} t
      left join ${transactions} r on r.id = t.reversed_by_transaction_id
      where t.user_id = ${userId}
        and t.reversed_by_transaction_id is not null
        and (r.id is null or r.reverses_transaction_id is distinct from t.id)
    `),

    /* 8. An idempotency key must identify exactly one transaction. */
    db.execute<{ count: string }>(sql`
      select count(*)::text as count from (
        select idempotency_key
        from ${transactions}
        where user_id = ${userId} and idempotency_key is not null
        group by idempotency_key
        having count(*) > 1
      ) dupes
    `),

    /* 9. Double entry means at least two legs. */
    db.execute<{ count: string }>(sql`
      select count(*)::text as count from (
        select transaction_id
        from ${ledgerEntries}
        where user_id = ${userId}
        group by transaction_id
        having count(*) < 2
      ) singles
    `),

    getBucketTotals(userId),

    db.execute<{ transactions: string; entries: string }>(sql`
      select
        (select count(*) from ${transactions} where user_id = ${userId})::text as transactions,
        (select count(*) from ${ledgerEntries} where user_id = ${userId})::text as entries
    `),
  ]);

  const rowsOf = (result: unknown): Record<string, unknown>[] => {
    const r = result as { rows?: Record<string, unknown>[] };
    return Array.isArray(r?.rows) ? r.rows : (result as Record<string, unknown>[]);
  };
  const countOf = (result: unknown): number => Number(rowsOf(result)[0]?.count ?? 0);

  const unbalancedRows = rowsOf(unbalanced);
  const netPosition = normalizeZero(totals.asset + totals.receivable + totals.payable);
  const bookSum = normalizeZero(
    totals.asset + totals.receivable + totals.payable + totals.expense + totals.income + totals.equity,
  );

  const checks: HealthCheck[] = [
    check(
      'balanced',
      'Transactions balanced',
      unbalancedRows.length,
      (n) => `${n} transaction${n === 1 ? '' : 's'} do not sum to zero`,
    ),
    check('books_balance', 'Double entry intact', bookSum === 0 ? 0 : 1, () =>
      `The whole ledger is off by ${bookSum} paise`,
    ),
    check('orphans', 'No orphan entries', countOf(orphanEntries), (n) => `${n} entries have no transaction`),
    check('zero_entries', 'No empty entries', zeroEntries[0]?.count ?? 0, (n) => `${n} entries are zero`),
    check(
      'asset_refs',
      'Accounts reconciled',
      countOf(brokenAssetRefs),
      (n) => `${n} asset entries are missing an account or owner`,
    ),
    check(
      'debt_refs',
      'Debt calculations valid',
      countOf(brokenDebtRefs),
      (n) => `${n} debt entries point at a missing person`,
    ),
    check(
      'ownership',
      'No cross-account leakage',
      countOf(crossUserRefs),
      (n) => `${n} entries reference data that is not yours`,
    ),
    check(
      'reversals',
      'Reversal links intact',
      countOf(danglingReversals),
      (n) => `${n} reversal links are broken`,
    ),
    check('duplicate_ids', 'No duplicate IDs', countOf(duplicateKeys), (n) => `${n} idempotency keys were reused`),
    check(
      'double_entry',
      'Every transaction has two sides',
      countOf(singleEntryTx),
      (n) => `${n} transactions have fewer than two entries`,
    ),
  ];

  return {
    checkedAt: new Date().toISOString(),
    healthy: checks.every((c) => c.status === 'pass'),
    checks,
    totals: {
      transactions: Number(rowsOf(counts)[0]?.transactions ?? 0),
      entries: Number(rowsOf(counts)[0]?.entries ?? 0),
      netPosition,
    },
  };
}

function check(
  id: string,
  label: string,
  count: number,
  describe: (n: number) => string,
): HealthCheck {
  return {
    id,
    label,
    status: count === 0 ? 'pass' : 'fail',
    detail: count === 0 ? '' : describe(count),
    count,
  };
}
