import { and, eq, desc, lt, gte, lte, inArray, ilike, or, sql } from 'drizzle-orm';
import { getDb, type Database } from '../db/client';
import {
  accounts,
  ownershipPools,
  people,
  categories,
  transactions,
  ledgerEntries,
  transactionParticipants,
  auditLogs,
  type DbLedgerEntry,
} from '../db/schema';
import {
  buildEntries,
  headlineAmount,
  LedgerError,
  type BuiltEntry,
  type LedgerIntent,
  type Position,
} from '../domain/ledger';
import type { CreateTransactionInput } from '../domain/inputs';
import type { TransactionKind, TransactionView, LedgerEntryView } from '@shared/domain';
import { badRequest, conflict, notFound } from '../http/errors';
import { isUniqueViolation, isCheckViolation } from '../db/errors';

/* ------------------------------------------------------------------ *
 * Reference resolution — nothing is trusted until it is proven to
 * belong to the authenticated user.
 * ------------------------------------------------------------------ */

interface Refs {
  accountIds: Set<string>;
  poolIds: Set<string>;
  personIds: Set<string>;
  categoryIds: Set<string>;
  defaultAccountId: string;
  defaultPoolId: string;
}

async function loadRefs(db: Database, userId: string): Promise<Refs> {
  const [accountRows, poolRows, personRows, categoryRows] = await Promise.all([
    db.select({ id: accounts.id, isDefault: accounts.isDefault, sortOrder: accounts.sortOrder })
      .from(accounts)
      .where(eq(accounts.userId, userId)),
    db.select({ id: ownershipPools.id, isDefault: ownershipPools.isDefault, sortOrder: ownershipPools.sortOrder })
      .from(ownershipPools)
      .where(eq(ownershipPools.userId, userId)),
    db.select({ id: people.id }).from(people).where(eq(people.userId, userId)),
    db.select({ id: categories.id }).from(categories).where(eq(categories.userId, userId)),
  ]);

  const pickDefault = <T extends { id: string; isDefault: boolean; sortOrder: number }>(rows: T[]) =>
    rows.find((r) => r.isDefault)?.id ?? [...rows].sort((a, b) => a.sortOrder - b.sortOrder)[0]?.id;

  const defaultAccountId = pickDefault(accountRows);
  const defaultPoolId = pickDefault(poolRows);

  if (!defaultAccountId || !defaultPoolId) {
    throw badRequest(
      'Add an account before recording money.',
      'workspace_not_ready',
    );
  }

  return {
    accountIds: new Set(accountRows.map((r) => r.id)),
    poolIds: new Set(poolRows.map((r) => r.id)),
    personIds: new Set(personRows.map((r) => r.id)),
    categoryIds: new Set(categoryRows.map((r) => r.id)),
    defaultAccountId,
    defaultPoolId,
  };
}

function resolvePosition(
  refs: Refs,
  accountId: string | null | undefined,
  poolId: string | null | undefined,
  label: string,
): Position {
  const resolvedAccount = accountId ?? refs.defaultAccountId;
  const resolvedPool = poolId ?? refs.defaultPoolId;
  if (!refs.accountIds.has(resolvedAccount)) throw notFound(`The ${label} account`);
  if (!refs.poolIds.has(resolvedPool)) throw notFound(`The ${label} money pool`);
  return { accountId: resolvedAccount, poolId: resolvedPool };
}

function requirePerson(refs: Refs, personId: string): string {
  if (!refs.personIds.has(personId)) throw notFound('That person');
  return personId;
}

function resolveCategory(refs: Refs, categoryId: string | null | undefined): string | null {
  if (!categoryId) return null;
  if (!refs.categoryIds.has(categoryId)) throw notFound('That category');
  return categoryId;
}

/** Map a validated API payload onto a ledger intent. */
function toIntent(input: CreateTransactionInput, refs: Refs): LedgerIntent {
  switch (input.kind) {
    case 'expense':
      return {
        kind: 'expense',
        amount: input.amount,
        from: resolvePosition(refs, input.accountId, input.poolId, 'source'),
        categoryId: resolveCategory(refs, input.categoryId),
      };
    case 'income':
      return {
        kind: 'income',
        amount: input.amount,
        to: resolvePosition(refs, input.toAccountId, input.toPoolId, 'destination'),
        categoryId: resolveCategory(refs, input.categoryId),
      };
    case 'transfer':
      return {
        kind: 'transfer',
        amount: input.amount,
        from: resolvePosition(refs, input.accountId, input.poolId, 'source'),
        to: resolvePosition(refs, input.toAccountId, input.toPoolId, 'destination'),
      };
    case 'lend':
      return {
        kind: 'lend',
        amount: input.amount,
        personId: requirePerson(refs, input.personId),
        from: input.withoutCashMovement
          ? null
          : resolvePosition(refs, input.accountId, input.poolId, 'source'),
      };
    case 'borrow':
      return {
        kind: 'borrow',
        amount: input.amount,
        personId: requirePerson(refs, input.personId),
        to: input.withoutCashMovement
          ? null
          : resolvePosition(refs, input.toAccountId, input.toPoolId, 'destination'),
      };
    case 'settle_receivable':
      return {
        kind: 'settle_receivable',
        amount: input.amount,
        personId: requirePerson(refs, input.personId),
        to: resolvePosition(refs, input.toAccountId, input.toPoolId, 'destination'),
      };
    case 'settle_payable':
      return {
        kind: 'settle_payable',
        amount: input.amount,
        personId: requirePerson(refs, input.personId),
        from: resolvePosition(refs, input.accountId, input.poolId, 'source'),
      };
    case 'paid_for_someone':
      return {
        kind: 'paid_for_someone',
        amount: input.amount,
        from: resolvePosition(refs, input.accountId, input.poolId, 'source'),
        myShare: input.myShare,
        participants: input.participants.map((p) => ({
          personId: requirePerson(refs, p.personId),
          shareAmount: p.shareAmount,
        })),
        categoryId: resolveCategory(refs, input.categoryId),
      };
    case 'someone_paid_for_me':
      return {
        kind: 'someone_paid_for_me',
        amount: input.amount,
        personId: requirePerson(refs, input.personId),
        categoryId: resolveCategory(refs, input.categoryId),
      };
    case 'refund':
      return {
        kind: 'refund',
        amount: input.amount,
        to: resolvePosition(refs, input.toAccountId, input.toPoolId, 'destination'),
        categoryId: resolveCategory(refs, input.categoryId),
      };
    case 'opening_balance':
      return {
        kind: 'opening_balance',
        amount: input.amount,
        to: resolvePosition(refs, input.toAccountId, input.toPoolId, 'destination'),
      };
    case 'adjustment':
      return {
        kind: 'adjustment',
        amount: input.amount,
        position: resolvePosition(refs, input.accountId, input.poolId, 'source'),
        direction: input.direction,
      };
  }
}

/* ------------------------------------------------------------------ *
 * The single writer
 * ------------------------------------------------------------------ */

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

interface WriteInput {
  kind: TransactionKind;
  amount: number;
  occurredAt: Date;
  note?: string | null;
  idempotencyKey?: string | null;
  reversesTransactionId?: string | null;
  entries: BuiltEntry[];
  participants?: { personId: string; shareAmount: number }[];
}

/**
 * Write one transaction and its entries inside a caller-supplied database
 * transaction.
 *
 * Every write path goes through here, so "a transaction and all of its ledger
 * entries land together or not at all" is stated once rather than repeated —
 * and an operation that needs two transactions to be atomic with each other
 * (replacing one, say) can simply call it twice inside a single COMMIT.
 */
async function writeTransaction(tx: Tx, userId: string, input: WriteInput): Promise<string> {
  const [row] = await tx
    .insert(transactions)
    .values({
      userId,
      kind: input.kind,
      amount: input.amount,
      occurredAt: input.occurredAt,
      note: input.note ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      reversesTransactionId: input.reversesTransactionId ?? null,
    })
    .returning({ id: transactions.id });

  if (!row) throw new Error('transaction insert returned no row');

  await tx.insert(ledgerEntries).values(
    input.entries.map((e) => ({
      userId,
      transactionId: row.id,
      bucket: e.bucket,
      amount: e.amount,
      accountId: e.accountId,
      poolId: e.poolId,
      personId: e.personId,
      categoryId: e.categoryId,
      memo: e.memo,
      occurredAt: input.occurredAt,
    })),
  );

  if (input.participants?.length) {
    await tx.insert(transactionParticipants).values(
      input.participants.map((p) => ({
        userId,
        transactionId: row.id,
        personId: p.personId,
        shareAmount: p.shareAmount,
      })),
    );
  }

  const usedCategoryId = input.entries.find((e) => e.categoryId)?.categoryId;
  if (usedCategoryId) {
    await tx
      .update(categories)
      .set({ usageCount: sql`${categories.usageCount} + 1` })
      .where(and(eq(categories.id, usedCategoryId), eq(categories.userId, userId)));
  }

  return row.id;
}

/** Build the mirror image of a set of entries. */
function mirrorOf(entries: readonly LedgerEntryView[]): BuiltEntry[] {
  return buildEntries({
    kind: 'reversal',
    amount: 0,
    original: entries.map((e) => ({
      bucket: e.bucket,
      amount: e.amount,
      accountId: e.accountId,
      poolId: e.poolId,
      personId: e.personId,
      categoryId: e.categoryId,
      memo: e.memo,
    })),
  });
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

export interface CreateResult {
  transaction: TransactionView;
  /** True when an identical idempotency key had already been committed. */
  deduplicated: boolean;
}

/**
 * Create a transaction and all of its ledger entries, atomically.
 *
 * Either the transaction row, every entry and every participant land together,
 * or the database rolls back and nothing at all is written. There is no code
 * path that commits a partial financial record.
 */
export interface TransactionPreview {
  amount: number;
  entries: BuiltEntry[];
}

/**
 * Run a proposed transaction through the real ledger engine WITHOUT writing
 * anything.
 *
 * This is how the assistant's drafts are checked: the exact same reference
 * resolution and double-entry construction that `createTransaction` uses, so
 * a draft that previews cleanly is a draft that will save cleanly. Nothing an
 * AI proposes reaches the user unless it already balances.
 *
 * `extraPersonIds` stands in for people who do not exist yet — "paid for
 * Priya" when Priya is new — so the rest of the draft can still be verified.
 */
export async function previewTransaction(
  userId: string,
  input: CreateTransactionInput,
  options: { extraPersonIds?: string[] } = {},
): Promise<TransactionPreview> {
  const refs = await loadRefs(getDb(), userId);
  for (const id of options.extraPersonIds ?? []) refs.personIds.add(id);

  try {
    const entries = buildEntries(toIntent(input, refs));
    return { amount: headlineAmount(input.kind, entries), entries };
  } catch (error) {
    if (error instanceof LedgerError) throw badRequest(error.message, error.code);
    throw error;
  }
}

export async function createTransaction(
  userId: string,
  input: CreateTransactionInput,
): Promise<CreateResult> {
  const db = getDb();

  // An idempotency key that has already been used is answered from history
  // rather than replayed — this is what makes offline sync safe.
  if (input.idempotencyKey) {
    const existing = await findByIdempotencyKey(userId, input.idempotencyKey);
    if (existing) return { transaction: existing, deduplicated: true };
  }

  const refs = await loadRefs(db, userId);

  let entries: BuiltEntry[];
  try {
    entries = buildEntries(toIntent(input, refs));
  } catch (error) {
    if (error instanceof LedgerError) throw badRequest(error.message, error.code);
    throw error;
  }

  const amount = headlineAmount(input.kind, entries);
  const occurredAt = input.occurredAt;

  try {
    const created = await db.transaction(async (tx) => {
      const id = await writeTransaction(tx, userId, {
        kind: input.kind,
        amount,
        occurredAt,
        note: input.note ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        entries,
        participants: input.kind === 'paid_for_someone' ? input.participants : undefined,
      });

      await tx.insert(auditLogs).values({
        userId,
        action: 'transaction.create',
        entityType: 'transaction',
        entityId: id,
        metadata: { kind: input.kind, amount, entryCount: entries.length },
      });

      return id;
    });

    const view = await getTransaction(userId, created);
    if (!view) throw new Error('transaction vanished immediately after commit');
    return { transaction: view, deduplicated: false };
  } catch (error) {
    // A concurrent request with the same key won the race. Return its result
    // rather than creating a duplicate.
    if (input.idempotencyKey && isUniqueViolation(error)) {
      const existing = await findByIdempotencyKey(userId, input.idempotencyKey);
      if (existing) return { transaction: existing, deduplicated: true };
    }
    // The database's own balance guard fired. That means the entries this
    // service built did not sum to zero, so nothing was committed — and the
    // user must be told that plainly rather than shown a generic failure.
    if (isCheckViolation(error)) {
      throw badRequest(
        'That transaction did not balance, so nothing was saved.',
        'unbalanced_transaction',
      );
    }
    throw error;
  }
}

/**
 * Reverse a transaction by writing its exact mirror image. The original rows
 * are never touched, so the history of what you believed stays intact.
 */
export async function reverseTransaction(
  userId: string,
  transactionId: string,
  options: { idempotencyKey?: string | null; note?: string | null } = {},
): Promise<TransactionView> {
  const db = getDb();

  const original = await getTransaction(userId, transactionId);
  if (!original) throw notFound('That transaction');
  if (original.reversedByTransactionId) {
    throw conflict('That transaction has already been reversed.', 'already_reversed');
  }
  if (original.kind === 'reversal') {
    throw conflict('A reversal cannot itself be reversed.', 'cannot_reverse_reversal');
  }

  const mirrored = mirrorOf(original.entries);

  const occurredAt = new Date();

  const reversalId = await db.transaction(async (tx) => {
    // Re-check under the row lock so two concurrent reversals cannot both win.
    const [locked] = await tx
      .select({ reversedBy: transactions.reversedByTransactionId })
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)))
      .for('update');

    if (!locked) throw notFound('That transaction');
    if (locked.reversedBy) {
      throw conflict('That transaction has already been reversed.', 'already_reversed');
    }

    const reversalRowId = await writeTransaction(tx, userId, {
      kind: 'reversal',
      amount: original.amount,
      occurredAt,
      note: options.note ?? `Reversal of ${original.kind.replace(/_/g, ' ')}`,
      idempotencyKey: options.idempotencyKey ?? null,
      reversesTransactionId: transactionId,
      entries: mirrored,
    });

    await tx
      .update(transactions)
      .set({ reversedByTransactionId: reversalRowId, updatedAt: new Date() })
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)));

    await tx.insert(auditLogs).values({
      userId,
      action: 'transaction.reverse',
      entityType: 'transaction',
      entityId: transactionId,
      metadata: { reversalId: reversalRowId },
    });

    return reversalRowId;
  });

  const view = await getTransaction(userId, reversalId);
  if (!view) throw new Error('reversal vanished immediately after commit');
  return view;
}

/**
 * Edit a transaction, by replacing it.
 *
 * A ledger entry is a statement about what happened; you do not get to go
 * back and change what you said. So an edit writes the reversal of the
 * original AND the corrected version, both inside ONE database transaction —
 * either you end up with a corrected record and an honest trail of the
 * correction, or nothing changes at all. There is no window in which the
 * money has been un-recorded but not yet re-recorded.
 */
export async function replaceTransaction(
  userId: string,
  transactionId: string,
  input: CreateTransactionInput,
): Promise<TransactionView> {
  const db = getDb();

  const original = await getTransaction(userId, transactionId);
  if (!original) throw notFound('That transaction');
  if (original.reversedByTransactionId) {
    throw conflict('That transaction has already been reversed.', 'already_reversed');
  }
  if (original.kind === 'reversal') {
    throw conflict('A reversal cannot be edited.', 'cannot_edit_reversal');
  }

  const refs = await loadRefs(db, userId);

  let entries: BuiltEntry[];
  try {
    entries = buildEntries(toIntent(input, refs));
  } catch (error) {
    if (error instanceof LedgerError) throw badRequest(error.message, error.code);
    throw error;
  }

  const amount = headlineAmount(input.kind, entries);
  const mirrored = mirrorOf(original.entries);
  const now = new Date();

  const replacementId = await db.transaction(async (tx) => {
    // Lock the original so two concurrent edits cannot both succeed.
    const [locked] = await tx
      .select({ reversedBy: transactions.reversedByTransactionId })
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)))
      .for('update');

    if (!locked) throw notFound('That transaction');
    if (locked.reversedBy) {
      throw conflict('That transaction has already been reversed.', 'already_reversed');
    }

    const reversalId = await writeTransaction(tx, userId, {
      kind: 'reversal',
      amount: original.amount,
      occurredAt: now,
      note: 'Superseded by an edit',
      reversesTransactionId: transactionId,
      entries: mirrored,
    });

    await tx
      .update(transactions)
      .set({ reversedByTransactionId: reversalId, updatedAt: now })
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)));

    const newId = await writeTransaction(tx, userId, {
      kind: input.kind,
      amount,
      occurredAt: input.occurredAt,
      note: input.note ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      entries,
      participants: input.kind === 'paid_for_someone' ? input.participants : undefined,
    });

    await tx.insert(auditLogs).values({
      userId,
      action: 'transaction.replace',
      entityType: 'transaction',
      entityId: transactionId,
      metadata: { reversalId, replacementId: newId, kind: input.kind, amount },
    });

    return newId;
  });

  const view = await getTransaction(userId, replacementId);
  if (!view) throw new Error('replacement vanished immediately after commit');
  return view;
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

async function findByIdempotencyKey(userId: string, key: string): Promise<TransactionView | null> {
  const db = getDb();
  const [row] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.idempotencyKey, key)))
    .limit(1);
  return row ? getTransaction(userId, row.id) : null;
}

export interface ListFilters {
  limit: number;
  cursor?: string;
  kind?: string;
  personId?: string;
  accountId?: string;
  poolId?: string;
  categoryId?: string;
  search?: string;
  from?: string;
  to?: string;
}

export async function listTransactions(
  userId: string,
  filters: ListFilters,
): Promise<{ items: TransactionView[]; nextCursor: string | null }> {
  const db = getDb();

  const conditions = [eq(transactions.userId, userId)];
  if (filters.cursor) conditions.push(lt(transactions.occurredAt, new Date(filters.cursor)));
  if (filters.from) conditions.push(gte(transactions.occurredAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(transactions.occurredAt, new Date(filters.to)));
  if (filters.kind) {
    const kinds = filters.kind.split(',').filter(Boolean) as TransactionKind[];
    if (kinds.length) conditions.push(inArray(transactions.kind, kinds));
  }
  if (filters.search) {
    const term = `%${filters.search.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    const noteMatch = ilike(transactions.note, term);
    const personMatch = sql`exists (
      select 1 from ${ledgerEntries}
      join ${people} on ${people.id} = ${ledgerEntries.personId}
      where ${ledgerEntries.transactionId} = ${transactions.id}
        and ${people.name} ilike ${term}
    )`;
    const categoryMatch = sql`exists (
      select 1 from ${ledgerEntries}
      join ${categories} on ${categories.id} = ${ledgerEntries.categoryId}
      where ${ledgerEntries.transactionId} = ${transactions.id}
        and ${categories.name} ilike ${term}
    )`;
    const match = or(noteMatch, personMatch, categoryMatch);
    if (match) conditions.push(match);
  }

  for (const [column, value] of [
    [ledgerEntries.personId, filters.personId],
    [ledgerEntries.accountId, filters.accountId],
    [ledgerEntries.poolId, filters.poolId],
    [ledgerEntries.categoryId, filters.categoryId],
  ] as const) {
    if (!value) continue;
    conditions.push(
      sql`exists (
        select 1 from ${ledgerEntries}
        where ${ledgerEntries.transactionId} = ${transactions.id}
          and ${column} = ${value}
      )`,
    );
  }

  const rows = await db
    .select({ id: transactions.id, occurredAt: transactions.occurredAt })
    .from(transactions)
    .where(and(...conditions))
    .orderBy(desc(transactions.occurredAt), desc(transactions.createdAt))
    .limit(filters.limit + 1);

  const page = rows.slice(0, filters.limit);
  const nextCursor =
    rows.length > filters.limit ? (page[page.length - 1]?.occurredAt.toISOString() ?? null) : null;

  const items = await hydrate(
    userId,
    page.map((r) => r.id),
  );
  return { items, nextCursor };
}

export async function getTransaction(userId: string, id: string): Promise<TransactionView | null> {
  const [view] = await hydrate(userId, [id]);
  return view ?? null;
}

/**
 * Load full transaction views for a set of ids in a fixed number of queries.
 * Lists must never degrade into N+1 lookups.
 */
async function hydrate(userId: string, ids: string[]): Promise<TransactionView[]> {
  if (ids.length === 0) return [];
  const db = getDb();

  const [txRows, entryRows] = await Promise.all([
    db
      .select()
      .from(transactions)
      .where(and(eq(transactions.userId, userId), inArray(transactions.id, ids))),
    db
      .select({
        entry: ledgerEntries,
        accountName: accounts.name,
        poolName: ownershipPools.name,
        personName: people.name,
        categoryName: categories.name,
      })
      .from(ledgerEntries)
      .leftJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
      .leftJoin(ownershipPools, eq(ownershipPools.id, ledgerEntries.poolId))
      .leftJoin(people, eq(people.id, ledgerEntries.personId))
      .leftJoin(categories, eq(categories.id, ledgerEntries.categoryId))
      .where(and(eq(ledgerEntries.userId, userId), inArray(ledgerEntries.transactionId, ids))),
  ]);

  const byTx = new Map<string, typeof entryRows>();
  for (const row of entryRows) {
    const list = byTx.get(row.entry.transactionId);
    if (list) list.push(row);
    else byTx.set(row.entry.transactionId, [row]);
  }

  const order = new Map(ids.map((id, i) => [id, i]));

  return txRows
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map((tx) => {
      const rows = byTx.get(tx.id) ?? [];
      const entries: LedgerEntryView[] = rows.map(({ entry }) => ({
        id: entry.id,
        bucket: entry.bucket,
        amount: entry.amount,
        accountId: entry.accountId,
        poolId: entry.poolId,
        personId: entry.personId,
        categoryId: entry.categoryId,
        memo: entry.memo,
      }));

      const assetRows = rows.filter((r) => r.entry.bucket === 'asset');
      const outgoing = assetRows.find((r) => r.entry.amount < 0);
      const incoming = assetRows.find((r) => r.entry.amount > 0);
      const primary = outgoing ?? incoming;

      const peopleLabels = rows
        .filter((r) => r.entry.personId && r.personName)
        .map((r) => ({
          id: r.entry.personId as string,
          name: r.personName as string,
          amount: r.entry.amount,
        }));

      return {
        id: tx.id,
        kind: tx.kind,
        occurredAt: tx.occurredAt.toISOString(),
        note: tx.note,
        amount: tx.amount,
        reversedByTransactionId: tx.reversedByTransactionId,
        reversesTransactionId: tx.reversesTransactionId,
        createdAt: tx.createdAt.toISOString(),
        entries,
        labels: {
          account: primary?.accountName ?? null,
          toAccount: outgoing && incoming ? (incoming.accountName ?? null) : null,
          pool: primary?.poolName ?? null,
          toPool: outgoing && incoming ? (incoming.poolName ?? null) : null,
          category: rows.find((r) => r.categoryName)?.categoryName ?? null,
          people: peopleLabels,
        },
      } satisfies TransactionView;
    });
}

export type { DbLedgerEntry };
