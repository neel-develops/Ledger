/**
 * Is this transaction taking money out of savings?
 *
 * Read off the payload itself, so every kind that spends from an account —
 * expense, transfer, lend, repaying someone, a split bill — is covered by the
 * one rule. Money going INTO savings, or between two savings accounts, is not
 * a withdrawal.
 */

export interface AccountLike {
  id: string;
  name: string;
  kind: string;
}

/** The savings account money would leave, or null when this is not a withdrawal. */
export function savingsWithdrawal(
  payload: { accountId?: unknown; toAccountId?: unknown },
  accounts: readonly AccountLike[],
): AccountLike | null {
  const find = (id: unknown) => (typeof id === 'string' ? accounts.find((a) => a.id === id) : undefined);
  const from = find(payload.accountId);
  if (!from || from.kind !== 'savings') return null;
  // Savings to savings is reshuffling, not spending it.
  if (find(payload.toAccountId)?.kind === 'savings') return null;
  return from;
}
