import { and, eq, sql, asc, isNull } from 'drizzle-orm';
import { getDb } from '../db/client';
import { accounts, ownershipPools, people, ledgerEntries } from '../db/schema';
import { negatePaise, normalizeZero } from '@shared/money';
import {
  CASH_ACCOUNT_KINDS,
  DIGITAL_ACCOUNT_KINDS,
  type AccountView,
  type PoolView,
  type PersonView,
  type DashboardView,
  type EntryBucket,
} from '@shared/domain';

/**
 * Balances are NEVER stored. Every number below is a live aggregate over
 * `ledger_entries`, so a balance cannot drift away from its history.
 */

const sumAmount = sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)::bigint`;

function toNumber(value: unknown): number {
  // `bigint` comes back as a string from the driver; money must survive the trip.
  const n = typeof value === 'string' ? Number(value) : Number(value ?? 0);
  if (!Number.isSafeInteger(n)) throw new Error('A balance exceeded safe integer range');
  return normalizeZero(n);
}

export async function getAccountBalances(userId: string): Promise<AccountView[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      kind: accounts.kind,
      isDefault: accounts.isDefault,
      archivedAt: accounts.archivedAt,
      sortOrder: accounts.sortOrder,
      balance: sumAmount,
    })
    .from(accounts)
    .leftJoin(
      ledgerEntries,
      and(eq(ledgerEntries.accountId, accounts.id), eq(ledgerEntries.bucket, 'asset')),
    )
    .where(eq(accounts.userId, userId))
    .groupBy(accounts.id)
    .orderBy(asc(accounts.sortOrder), asc(accounts.name));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    balance: toNumber(r.balance),
    archivedAt: r.archivedAt?.toISOString() ?? null,
    isDefault: r.isDefault,
  }));
}

export async function getPoolBalances(userId: string): Promise<PoolView[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: ownershipPools.id,
      name: ownershipPools.name,
      kind: ownershipPools.kind,
      isDefault: ownershipPools.isDefault,
      sortOrder: ownershipPools.sortOrder,
      balance: sumAmount,
    })
    .from(ownershipPools)
    .leftJoin(
      ledgerEntries,
      and(eq(ledgerEntries.poolId, ownershipPools.id), eq(ledgerEntries.bucket, 'asset')),
    )
    .where(eq(ownershipPools.userId, userId))
    .groupBy(ownershipPools.id)
    .orderBy(asc(ownershipPools.sortOrder), asc(ownershipPools.name));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    balance: toNumber(r.balance),
    isDefault: r.isDefault,
  }));
}

/**
 * A person's position, netted across both directions.
 *
 *   net = receivable + payable   (payable is stored negative)
 *
 * Both histories survive; only the headline is netted.
 */
export async function getPeopleBalances(
  userId: string,
  options: { includeArchived?: boolean } = {},
): Promise<PersonView[]> {
  const db = getDb();

  const conditions = [eq(people.userId, userId)];
  if (!options.includeArchived) conditions.push(isNull(people.archivedAt));

  const rows = await db
    .select({
      id: people.id,
      name: people.name,
      archivedAt: people.archivedAt,
      receivable: sql<number>`coalesce(sum(${ledgerEntries.amount}) filter (where ${ledgerEntries.bucket} = 'receivable'), 0)::bigint`,
      payable: sql<number>`coalesce(sum(${ledgerEntries.amount}) filter (where ${ledgerEntries.bucket} = 'payable'), 0)::bigint`,
    })
    .from(people)
    .leftJoin(ledgerEntries, eq(ledgerEntries.personId, people.id))
    .where(and(...conditions))
    .groupBy(people.id)
    .orderBy(asc(people.name));

  return rows.map((r) => {
    const receivable = toNumber(r.receivable);
    const payable = toNumber(r.payable);
    return {
      id: r.id,
      name: r.name,
      receivable,
      payable: negatePaise(payable),
      netBalance: normalizeZero(receivable + payable),
      archivedAt: r.archivedAt?.toISOString() ?? null,
    };
  });
}

export async function getBucketTotals(userId: string): Promise<Record<EntryBucket, number>> {
  const db = getDb();
  const rows = await db
    .select({ bucket: ledgerEntries.bucket, total: sumAmount })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.userId, userId))
    .groupBy(ledgerEntries.bucket);

  const totals: Record<EntryBucket, number> = {
    asset: 0,
    receivable: 0,
    payable: 0,
    expense: 0,
    income: 0,
    equity: 0,
  };
  for (const row of rows) totals[row.bucket] = toNumber(row.total);
  return totals;
}

export async function getDashboard(userId: string): Promise<Omit<DashboardView, 'recentTransactions'>> {
  const [accountViews, poolViews, totals] = await Promise.all([
    getAccountBalances(userId),
    getPoolBalances(userId),
    getBucketTotals(userId),
  ]);

  const ownedMoney = totals.asset;
  const owedToMe = totals.receivable;
  const iOwe = negatePaise(totals.payable);

  const byLocation = { cash: 0, digital: 0, savings: 0, other: 0 };
  for (const account of accountViews) {
    if (CASH_ACCOUNT_KINDS.includes(account.kind)) byLocation.cash += account.balance;
    else if (DIGITAL_ACCOUNT_KINDS.includes(account.kind)) byLocation.digital += account.balance;
    else if (account.kind === 'savings') byLocation.savings += account.balance;
    else byLocation.other += account.balance;
  }

  const hasAnyData = Object.values(totals).some((v) => v !== 0);

  return {
    ownedMoney,
    owedToMe,
    iOwe,
    netPosition: normalizeZero(ownedMoney + owedToMe - iOwe),
    byLocation: {
      cash: normalizeZero(byLocation.cash),
      digital: normalizeZero(byLocation.digital),
      savings: normalizeZero(byLocation.savings),
      other: normalizeZero(byLocation.other),
    },
    byPool: poolViews,
    accounts: accountViews,
    hasAnyData,
  };
}

/** Balance of one exact (account, pool) position — what a cash count compares against. */
export async function getPositionBalance(
  userId: string,
  accountId: string,
  poolId?: string | null,
): Promise<number> {
  const db = getDb();
  const conditions = [
    eq(ledgerEntries.userId, userId),
    eq(ledgerEntries.bucket, 'asset'),
    eq(ledgerEntries.accountId, accountId),
  ];
  if (poolId) conditions.push(eq(ledgerEntries.poolId, poolId));

  const [row] = await db
    .select({ total: sumAmount })
    .from(ledgerEntries)
    .where(and(...conditions));

  return toNumber(row?.total ?? 0);
}
