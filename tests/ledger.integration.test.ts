import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and, sql } from 'drizzle-orm';
import { getDb } from '../server/db/client';
import { createTestDatabase } from './helpers/testDatabase';
import { users, accounts, ownershipPools, people, transactions, ledgerEntries } from '../server/db/schema';
import { bootstrapUser } from '../server/services/bootstrap';
import {
  createTransaction,
  reverseTransaction,
  replaceTransaction,
} from '../server/services/transactions';
import { getDashboard, getPeopleBalances, getPositionBalance } from '../server/services/balances';
import { getLedgerHealth } from '../server/services/health';
import { reconcile } from '../server/services/reconciliation';
import { createPerson } from '../server/services/reference';
import { exportBackup } from '../server/services/backup';

/**
 * End-to-end against a real Postgres, running the real migrations.
 *
 * These are the guarantees a pure unit test cannot reach: atomic commits, the
 * deferred balance trigger, idempotent replay, and per-user isolation. The
 * database is PGlite — genuine Postgres, in this process — so no container or
 * connection string is needed and the suite always actually runs.
 */

const USER_ID = 'test-user-ledger-integration';
const rupees = (n: number) => Math.round(n * 100);

describe('ledger integration', () => {
  let closeDatabase: () => Promise<void>;

  let cash: string;
  let savings: string;
  let personal: string;
  let dad: string;
  let rahul: string;

  beforeAll(async () => {
    ({ close: closeDatabase } = await createTestDatabase());
    const db = getDb();

    await db.insert(users).values({
      id: USER_ID,
      name: 'Integration Test',
      email: `${USER_ID}@example.invalid`,
      emailVerified: true,
    });

    await bootstrapUser(USER_ID);

    const accountRows = await db.select().from(accounts).where(eq(accounts.userId, USER_ID));
    const poolRows = await db.select().from(ownershipPools).where(eq(ownershipPools.userId, USER_ID));

    cash = accountRows.find((a) => a.kind === 'cash')!.id;
    savings = accountRows.find((a) => a.kind === 'savings')!.id;
    personal = poolRows.find((p) => p.kind === 'personal')!.id;
    dad = poolRows.find((p) => p.kind === 'dad')!.id;

    rahul = (await createPerson(USER_ID, { name: 'Rahul', relation: null, note: null }))!.id;
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('starts with a structure but not a single rupee', async () => {
    const dashboard = await getDashboard(USER_ID);
    expect(dashboard.ownedMoney).toBe(0);
    expect(dashboard.netPosition).toBe(0);
    expect(dashboard.hasAnyData).toBe(false);
    expect(dashboard.accounts.length).toBeGreaterThan(0);
    expect(dashboard.accounts.every((a) => a.balance === 0)).toBe(true);
  });

  it('walks the whole real-world scenario and stays accountable at every stage', async () => {
    // Opening position
    for (const [amount, account, pool] of [
      [rupees(2000), cash, personal],
      [rupees(5000), cash, dad],
      [rupees(1000), savings, personal],
    ] as const) {
      await createTransaction(USER_ID, {
        kind: 'opening_balance',
        amount,
        toAccountId: account,
        toPoolId: pool,
        occurredAt: new Date(),
        note: null,
        idempotencyKey: null,
      });
    }

    expect((await getDashboard(USER_ID)).ownedMoney).toBe(rupees(8000));

    // Dad gives ₹2,000
    await createTransaction(USER_ID, {
      kind: 'income',
      amount: rupees(2000),
      toAccountId: cash,
      toPoolId: dad,
      categoryId: null,
      occurredAt: new Date(),
      note: null,
      idempotencyKey: null,
    });

    // Move ₹1,000 Dad -> Personal. Total controlled money must not change.
    const before = await getDashboard(USER_ID);
    await createTransaction(USER_ID, {
      kind: 'transfer',
      amount: rupees(1000),
      accountId: cash,
      poolId: dad,
      toAccountId: cash,
      toPoolId: personal,
      occurredAt: new Date(),
      note: null,
      idempotencyKey: null,
    });

    const afterMove = await getDashboard(USER_ID);
    expect(afterMove.ownedMoney).toBe(before.ownedMoney);
    expect(afterMove.byPool.find((p) => p.id === dad)?.balance).toBe(rupees(6000));
    expect(afterMove.byPool.find((p) => p.id === personal)?.balance).toBe(rupees(4000));

    // Spend ₹300
    await createTransaction(USER_ID, {
      kind: 'expense',
      amount: rupees(300),
      accountId: cash,
      poolId: personal,
      categoryId: null,
      occurredAt: new Date(),
      note: 'Food',
      idempotencyKey: null,
    });

    // Lend ₹500 — net position must NOT move.
    const beforeLending = (await getDashboard(USER_ID)).netPosition;
    await createTransaction(USER_ID, {
      kind: 'lend',
      amount: rupees(500),
      personId: rahul,
      accountId: cash,
      poolId: personal,
      withoutCashMovement: false,
      occurredAt: new Date(),
      note: null,
      idempotencyKey: null,
    });
    expect((await getDashboard(USER_ID)).netPosition).toBe(beforeLending);

    // Rahul returns ₹300
    await createTransaction(USER_ID, {
      kind: 'settle_receivable',
      amount: rupees(300),
      personId: rahul,
      toAccountId: cash,
      toPoolId: personal,
      occurredAt: new Date(),
      note: null,
      idempotencyKey: null,
    });

    // Save ₹1,000
    await createTransaction(USER_ID, {
      kind: 'transfer',
      amount: rupees(1000),
      accountId: cash,
      poolId: personal,
      toAccountId: savings,
      toPoolId: personal,
      occurredAt: new Date(),
      note: null,
      idempotencyKey: null,
    });

    const final = await getDashboard(USER_ID);
    expect(await getPositionBalance(USER_ID, cash, personal)).toBe(rupees(1500));
    expect(await getPositionBalance(USER_ID, cash, dad)).toBe(rupees(6000));
    expect(await getPositionBalance(USER_ID, savings, personal)).toBe(rupees(2000));
    expect(final.ownedMoney).toBe(rupees(9500));
    expect(final.owedToMe).toBe(rupees(200));
    expect(final.iOwe).toBe(0);
    expect(final.netPosition).toBe(rupees(9700));
    expect(final.netPosition).toBe(final.ownedMoney + final.owedToMe - final.iOwe);

    const balances = await getPeopleBalances(USER_ID);
    expect(balances.find((p) => p.id === rahul)?.netBalance).toBe(rupees(200));
  });

  it('answers a replayed idempotency key from history instead of writing twice', async () => {
    const key = `test-replay-${Date.now()}`;
    const payload = {
      kind: 'expense' as const,
      amount: rupees(99),
      accountId: cash,
      poolId: personal,
      categoryId: null,
      occurredAt: new Date(),
      note: 'Replay me',
      idempotencyKey: key,
    };

    const first = await createTransaction(USER_ID, payload);
    const second = await createTransaction(USER_ID, payload);

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);

    const rows = await getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(transactions)
      .where(and(eq(transactions.userId, USER_ID), eq(transactions.idempotencyKey, key)));
    expect(rows[0]?.count).toBe(1);
  });

  it('survives concurrent identical requests without double-charging', async () => {
    const key = `test-race-${Date.now()}`;
    const payload = {
      kind: 'expense' as const,
      amount: rupees(50),
      accountId: cash,
      poolId: personal,
      categoryId: null,
      occurredAt: new Date(),
      note: 'Race',
      idempotencyKey: key,
    };

    const before = (await getDashboard(USER_ID)).ownedMoney;
    const results = await Promise.all([
      createTransaction(USER_ID, payload),
      createTransaction(USER_ID, payload),
      createTransaction(USER_ID, payload),
    ]);

    const ids = new Set(results.map((r) => r.transaction.id));
    expect(ids.size).toBe(1);
    expect((await getDashboard(USER_ID)).ownedMoney).toBe(before - rupees(50));
  });

  it('rolls back completely when a transaction is invalid', async () => {
    const before = await getDashboard(USER_ID);
    const txCountBefore = await countTransactions();

    await expect(
      createTransaction(USER_ID, {
        kind: 'paid_for_someone',
        amount: rupees(1200),
        accountId: cash,
        poolId: personal,
        categoryId: null,
        myShare: rupees(400),
        // 400 + 700 !== 1200
        participants: [{ personId: rahul, shareAmount: rupees(700) }],
        occurredAt: new Date(),
        note: null,
        idempotencyKey: null,
      }),
    ).rejects.toThrow();

    expect((await getDashboard(USER_ID)).ownedMoney).toBe(before.ownedMoney);
    expect(await countTransactions()).toBe(txCountBefore);
  });

  it('refuses an unbalanced write at the database level, even behind the app', async () => {
    // Writing a single lopsided entry directly must be rejected by the
    // deferred constraint trigger when the transaction commits.
    const db = getDb();
    await expect(
      db.transaction(async (tx) => {
        const [row] = await tx
          .insert(transactions)
          .values({
            userId: USER_ID,
            kind: 'expense',
            amount: rupees(10),
            occurredAt: new Date(),
          })
          .returning({ id: transactions.id });

        await tx.insert(ledgerEntries).values({
          userId: USER_ID,
          transactionId: row!.id,
          bucket: 'asset',
          amount: -rupees(10),
          accountId: cash,
          poolId: personal,
          occurredAt: new Date(),
        });
        // No counter-entry — the books do not balance.
      }),
    ).rejects.toThrow();
  });

  it('splits a bill so only my share is an expense', async () => {
    const before = await getDashboard(USER_ID);

    await createTransaction(USER_ID, {
      kind: 'paid_for_someone',
      amount: rupees(1200),
      accountId: cash,
      poolId: personal,
      categoryId: null,
      myShare: rupees(400),
      participants: [{ personId: rahul, shareAmount: rupees(800) }],
      occurredAt: new Date(),
      note: 'Dinner',
      idempotencyKey: null,
    });

    const after = await getDashboard(USER_ID);
    expect(after.ownedMoney).toBe(before.ownedMoney - rupees(1200));
    expect(after.owedToMe).toBe(before.owedToMe + rupees(800));
    // Only ₹400 actually left my net worth.
    expect(after.netPosition).toBe(before.netPosition - rupees(400));
  });

  it('reverses without deleting history', async () => {
    const before = await getDashboard(USER_ID);
    const { transaction } = await createTransaction(USER_ID, {
      kind: 'expense',
      amount: rupees(250),
      accountId: cash,
      poolId: personal,
      categoryId: null,
      occurredAt: new Date(),
      note: 'Mistake',
      idempotencyKey: null,
    });

    const reversal = await reverseTransaction(USER_ID, transaction.id);

    expect((await getDashboard(USER_ID)).ownedMoney).toBe(before.ownedMoney);
    expect(reversal.reversesTransactionId).toBe(transaction.id);

    // The original row is still there.
    const [original] = await getDb()
      .select()
      .from(transactions)
      .where(eq(transactions.id, transaction.id));
    expect(original).toBeDefined();
    expect(original!.reversedByTransactionId).toBe(reversal.id);

    // ...and it cannot be reversed a second time.
    await expect(reverseTransaction(USER_ID, transaction.id)).rejects.toThrow(/already been reversed/);
  });

  it('reports a cash check without changing anything until asked', async () => {
    const expected = await getPositionBalance(USER_ID, cash, personal);
    const dryRun = await reconcile(USER_ID, {
      accountId: cash,
      poolId: personal,
      actualAmount: expected - rupees(50),
      createAdjustment: false,
      note: null,
    });

    expect(dryRun.differenceAmount).toBe(-rupees(50));
    expect(dryRun.adjustmentTransactionId).toBeNull();
    expect(await getPositionBalance(USER_ID, cash, personal)).toBe(expected);

    const applied = await reconcile(USER_ID, {
      accountId: cash,
      poolId: personal,
      actualAmount: expected - rupees(50),
      createAdjustment: true,
      note: null,
    });

    expect(applied.adjustmentTransactionId).not.toBeNull();
    expect(await getPositionBalance(USER_ID, cash, personal)).toBe(expected - rupees(50));
  });

  it('never lets one user see or touch another user’s data', async () => {
    const other = `${USER_ID}-other`;
    const db = getDb();
    await db.insert(users).values({
      id: other,
      name: 'Other',
      email: `${other}@example.invalid`,
      emailVerified: true,
    });
    await bootstrapUser(other);

    try {
      const otherDashboard = await getDashboard(other);
      expect(otherDashboard.ownedMoney).toBe(0);

      // Pointing at our account id from their session must be refused.
      await expect(
        createTransaction(other, {
          kind: 'expense',
          amount: rupees(10),
          accountId: cash,
          poolId: personal,
          categoryId: null,
          occurredAt: new Date(),
          note: null,
          idempotencyKey: null,
        }),
      ).rejects.toThrow(/could not be found/);

      await expect(getDb().select().from(people).where(eq(people.userId, other))).resolves.toHaveLength(0);
    } finally {
      await db.delete(users).where(eq(users.id, other));
    }
  });

  it('edits a transaction by replacing it, atomically', async () => {
    const before = await getDashboard(USER_ID);

    const { transaction } = await createTransaction(USER_ID, {
      kind: 'expense',
      amount: rupees(700),
      accountId: cash,
      poolId: personal,
      categoryId: null,
      occurredAt: new Date(),
      note: 'Typed the wrong amount',
      idempotencyKey: null,
    });

    expect((await getDashboard(USER_ID)).ownedMoney).toBe(before.ownedMoney - rupees(700));

    // It was really ₹400.
    const corrected = await replaceTransaction(USER_ID, transaction.id, {
      kind: 'expense',
      amount: rupees(400),
      accountId: cash,
      poolId: personal,
      categoryId: null,
      occurredAt: new Date(),
      note: 'Corrected',
      idempotencyKey: null,
    });

    expect(corrected.amount).toBe(rupees(400));
    expect((await getDashboard(USER_ID)).ownedMoney).toBe(before.ownedMoney - rupees(400));

    // The original is still there, marked as reversed — the trail is intact.
    const [original] = await getDb()
      .select()
      .from(transactions)
      .where(eq(transactions.id, transaction.id));
    expect(original).toBeDefined();
    expect(original!.reversedByTransactionId).not.toBeNull();

    // ...and it cannot be edited twice.
    await expect(
      replaceTransaction(USER_ID, transaction.id, {
        kind: 'expense',
        amount: rupees(100),
        accountId: cash,
        poolId: personal,
        categoryId: null,
        occurredAt: new Date(),
        note: null,
        idempotencyKey: null,
      }),
    ).rejects.toThrow(/already been reversed/);
  });

  it('leaves an edit entirely undone when the correction is invalid', async () => {
    const { transaction } = await createTransaction(USER_ID, {
      kind: 'expense',
      amount: rupees(120),
      accountId: cash,
      poolId: personal,
      categoryId: null,
      occurredAt: new Date(),
      note: null,
      idempotencyKey: null,
    });

    const before = await getDashboard(USER_ID);

    await expect(
      replaceTransaction(USER_ID, transaction.id, {
        kind: 'paid_for_someone',
        amount: rupees(500),
        accountId: cash,
        poolId: personal,
        categoryId: null,
        myShare: rupees(100),
        // 100 + 200 !== 500
        participants: [{ personId: rahul, shareAmount: rupees(200) }],
        occurredAt: new Date(),
        note: null,
        idempotencyKey: null,
      }),
    ).rejects.toThrow();

    // Nothing moved, and the original is NOT marked reversed.
    expect((await getDashboard(USER_ID)).ownedMoney).toBe(before.ownedMoney);
    const [row] = await getDb().select().from(transactions).where(eq(transactions.id, transaction.id));
    expect(row!.reversedByTransactionId).toBeNull();
  });

  it('passes every ledger health check after all of the above', async () => {
    const report = await getLedgerHealth(USER_ID);
    const failed = report.checks.filter((c) => c.status !== 'pass');
    expect(failed.map((c) => `${c.label}: ${c.detail}`)).toEqual([]);
    expect(report.healthy).toBe(true);
    expect(report.totals.transactions).toBeGreaterThan(0);
  });

  it('exports a backup that balances and re-validates cleanly', async () => {
    const backup = await exportBackup(USER_ID);
    expect(backup.transactions.length).toBeGreaterThan(0);

    const byTx = new Map<string, number>();
    for (const entry of backup.entries) {
      byTx.set(entry.transactionId, (byTx.get(entry.transactionId) ?? 0) + entry.amount);
    }
    for (const [id, total] of byTx) {
      expect(total, `transaction ${id} must balance`).toBe(0);
    }
  });
});

async function countTransactions(): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(eq(transactions.userId, USER_ID));
  return row?.count ?? 0;
}
