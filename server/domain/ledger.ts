/**
 * The ledger engine.
 *
 * This module is PURE. It takes a described intention ("I paid ₹1,200 for
 * dinner and ₹800 of it was Rahul's") and returns the balanced set of ledger
 * entries that expresses it. It touches no database, no clock, no randomness.
 *
 * Every function here obeys one law:
 *
 *     Σ entry.amount === 0
 *
 * in debit-positive convention (see `shared/domain.ts`). If that law ever
 * breaks, `buildEntries` throws rather than returning entries, so a partial or
 * unbalanced transaction can never reach the database.
 */

import { assertPaise, negatePaise, sumPaise, type Paise } from '@shared/money';
import type { EntryBucket, TransactionKind } from '@shared/domain';

export class LedgerError extends Error {
  constructor(
    message: string,
    readonly code: string = 'ledger_invalid',
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}

/** Money always sits at the intersection of a location and an owner. */
export interface Position {
  accountId: string;
  poolId: string;
}

export interface BuiltEntry {
  bucket: EntryBucket;
  amount: Paise;
  accountId: string | null;
  poolId: string | null;
  personId: string | null;
  categoryId: string | null;
  memo: string | null;
}

export interface ParticipantShare {
  personId: string;
  shareAmount: Paise;
}

/* ------------------------------------------------------------------ *
 * Intent types — one per transaction kind
 * ------------------------------------------------------------------ */

interface Base {
  amount: Paise;
  note?: string | null;
}

export type LedgerIntent =
  | (Base & { kind: 'expense'; from: Position; categoryId?: string | null })
  | (Base & { kind: 'income'; to: Position; categoryId?: string | null })
  | (Base & { kind: 'transfer'; from: Position; to: Position })
  | (Base & { kind: 'lend'; personId: string; from: Position | null })
  | (Base & { kind: 'borrow'; personId: string; to: Position | null })
  | (Base & { kind: 'settle_receivable'; personId: string; to: Position })
  | (Base & { kind: 'settle_payable'; personId: string; from: Position })
  | (Base & {
      kind: 'paid_for_someone';
      from: Position;
      myShare: Paise;
      participants: ParticipantShare[];
      categoryId?: string | null;
    })
  | (Base & { kind: 'someone_paid_for_me'; personId: string; categoryId?: string | null })
  | (Base & { kind: 'refund'; to: Position; categoryId?: string | null })
  | (Base & { kind: 'adjustment'; position: Position; direction: 'increase' | 'decrease' })
  | (Base & { kind: 'opening_balance'; to: Position })
  | { kind: 'reversal'; original: BuiltEntry[]; amount: Paise };

/* ------------------------------------------------------------------ *
 * Entry constructors
 * ------------------------------------------------------------------ */

function entry(
  bucket: EntryBucket,
  amount: Paise,
  refs: Partial<Pick<BuiltEntry, 'accountId' | 'poolId' | 'personId' | 'categoryId' | 'memo'>> = {},
): BuiltEntry {
  return {
    bucket,
    amount: assertPaise(amount, `${bucket} entry amount`),
    accountId: refs.accountId ?? null,
    poolId: refs.poolId ?? null,
    personId: refs.personId ?? null,
    categoryId: refs.categoryId ?? null,
    memo: refs.memo ?? null,
  };
}

/** Money moving into (+) or out of (-) a specific account/pool position. */
function asset(delta: Paise, at: Position): BuiltEntry {
  return entry('asset', delta, { accountId: at.accountId, poolId: at.poolId });
}

/** `+` = they owe me more, `-` = they owe me less. */
function receivable(delta: Paise, personId: string): BuiltEntry {
  return entry('receivable', delta, { personId });
}

/** `-` = I owe more, `+` = I owe less. Liabilities are credit-normal. */
function payable(delta: Paise, personId: string): BuiltEntry {
  return entry('payable', delta, { personId });
}

function expense(delta: Paise, categoryId?: string | null): BuiltEntry {
  return entry('expense', delta, { categoryId: categoryId ?? null });
}

function income(delta: Paise, categoryId?: string | null): BuiltEntry {
  return entry('income', delta, { categoryId: categoryId ?? null });
}

function equity(delta: Paise, memo: string): BuiltEntry {
  return entry('equity', delta, { memo });
}

/* ------------------------------------------------------------------ *
 * The builder
 * ------------------------------------------------------------------ */

function requirePositive(amount: Paise): Paise {
  assertPaise(amount);
  if (amount <= 0) throw new LedgerError('Amount must be greater than zero', 'amount_not_positive');
  return amount;
}

function samePosition(a: Position, b: Position): boolean {
  return a.accountId === b.accountId && a.poolId === b.poolId;
}

/**
 * Turn an intent into a balanced set of entries.
 * Throws `LedgerError` rather than returning anything unbalanced.
 */
export function buildEntries(intent: LedgerIntent): BuiltEntry[] {
  const entries = buildUnchecked(intent);
  assertBalanced(entries);
  if (entries.length < 2) {
    throw new LedgerError('A transaction needs at least two entries', 'too_few_entries');
  }
  return entries;
}

function buildUnchecked(intent: LedgerIntent): BuiltEntry[] {
  switch (intent.kind) {
    /* Money is consumed. Assets down, expense up. */
    case 'expense': {
      const amount = requirePositive(intent.amount);
      return [asset(-amount, intent.from), expense(amount, intent.categoryId)];
    }

    /* Money arrives and is mine to keep. Assets up, income up (credit). */
    case 'income': {
      const amount = requirePositive(intent.amount);
      return [asset(amount, intent.to), income(-amount, intent.categoryId)];
    }

    /*
     * The one operation that covers account moves, savings, and pool moves
     * (Dad -> Personal). Net position is untouched by construction: the two
     * asset entries are equal and opposite.
     */
    case 'transfer': {
      const amount = requirePositive(intent.amount);
      if (samePosition(intent.from, intent.to)) {
        throw new LedgerError('A transfer needs two different positions', 'transfer_same_position');
      }
      return [asset(-amount, intent.from), asset(amount, intent.to)];
    }

    /*
     * Lending is NOT an expense. Cash turns into a claim of equal value, so
     * net position is unchanged. `from: null` records a debt that predates
     * the app — the counterpart is opening equity, not a cash movement.
     */
    case 'lend': {
      const amount = requirePositive(intent.amount);
      const claim = receivable(amount, intent.personId);
      return intent.from
        ? [asset(-amount, intent.from), claim]
        : [claim, equity(-amount, 'Opening receivable')];
    }

    /* Borrowing is NOT income. Cash up, liability up, net position unchanged. */
    case 'borrow': {
      const amount = requirePositive(intent.amount);
      const debt = payable(-amount, intent.personId);
      return intent.to ? [asset(amount, intent.to), debt] : [debt, equity(amount, 'Opening payable')];
    }

    /* They paid me back: cash up, their claim on me down. No income. */
    case 'settle_receivable': {
      const amount = requirePositive(intent.amount);
      return [asset(amount, intent.to), receivable(-amount, intent.personId)];
    }

    /*
     * I paid them back: cash down, my liability down. No expense.
     * This also covers paying a third party on their behalf — the money
     * leaves my account and cancels the debt without ever touching them.
     */
    case 'settle_payable': {
      const amount = requirePositive(intent.amount);
      return [asset(-amount, intent.from), payable(amount, intent.personId)];
    }

    /*
     * I picked up the bill. Only MY share is an expense; the rest becomes
     * a receivable from each person, split exactly.
     */
    case 'paid_for_someone': {
      const total = requirePositive(intent.amount);
      assertPaise(intent.myShare, 'my share');
      if (intent.myShare < 0) throw new LedgerError('Your share cannot be negative', 'share_negative');
      if (intent.participants.length === 0) {
        throw new LedgerError('Add at least one person to split with', 'no_participants');
      }

      const seen = new Set<string>();
      for (const p of intent.participants) {
        if (seen.has(p.personId)) {
          throw new LedgerError('The same person was added twice', 'duplicate_participant');
        }
        seen.add(p.personId);
        if (p.shareAmount <= 0) {
          throw new LedgerError('Every share must be greater than zero', 'share_not_positive');
        }
      }

      const shares = sumPaise(intent.participants.map((p) => p.shareAmount));
      if (shares + intent.myShare !== total) {
        throw new LedgerError('The shares do not add up to the total', 'shares_do_not_sum');
      }

      const out: BuiltEntry[] = [asset(-total, intent.from)];
      if (intent.myShare > 0) out.push(expense(intent.myShare, intent.categoryId));
      for (const p of intent.participants) out.push(receivable(p.shareAmount, p.personId));
      return out;
    }

    /*
     * They paid, I consumed. My cash never moved, but I now owe them.
     * Recording the expense here is what keeps spending reports honest.
     */
    case 'someone_paid_for_me': {
      const amount = requirePositive(intent.amount);
      return [expense(amount, intent.categoryId), payable(-amount, intent.personId)];
    }

    /* A refund unwinds spending. Never booked as income. */
    case 'refund': {
      const amount = requirePositive(intent.amount);
      return [asset(amount, intent.to), expense(-amount, intent.categoryId)];
    }

    /*
     * Reconciliation. The counterpart is equity, never an expense or income,
     * because a miscount is not a financial event — it is a correction to
     * what we believed.
     */
    case 'adjustment': {
      const amount = requirePositive(intent.amount);
      const delta = intent.direction === 'increase' ? amount : -amount;
      return [
        asset(delta, intent.position),
        equity(-delta, intent.direction === 'increase' ? 'Cash found' : 'Cash shortfall'),
      ];
    }

    /* Where the story starts. Assets up, opening equity down. */
    case 'opening_balance': {
      const amount = requirePositive(intent.amount);
      return [asset(amount, intent.to), equity(-amount, 'Opening balance')];
    }

    /*
     * The only way to undo anything. History is never edited or deleted:
     * we write the exact mirror image of the original entries.
     */
    case 'reversal': {
      if (intent.original.length === 0) {
        throw new LedgerError('Nothing to reverse', 'nothing_to_reverse');
      }
      return intent.original.map((e) => ({ ...e, amount: -e.amount, memo: e.memo ?? 'Reversal' }));
    }
  }
}

/* ------------------------------------------------------------------ *
 * Invariants
 * ------------------------------------------------------------------ */

export function assertBalanced(entries: readonly BuiltEntry[]): void {
  const total = sumPaise(entries.map((e) => e.amount));
  if (total !== 0) {
    throw new LedgerError(
      `Entries do not balance (off by ${total} paise). Nothing was saved.`,
      'unbalanced',
    );
  }
  for (const e of entries) {
    if (e.amount === 0) throw new LedgerError('A ledger entry cannot be zero', 'zero_entry');
    if (e.bucket === 'asset' && (!e.accountId || !e.poolId)) {
      throw new LedgerError('Asset entries need both an account and an owner', 'asset_refs_missing');
    }
    if ((e.bucket === 'receivable' || e.bucket === 'payable') && !e.personId) {
      throw new LedgerError('Debt entries need a person', 'debt_person_missing');
    }
    if (e.bucket !== 'asset' && (e.accountId || e.poolId)) {
      throw new LedgerError('Only asset entries may reference an account', 'unexpected_asset_refs');
    }
  }
}

/** Net Position = owned money + what others owe me - what I owe others. */
export function netPosition(entries: readonly { bucket: EntryBucket; amount: Paise }[]): Paise {
  return sumPaise(
    entries
      .filter((e) => e.bucket === 'asset' || e.bucket === 'receivable' || e.bucket === 'payable')
      .map((e) => e.amount),
  );
}

export function bucketTotal(
  entries: readonly { bucket: EntryBucket; amount: Paise }[],
  bucket: EntryBucket,
): Paise {
  return sumPaise(entries.filter((e) => e.bucket === bucket).map((e) => e.amount));
}

/** Every rupee I physically control, whoever it belongs to. */
export function ownedMoney(entries: readonly { bucket: EntryBucket; amount: Paise }[]): Paise {
  return bucketTotal(entries, 'asset');
}

export function owedToMe(entries: readonly { bucket: EntryBucket; amount: Paise }[]): Paise {
  return bucketTotal(entries, 'receivable');
}

/** Returned as a positive number: "I owe ₹300", not "-₹300". */
export function iOwe(entries: readonly { bucket: EntryBucket; amount: Paise }[]): Paise {
  return negatePaise(bucketTotal(entries, 'payable'));
}

export function totalExpenses(entries: readonly { bucket: EntryBucket; amount: Paise }[]): Paise {
  return bucketTotal(entries, 'expense');
}

export function totalIncome(entries: readonly { bucket: EntryBucket; amount: Paise }[]): Paise {
  return negatePaise(bucketTotal(entries, 'income'));
}

/** The largest single leg in a bucket. */
function largestLeg(entries: readonly BuiltEntry[], bucket: EntryBucket): Paise {
  return entries
    .filter((e) => e.bucket === bucket)
    .reduce((max, e) => Math.max(max, Math.abs(e.amount)), 0);
}

/**
 * The headline number a transaction shows in a list. Always positive.
 *
 * Note this cannot be `|Σ asset|`: a transfer's two asset legs cancel to zero
 * by design, so the headline has to come from a single leg.
 */
export function headlineAmount(kind: TransactionKind, entries: readonly BuiltEntry[]): Paise {
  switch (kind) {
    case 'transfer':
      return largestLeg(entries, 'asset');
    case 'someone_paid_for_me':
      return Math.abs(bucketTotal(entries, 'expense'));
    default: {
      // For everything else the asset legs all point the same way, so their
      // sum is the true cash movement (a ₹1,200 split bill, not ₹800 + ₹400).
      const assetMoved = Math.abs(bucketTotal(entries, 'asset'));
      if (assetMoved > 0) return assetMoved;
      // Purely bookkeeping transactions (an opening debt, say) move no cash;
      // the headline is then the largest non-equity leg.
      return entries
        .filter((e) => e.bucket !== 'equity')
        .reduce((max, e) => Math.max(max, Math.abs(e.amount)), 0);
    }
  }
}
