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
      isPrivate: accounts.isPrivate,
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
    isPrivate: r.isPrivate,
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

/**
 * The dashboard is the ONLY place the private flag changes a number.
 *
 * Marking an account private does not touch the ledger: the entries are
 * untouched, the balance is real, and backups, reconciliation and the health
 * checks all continue to work from the complete picture. What it changes is
 * what this screen — and therefore the home-screen widget — adds up, so that
 * "Total money" can be shown to someone standing next to you.
 *
 * Privacy is a property of an ACCOUNT, deliberately — one axis, so every
 * figure on this screen agrees with every other. A private POOL would leave
 * the numbers contradicting each other, because the Cash and Digital tiles
 * are built from accounts: money in a hidden pool would disappear from the
 * total while still showing under Cash.
 *
 * So the same exclusion is applied to the total, the tiles AND the per-pool
 * balances. What is held back is summed as `privateMoney`, visible only on a
 * screen you had to navigate to.
 */
export async function getDashboard(userId: string): Promise<Omit<DashboardView, 'recentTransactions'>> {
  const db = getDb();

  const [accountViews, totals, visibleRows, privateRow] = await Promise.all([
    getAccountBalances(userId),
    getBucketTotals(userId),

    // Every visible asset entry, grouped by where it sits and whose it is.
    db
      .select({
        kind: accounts.kind,
        poolId: ownershipPools.id,
        poolName: ownershipPools.name,
        poolKind: ownershipPools.kind,
        poolIsDefault: ownershipPools.isDefault,
        poolSort: ownershipPools.sortOrder,
        total: sumAmount,
      })
      .from(ledgerEntries)
      .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
      .innerJoin(ownershipPools, eq(ownershipPools.id, ledgerEntries.poolId))
      .where(
        and(
          eq(ledgerEntries.userId, userId),
          eq(ledgerEntries.bucket, 'asset'),
          eq(accounts.isPrivate, false),
        ),
      )
      .groupBy(
        accounts.kind,
        ownershipPools.id,
        ownershipPools.name,
        ownershipPools.kind,
        ownershipPools.isDefault,
        ownershipPools.sortOrder,
      ),

    db
      .select({ total: sumAmount })
      .from(ledgerEntries)
      .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
      .where(
        and(
          eq(ledgerEntries.userId, userId),
          eq(ledgerEntries.bucket, 'asset'),
          eq(accounts.isPrivate, true),
        ),
      ),
  ]);

  const privateMoney = toNumber(privateRow[0]?.total ?? 0);
  const ownedMoney = normalizeZero(totals.asset - privateMoney);
  const owedToMe = totals.receivable;
  const iOwe = negatePaise(totals.payable);

  const byLocation = { cash: 0, digital: 0, savings: 0, other: 0 };
  const pools = new Map<string, PoolView & { sortOrder: number }>();

  for (const row of visibleRows) {
    const amount = toNumber(row.total);

    if (CASH_ACCOUNT_KINDS.includes(row.kind)) byLocation.cash += amount;
    else if (DIGITAL_ACCOUNT_KINDS.includes(row.kind)) byLocation.digital += amount;
    else if (row.kind === 'savings') byLocation.savings += amount;
    else byLocation.other += amount;

    const pool = pools.get(row.poolId);
    if (pool) pool.balance += amount;
    else
      pools.set(row.poolId, {
        id: row.poolId,
        name: row.poolName,
        kind: row.poolKind,
        balance: amount,
        isDefault: row.poolIsDefault,
        sortOrder: row.poolSort,
      });
  }

  // A pool with nothing visible in it still belongs in the list, at zero.
  for (const pool of await getPoolBalances(userId)) {
    if (!pools.has(pool.id)) pools.set(pool.id, { ...pool, balance: 0, sortOrder: 0 });
  }

  const byPool = [...pools.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map(({ sortOrder: _sortOrder, ...pool }) => ({ ...pool, balance: normalizeZero(pool.balance) }));

  return {
    ownedMoney,
    privateMoney,
    hasPrivate: accountViews.some((a) => a.isPrivate),
    owedToMe,
    iOwe,
    netPosition: normalizeZero(ownedMoney + owedToMe - iOwe),
    byLocation: {
      cash: normalizeZero(byLocation.cash),
      digital: normalizeZero(byLocation.digital),
      savings: normalizeZero(byLocation.savings),
      other: normalizeZero(byLocation.other),
    },
    byPool,
    accounts: accountViews,
    hasAnyData: Object.values(totals).some((v) => v !== 0),
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
