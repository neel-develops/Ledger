import type { TransactionKind } from '@shared/domain';

/** The wire shape of a write. Mirrors `createTransactionSchema` on the server. */
export interface CreateTransactionPayload {
  kind: TransactionKind;
  amount: number;
  occurredAt?: string;
  note?: string | null;
  idempotencyKey?: string;
  accountId?: string | null;
  poolId?: string | null;
  toAccountId?: string | null;
  toPoolId?: string | null;
  personId?: string;
  categoryId?: string | null;
  myShare?: number;
  participants?: { personId: string; shareAmount: number }[];
  direction?: 'increase' | 'decrease';
  withoutCashMovement?: boolean;
}

export interface LedgerHealthReport {
  checkedAt: string;
  healthy: boolean;
  checks: { id: string; label: string; status: 'pass' | 'fail' | 'warn'; detail: string; count: number }[];
  totals: { transactions: number; entries: number; netPosition: number };
}

export interface ReconciliationResult {
  accountId: string;
  accountName: string;
  expectedAmount: number;
  actualAmount: number;
  differenceAmount: number;
  adjustmentTransactionId: string | null;
  recordedAt: string | null;
}

export interface InsightsReport {
  range: 'week' | 'month' | 'year';
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

export interface ImportPreview {
  valid: boolean;
  counts: { transactions: number; entries: number; accounts: number; people: number; categories: number };
  problems: string[];
}
