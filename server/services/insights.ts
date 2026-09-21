import { and, eq, gte, lt, sql, desc } from 'drizzle-orm';
import { getDb } from '../db/client';
import { ledgerEntries, categories, accounts } from '../db/schema';
import { normalizeZero } from '@shared/money';
import { CASH_ACCOUNT_KINDS, DIGITAL_ACCOUNT_KINDS } from '@shared/domain';

/**
 * Reporting. Every series below is derived from ledger entries in the chosen
 * window — if the window is empty, the series is empty and the UI says so.
 */

export type InsightRange = 'week' | 'month' | 'year';

export interface InsightsReport {
  range: InsightRange;
  from: string;
  to: string;
  totalSpent: number;
  totalReceived: number;
  byCategory: { id: string | null; name: string; icon: string | null; amount: number }[];
  dailyFlow: { date: string; spent: number; received: number }[];
  cashVsDigital: { cash: number; digital: number };
  savingsBalance: number;
  hasData: boolean;
}

function windowFor(range: InsightRange, now = new Date()): { from: Date; to: Date } {
  const to = new Date(now);
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);

  if (range === 'week') from.setDate(from.getDate() - 6);
  else if (range === 'month') from.setDate(from.getDate() - 29);
  else from.setFullYear(from.getFullYear() - 1);

  return { from, to };
}

export async function getInsights(userId: string, range: InsightRange): Promise<InsightsReport> {
  const db = getDb();
  const { from, to } = windowFor(range);

  const inWindow = and(
    eq(ledgerEntries.userId, userId),
    gte(ledgerEntries.occurredAt, from),
    lt(ledgerEntries.occurredAt, new Date(to.getTime() + 1)),
  );

  const [categoryRows, dailyRows, locationRows] = await Promise.all([
    db
      .select({
        id: categories.id,
        name: categories.name,
        icon: categories.icon,
        amount: sql<string>`sum(${ledgerEntries.amount})::text`,
      })
      .from(ledgerEntries)
      .leftJoin(categories, eq(categories.id, ledgerEntries.categoryId))
      .where(and(inWindow, eq(ledgerEntries.bucket, 'expense')))
      .groupBy(categories.id, categories.name, categories.icon)
      .orderBy(desc(sql`sum(${ledgerEntries.amount})`)),

    db
      .select({
        date: sql<string>`to_char(${ledgerEntries.occurredAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        spent: sql<string>`coalesce(sum(${ledgerEntries.amount}) filter (where ${ledgerEntries.bucket} = 'expense'), 0)::text`,
        received: sql<string>`coalesce(-sum(${ledgerEntries.amount}) filter (where ${ledgerEntries.bucket} = 'income'), 0)::text`,
      })
      .from(ledgerEntries)
      .where(and(inWindow, sql`${ledgerEntries.bucket} in ('expense', 'income')`))
      .groupBy(sql`1`)
      .orderBy(sql`1`),

    // Cash vs digital is a position, not a flow: it reads all history.
    db
      .select({ kind: accounts.kind, total: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)::text` })
      .from(accounts)
      .leftJoin(
        ledgerEntries,
        and(eq(ledgerEntries.accountId, accounts.id), eq(ledgerEntries.bucket, 'asset')),
      )
      .where(eq(accounts.userId, userId))
      .groupBy(accounts.kind),
  ]);

  const byCategory = categoryRows
    .map((r) => ({
      id: r.id,
      name: r.name ?? 'Uncategorised',
      icon: r.icon,
      amount: normalizeZero(Number(r.amount)),
    }))
    .filter((r) => r.amount > 0);

  const dailyFlow = dailyRows.map((r) => ({
    date: r.date,
    spent: normalizeZero(Number(r.spent)),
    received: normalizeZero(Number(r.received)),
  }));

  let cash = 0;
  let digital = 0;
  let savingsBalance = 0;
  for (const row of locationRows) {
    const value = Number(row.total);
    if (CASH_ACCOUNT_KINDS.includes(row.kind)) cash += value;
    else if (DIGITAL_ACCOUNT_KINDS.includes(row.kind)) digital += value;
    else if (row.kind === 'savings') savingsBalance += value;
  }

  const totalSpent = dailyFlow.reduce((sum, d) => sum + d.spent, 0);
  const totalReceived = dailyFlow.reduce((sum, d) => sum + d.received, 0);

  return {
    range,
    from: from.toISOString(),
    to: to.toISOString(),
    totalSpent: normalizeZero(totalSpent),
    totalReceived: normalizeZero(totalReceived),
    byCategory,
    dailyFlow,
    cashVsDigital: { cash: normalizeZero(cash), digital: normalizeZero(digital) },
    savingsBalance: normalizeZero(savingsBalance),
    hasData: byCategory.length > 0 || dailyFlow.length > 0,
  };
}
