import { getDb } from '../db/client';
import { accounts, ownershipPools, categories } from '../db/schema';
import type { AccountKind, PoolKind } from '@shared/domain';

/**
 * A new workspace gets STRUCTURE, never money. Every balance starts at zero
 * and stays there until the user records something real.
 */

const DEFAULT_ACCOUNTS: { name: string; kind: AccountKind; isDefault: boolean }[] = [
  { name: 'Cash', kind: 'cash', isDefault: true },
  { name: 'Bank', kind: 'bank', isDefault: false },
  { name: 'UPI', kind: 'upi', isDefault: false },
  { name: 'Savings', kind: 'savings', isDefault: false },
];

const DEFAULT_POOLS: { name: string; kind: PoolKind; isDefault: boolean }[] = [
  { name: 'My money', kind: 'personal', isDefault: true },
  { name: 'Dad money', kind: 'dad', isDefault: false },
];

const DEFAULT_CATEGORIES: { name: string; icon: string; direction: 'expense' | 'income' }[] = [
  { name: 'Food', icon: 'utensils', direction: 'expense' },
  { name: 'Travel', icon: 'bus', direction: 'expense' },
  { name: 'Shopping', icon: 'shopping-bag', direction: 'expense' },
  { name: 'Bills', icon: 'receipt', direction: 'expense' },
  { name: 'Health', icon: 'heart-pulse', direction: 'expense' },
  { name: 'Rent', icon: 'house', direction: 'expense' },
  { name: 'Other', icon: 'circle-dashed', direction: 'expense' },
  { name: 'Salary', icon: 'briefcase', direction: 'income' },
  { name: 'Gift', icon: 'gift', direction: 'income' },
  { name: 'Other', icon: 'circle-dashed', direction: 'income' },
];

export async function bootstrapUser(userId: string): Promise<void> {
  const db = getDb();

  await db.transaction(async (tx) => {
    await tx
      .insert(accounts)
      .values(DEFAULT_ACCOUNTS.map((a, i) => ({ ...a, userId, sortOrder: i })))
      .onConflictDoNothing();

    await tx
      .insert(ownershipPools)
      .values(DEFAULT_POOLS.map((p, i) => ({ ...p, userId, sortOrder: i })))
      .onConflictDoNothing();

    await tx
      .insert(categories)
      .values(DEFAULT_CATEGORIES.map((c) => ({ ...c, userId })))
      .onConflictDoNothing();
  });
}
