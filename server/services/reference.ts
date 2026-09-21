import { and, eq, asc, desc, sql, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { accounts, ownershipPools, people, categories, ledgerEntries } from '../db/schema';
import type { CategoryView, PoolView } from '@shared/domain';
import { badRequest, conflict, notFound } from '../http/errors';
import { isUniqueViolation as isDuplicate } from '../db/errors';
import type {
  createAccountSchema,
  updateAccountSchema,
  createPoolSchema,
  createPersonSchema,
  updatePersonSchema,
  createCategorySchema,
} from '../domain/inputs';

/**
 * Accounts, pools, people and categories. These carry no money of their own —
 * they are the coordinates that ledger entries point at.
 */


/* ------------------------------- accounts ------------------------------- */

export async function createAccount(userId: string, input: z.infer<typeof createAccountSchema>) {
  const db = getDb();
  try {
    const [row] = await db.insert(accounts).values({ userId, ...input }).returning();
    return row;
  } catch (error) {
    if (isDuplicate(error)) throw conflict(`You already have an account called “${input.name}”.`);
    throw error;
  }
}

export async function updateAccount(
  userId: string,
  id: string,
  input: z.infer<typeof updateAccountSchema>,
) {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.userId, userId)));
    if (!existing) throw notFound('That account');

    if (input.isDefault) {
      await tx.update(accounts).set({ isDefault: false }).where(eq(accounts.userId, userId));
    }

    const [row] = await tx
      .update(accounts)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
      .returning();

    return row;
  });
}

/**
 * Accounts are never deleted while they carry history — that would orphan
 * ledger entries. They are archived instead.
 */
export async function archiveAccount(userId: string, id: string) {
  const db = getDb();
  const [used] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.userId, userId), eq(ledgerEntries.accountId, id)));

  if ((used?.count ?? 0) > 0) {
    return updateAccount(userId, id, { archived: true });
  }

  const [row] = await db
    .delete(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
    .returning();
  if (!row) throw notFound('That account');
  return row;
}

/* --------------------------------- pools -------------------------------- */

export async function listPools(userId: string): Promise<PoolView[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(ownershipPools)
    .where(eq(ownershipPools.userId, userId))
    .orderBy(asc(ownershipPools.sortOrder), asc(ownershipPools.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    balance: 0,
    isDefault: r.isDefault,
  }));
}

export async function createPool(userId: string, input: z.infer<typeof createPoolSchema>) {
  const db = getDb();
  try {
    const [row] = await db.insert(ownershipPools).values({ userId, ...input }).returning();
    return row;
  } catch (error) {
    if (isDuplicate(error)) throw conflict(`You already have a pool called “${input.name}”.`);
    throw error;
  }
}

/* -------------------------------- people -------------------------------- */

export async function createPerson(userId: string, input: z.infer<typeof createPersonSchema>) {
  const db = getDb();
  try {
    const [row] = await db
      .insert(people)
      .values({ userId, name: input.name, relation: input.relation ?? null, note: input.note ?? null })
      .returning();
    return row;
  } catch (error) {
    if (isDuplicate(error)) throw conflict(`${input.name} is already in your people.`);
    throw error;
  }
}

export async function updatePerson(
  userId: string,
  id: string,
  input: z.infer<typeof updatePersonSchema>,
) {
  const db = getDb();
  const [row] = await db
    .update(people)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.relation !== undefined ? { relation: input.relation } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(people.id, id), eq(people.userId, userId)))
    .returning();
  if (!row) throw notFound('That person');
  return row;
}

/**
 * A person with an outstanding balance cannot be removed — the money would
 * stop being accounted for. Settle first, then archive.
 */
export async function archivePerson(userId: string, id: string) {
  const db = getDb();
  const [balance] = await db
    .select({ net: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)::bigint` })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.userId, userId),
        eq(ledgerEntries.personId, id),
        sql`${ledgerEntries.bucket} in ('receivable', 'payable')`,
      ),
    );

  if (Number(balance?.net ?? 0) !== 0) {
    throw badRequest(
      'Settle what is outstanding with this person before removing them.',
      'person_has_balance',
    );
  }
  return updatePerson(userId, id, { archived: true });
}

/* ------------------------------ categories ------------------------------ */

export async function listCategories(userId: string): Promise<CategoryView[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(categories)
    .where(and(eq(categories.userId, userId), isNull(categories.archivedAt)))
    .orderBy(desc(categories.usageCount), asc(categories.name));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    icon: r.icon,
    direction: r.direction,
    usageCount: r.usageCount,
  }));
}

export async function createCategory(userId: string, input: z.infer<typeof createCategorySchema>) {
  const db = getDb();
  try {
    const [row] = await db
      .insert(categories)
      .values({ userId, name: input.name, icon: input.icon ?? null, direction: input.direction })
      .returning();
    return row;
  } catch (error) {
    if (isDuplicate(error)) throw conflict(`You already have a “${input.name}” category.`);
    throw error;
  }
}
