import { eq, asc } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import {
  accounts,
  ownershipPools,
  people,
  categories,
  transactions,
  ledgerEntries,
  transactionParticipants,
  auditLogs,
} from '../db/schema';
import { ACCOUNT_KINDS, POOL_KINDS, ENTRY_BUCKETS, TRANSACTION_KINDS } from '@shared/domain';
import { sumPaise } from '@shared/money';
import { badRequest } from '../http/errors';
import { assertBalanced } from '../domain/ledger';

export const BACKUP_FORMAT_VERSION = 1;

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

export async function exportBackup(userId: string) {
  const db = getDb();

  const [accountRows, poolRows, personRows, categoryRows, txRows, entryRows, participantRows] =
    await Promise.all([
      db.select().from(accounts).where(eq(accounts.userId, userId)).orderBy(asc(accounts.sortOrder)),
      db.select().from(ownershipPools).where(eq(ownershipPools.userId, userId)),
      db.select().from(people).where(eq(people.userId, userId)),
      db.select().from(categories).where(eq(categories.userId, userId)),
      db.select().from(transactions).where(eq(transactions.userId, userId)).orderBy(asc(transactions.occurredAt)),
      db.select().from(ledgerEntries).where(eq(ledgerEntries.userId, userId)),
      db.select().from(transactionParticipants).where(eq(transactionParticipants.userId, userId)),
    ]);

  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    currency: 'INR',
    amountUnit: 'paise',
    accounts: accountRows.map((a) => ({ id: a.id, name: a.name, kind: a.kind, isDefault: a.isDefault })),
    pools: poolRows.map((p) => ({ id: p.id, name: p.name, kind: p.kind, isDefault: p.isDefault })),
    people: personRows.map((p) => ({ id: p.id, name: p.name, relation: p.relation, note: p.note })),
    categories: categoryRows.map((c) => ({
      id: c.id,
      name: c.name,
      icon: c.icon,
      direction: c.direction,
    })),
    transactions: txRows.map((t) => ({
      id: t.id,
      kind: t.kind,
      amount: t.amount,
      occurredAt: t.occurredAt.toISOString(),
      note: t.note,
      reversesTransactionId: t.reversesTransactionId,
      reversedByTransactionId: t.reversedByTransactionId,
    })),
    entries: entryRows.map((e) => ({
      id: e.id,
      transactionId: e.transactionId,
      bucket: e.bucket,
      amount: e.amount,
      accountId: e.accountId,
      poolId: e.poolId,
      personId: e.personId,
      categoryId: e.categoryId,
      memo: e.memo,
      occurredAt: e.occurredAt.toISOString(),
    })),
    participants: participantRows.map((p) => ({
      transactionId: p.transactionId,
      personId: p.personId,
      shareAmount: p.shareAmount,
    })),
  };
}

export type BackupPayload = Awaited<ReturnType<typeof exportBackup>>;

/** Flat CSV of every ledger entry — one row per leg, so it stays auditable. */
export function toCsv(backup: BackupPayload): string {
  const accountName = new Map(backup.accounts.map((a) => [a.id, a.name]));
  const poolName = new Map(backup.pools.map((p) => [p.id, p.name]));
  const personName = new Map(backup.people.map((p) => [p.id, p.name]));
  const categoryName = new Map(backup.categories.map((c) => [c.id, c.name]));
  const tx = new Map(backup.transactions.map((t) => [t.id, t]));

  const header = [
    'occurred_at',
    'transaction_id',
    'kind',
    'bucket',
    'amount_paise',
    'amount_rupees',
    'account',
    'pool',
    'person',
    'category',
    'note',
  ];

  const escape = (value: unknown): string => {
    const s = value === null || value === undefined ? '' : String(value);
    // A leading =, +, - or @ can be executed by spreadsheet software, so text
    // starting that way is prefixed with an apostrophe. Plain numbers are
    // exempt: quoting "-150.00" as "'-150.00" would turn every negative amount
    // into text and break the column the moment anyone tries to sum it.
    const isPlainNumber = /^-?\d+(\.\d+)?$/.test(s);
    const safe = !isPlainNumber && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };

  const lines = [header.join(',')];
  for (const entry of backup.entries) {
    const t = tx.get(entry.transactionId);
    lines.push(
      [
        entry.occurredAt,
        entry.transactionId,
        t?.kind ?? '',
        entry.bucket,
        entry.amount,
        (entry.amount / 100).toFixed(2),
        entry.accountId ? (accountName.get(entry.accountId) ?? '') : '',
        entry.poolId ? (poolName.get(entry.poolId) ?? '') : '',
        entry.personId ? (personName.get(entry.personId) ?? '') : '',
        entry.categoryId ? (categoryName.get(entry.categoryId) ?? '') : '',
        t?.note ?? '',
      ]
        .map(escape)
        .join(','),
    );
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Import
 * ------------------------------------------------------------------ */

const uuid = z.string().uuid();
const money = z.number().int();

export const backupSchema = z.object({
  formatVersion: z.literal(BACKUP_FORMAT_VERSION),
  amountUnit: z.literal('paise'),
  accounts: z.array(
    z.object({ id: uuid, name: z.string().min(1), kind: z.enum(ACCOUNT_KINDS), isDefault: z.boolean() }),
  ),
  pools: z.array(
    z.object({ id: uuid, name: z.string().min(1), kind: z.enum(POOL_KINDS), isDefault: z.boolean() }),
  ),
  people: z.array(
    z.object({ id: uuid, name: z.string().min(1), relation: z.string().nullable(), note: z.string().nullable() }),
  ),
  categories: z.array(
    z.object({
      id: uuid,
      name: z.string().min(1),
      icon: z.string().nullable(),
      direction: z.enum(['expense', 'income']),
    }),
  ),
  transactions: z.array(
    z.object({
      id: uuid,
      kind: z.enum(TRANSACTION_KINDS),
      amount: money.positive(),
      occurredAt: z.string().datetime({ offset: true }),
      note: z.string().nullable(),
      reversesTransactionId: uuid.nullable(),
      reversedByTransactionId: uuid.nullable(),
    }),
  ),
  entries: z.array(
    z.object({
      id: uuid,
      transactionId: uuid,
      bucket: z.enum(ENTRY_BUCKETS),
      amount: money.refine((n) => n !== 0, 'A ledger entry cannot be zero'),
      accountId: uuid.nullable(),
      poolId: uuid.nullable(),
      personId: uuid.nullable(),
      categoryId: uuid.nullable(),
      memo: z.string().nullable(),
      occurredAt: z.string().datetime({ offset: true }),
    }),
  ),
  participants: z.array(
    z.object({ transactionId: uuid, personId: uuid, shareAmount: money.positive() }),
  ),
});

export interface ImportPreview {
  valid: boolean;
  counts: { transactions: number; entries: number; accounts: number; people: number; categories: number };
  problems: string[];
}

/**
 * A backup is never trusted. Before a single row is written we re-verify that
 * the file is internally consistent AND that every transaction in it still
 * balances — a file that does not balance is rejected, not repaired.
 */
export function validateBackup(raw: unknown): { data: BackupPayload; preview: ImportPreview } {
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest(
      'That file is not a valid Ledger backup.',
      'backup_invalid',
      parsed.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }

  const data = parsed.data as BackupPayload;
  const problems: string[] = [];

  const accountIds = new Set(data.accounts.map((a) => a.id));
  const poolIds = new Set(data.pools.map((p) => p.id));
  const personIds = new Set(data.people.map((p) => p.id));
  const categoryIds = new Set(data.categories.map((c) => c.id));
  const txIds = new Set(data.transactions.map((t) => t.id));

  if (txIds.size !== data.transactions.length) problems.push('The file contains duplicate transaction IDs.');

  const byTx = new Map<string, typeof data.entries>();
  for (const entry of data.entries) {
    if (!txIds.has(entry.transactionId)) {
      problems.push(`An entry references a missing transaction (${entry.transactionId}).`);
      continue;
    }
    if (entry.accountId && !accountIds.has(entry.accountId)) problems.push('An entry references a missing account.');
    if (entry.poolId && !poolIds.has(entry.poolId)) problems.push('An entry references a missing money pool.');
    if (entry.personId && !personIds.has(entry.personId)) problems.push('An entry references a missing person.');
    if (entry.categoryId && !categoryIds.has(entry.categoryId)) problems.push('An entry references a missing category.');

    const list = byTx.get(entry.transactionId);
    if (list) list.push(entry);
    else byTx.set(entry.transactionId, [entry]);
  }

  for (const [id, entries] of byTx) {
    try {
      assertBalanced(
        entries.map((e) => ({
          bucket: e.bucket,
          amount: e.amount,
          accountId: e.accountId,
          poolId: e.poolId,
          personId: e.personId,
          categoryId: e.categoryId,
          memo: e.memo,
        })),
      );
    } catch {
      problems.push(`Transaction ${id} does not balance (off by ${sumPaise(entries.map((e) => e.amount))} paise).`);
    }
  }

  const unique = [...new Set(problems)].slice(0, 20);

  return {
    data,
    preview: {
      valid: unique.length === 0,
      counts: {
        transactions: data.transactions.length,
        entries: data.entries.length,
        accounts: data.accounts.length,
        people: data.people.length,
        categories: data.categories.length,
      },
      problems: unique,
    },
  };
}

export interface ImportResult {
  imported: ImportPreview['counts'];
  skipped: { transactions: number };
}

/**
 * Import is strictly additive. Rows whose IDs already exist are skipped, so
 * importing the same file twice changes nothing and existing data is never
 * silently overwritten.
 */
export async function importBackup(userId: string, raw: unknown): Promise<ImportResult> {
  const { data, preview } = validateBackup(raw);
  if (!preview.valid) {
    throw badRequest('That backup is not internally consistent, so nothing was imported.', 'backup_inconsistent', preview.problems);
  }

  const db = getDb();

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.userId, userId));
    const existingTxIds = new Set(existing.map((r) => r.id));

    if (data.accounts.length) {
      await tx
        .insert(accounts)
        .values(data.accounts.map((a, i) => ({ ...a, userId, sortOrder: i })))
        .onConflictDoNothing();
    }
    if (data.pools.length) {
      await tx
        .insert(ownershipPools)
        .values(data.pools.map((p, i) => ({ ...p, userId, sortOrder: i })))
        .onConflictDoNothing();
    }
    if (data.people.length) {
      await tx.insert(people).values(data.people.map((p) => ({ ...p, userId }))).onConflictDoNothing();
    }
    if (data.categories.length) {
      await tx.insert(categories).values(data.categories.map((c) => ({ ...c, userId }))).onConflictDoNothing();
    }

    const newTransactions = data.transactions.filter((t) => !existingTxIds.has(t.id));
    const newTxIds = new Set(newTransactions.map((t) => t.id));

    if (newTransactions.length) {
      // Reversal links are restored in a second pass so a forward reference
      // cannot violate the foreign key mid-insert.
      await tx.insert(transactions).values(
        newTransactions.map((t) => ({
          id: t.id,
          userId,
          kind: t.kind,
          amount: t.amount,
          occurredAt: new Date(t.occurredAt),
          note: t.note,
        })),
      );

      const entriesToInsert = data.entries.filter((e) => newTxIds.has(e.transactionId));
      if (entriesToInsert.length) {
        await tx.insert(ledgerEntries).values(
          entriesToInsert.map((e) => ({
            id: e.id,
            userId,
            transactionId: e.transactionId,
            bucket: e.bucket,
            amount: e.amount,
            accountId: e.accountId,
            poolId: e.poolId,
            personId: e.personId,
            categoryId: e.categoryId,
            memo: e.memo,
            occurredAt: new Date(e.occurredAt),
          })),
        );
      }

      const participantsToInsert = data.participants.filter((p) => newTxIds.has(p.transactionId));
      if (participantsToInsert.length) {
        await tx
          .insert(transactionParticipants)
          .values(participantsToInsert.map((p) => ({ ...p, userId })))
          .onConflictDoNothing();
      }

      for (const t of newTransactions) {
        if (!t.reversesTransactionId && !t.reversedByTransactionId) continue;
        await tx
          .update(transactions)
          .set({
            reversesTransactionId: t.reversesTransactionId,
            reversedByTransactionId: t.reversedByTransactionId,
          })
          .where(eq(transactions.id, t.id));
      }
    }

    await tx.insert(auditLogs).values({
      userId,
      action: 'backup.import',
      entityType: 'backup',
      metadata: { imported: newTransactions.length, skipped: data.transactions.length - newTransactions.length },
    });

    return {
      imported: { ...preview.counts, transactions: newTransactions.length },
      skipped: { transactions: data.transactions.length - newTransactions.length },
    };
  });
}
