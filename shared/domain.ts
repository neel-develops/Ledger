/**
 * The shared vocabulary of the ledger. Client and server both import this file
 * so a transaction kind can never mean two different things.
 */

/* ------------------------------------------------------------------ *
 * Ledger primitives
 * ------------------------------------------------------------------ */

/**
 * Every ledger entry belongs to exactly one bucket. Amounts are stored in
 * DEBIT-POSITIVE convention, so the entries of a transaction always sum to 0.
 *
 *   asset       + increases money I hold        (requires account + pool)
 *   receivable  + increases what others owe me  (requires person)
 *   payable     - increases what I owe others   (requires person)
 *   expense     + increases spending            (optional category)
 *   income      - increases earnings            (optional category)
 *   equity      - opening balances / adjustments
 *
 * The sign convention is what makes the global invariant fall out for free:
 *   Net Position = Σ(asset) + Σ(receivable) + Σ(payable)
 */
export const ENTRY_BUCKETS = ['asset', 'receivable', 'payable', 'expense', 'income', 'equity'] as const;
export type EntryBucket = (typeof ENTRY_BUCKETS)[number];

/** Buckets that make up the user's net position. */
export const NET_POSITION_BUCKETS: readonly EntryBucket[] = ['asset', 'receivable', 'payable'];

export const ACCOUNT_KINDS = ['cash', 'bank', 'upi', 'wallet', 'savings', 'other'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

/** Accounts that hold money you can spend right now (savings is deliberately excluded). */
export const SPENDABLE_ACCOUNT_KINDS: readonly AccountKind[] = ['cash', 'bank', 'upi', 'wallet', 'other'];

/** Accounts that live in a physical wallet rather than an institution. */
export const CASH_ACCOUNT_KINDS: readonly AccountKind[] = ['cash'];
export const DIGITAL_ACCOUNT_KINDS: readonly AccountKind[] = ['bank', 'upi', 'wallet'];

/** Ownership is orthogonal to location: ₹5,000 of Dad's money can sit in Cash and Bank. */
export const POOL_KINDS = ['personal', 'dad', 'borrowed', 'other'] as const;
export type PoolKind = (typeof POOL_KINDS)[number];

/* ------------------------------------------------------------------ *
 * Transaction kinds
 * ------------------------------------------------------------------ */

export const TRANSACTION_KINDS = [
  /** Money left my hands and is gone. */
  'expense',
  /** Money arrived and is mine (salary, gift, dad handing over cash). */
  'income',
  /** Money moved between two (account, pool) positions. Net position unchanged. */
  'transfer',
  /** I gave money to a person and expect it back. Not an expense. */
  'lend',
  /** A person gave me money I must return. Not income. */
  'borrow',
  /** A person repaid me. Reduces their receivable. */
  'settle_receivable',
  /** I repaid a person (directly, or by paying a bill on their behalf). */
  'settle_payable',
  /** I paid a bill; part was my expense, the rest is owed back to me. */
  'paid_for_someone',
  /** Someone paid a bill for me; my expense, and I now owe them. */
  'someone_paid_for_me',
  /** Money came back from a merchant. Reduces the original expense. */
  'refund',
  /** Exact negation of an earlier transaction. Never deletes history. */
  'reversal',
  /** Reconciliation correction. Balances an account against reality via equity. */
  'adjustment',
  /** Starting balance for an account/pool, or a debt that predates the app. */
  'opening_balance',
] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export const TRANSACTION_KIND_LABELS: Record<TransactionKind, string> = {
  expense: 'Expense',
  income: 'Received',
  transfer: 'Transfer',
  lend: 'Lent money',
  borrow: 'Borrowed money',
  settle_receivable: 'Repaid to me',
  settle_payable: 'Debt settled',
  paid_for_someone: 'Paid for someone',
  someone_paid_for_me: 'Someone paid for me',
  refund: 'Refund',
  reversal: 'Reversal',
  adjustment: 'Adjustment',
  opening_balance: 'Opening balance',
};

/** Kinds a user can pick from the quick-action sheet, in display order. */
export const QUICK_ACTION_KINDS: readonly TransactionKind[] = [
  'expense',
  'income',
  'transfer',
  'lend',
  'borrow',
  'paid_for_someone',
];

/* ------------------------------------------------------------------ *
 * Wire types
 * ------------------------------------------------------------------ */

export interface LedgerEntryView {
  id: string;
  bucket: EntryBucket;
  amount: number;
  accountId: string | null;
  poolId: string | null;
  personId: string | null;
  categoryId: string | null;
  memo: string | null;
}

export interface TransactionView {
  id: string;
  kind: TransactionKind;
  occurredAt: string;
  note: string | null;
  /** Headline amount for the UI. Always positive; the kind carries the direction. */
  amount: number;
  reversedByTransactionId: string | null;
  reversesTransactionId: string | null;
  createdAt: string;
  entries: LedgerEntryView[];
  /** Denormalised labels so lists do not need N lookups. */
  labels: {
    account: string | null;
    toAccount: string | null;
    pool: string | null;
    toPool: string | null;
    category: string | null;
    people: { id: string; name: string; amount: number }[];
  };
}

export interface AccountView {
  id: string;
  name: string;
  kind: AccountKind;
  balance: number;
  archivedAt: string | null;
  isDefault: boolean;
}

export interface PoolView {
  id: string;
  name: string;
  kind: PoolKind;
  balance: number;
  isDefault: boolean;
}

export interface PersonView {
  id: string;
  name: string;
  /** > 0 they owe me, < 0 I owe them, 0 settled. */
  netBalance: number;
  receivable: number;
  payable: number;
  archivedAt: string | null;
}

export interface CategoryView {
  id: string;
  name: string;
  icon: string | null;
  direction: 'expense' | 'income';
  usageCount: number;
}

export interface DashboardView {
  /** Σ asset — every rupee I physically control, mine or not. */
  ownedMoney: number;
  /** Σ receivable */
  owedToMe: number;
  /** Positive number: what I owe. */
  iOwe: number;
  /** ownedMoney + owedToMe - iOwe */
  netPosition: number;
  byLocation: {
    cash: number;
    digital: number;
    savings: number;
    other: number;
  };
  byPool: PoolView[];
  accounts: AccountView[];
  hasAnyData: boolean;
  recentTransactions: TransactionView[];
}
