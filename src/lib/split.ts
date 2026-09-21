import { splitEvenly, sumPaise, type Paise } from '@shared/money';
import type { SplitRow } from '../components/SplitEditor';

/**
 * Dividing a bill.
 *
 * The rule that matters: `myShare + every named share === total`, exactly, in
 * paise. If it did not hold, the difference would silently become a rupee
 * that belongs to nobody — the ledger would still balance (the engine sees to
 * that) but it would be recording a debt that never matched the bill.
 *
 * Unfixed shares take an even cut of whatever is left, with remainder paise
 * going to the earliest people so nothing is lost to rounding.
 */

export interface SplitResult {
  myShare: Paise;
  participants: { personId: string; shareAmount: Paise }[];
  /** total − myShare − Σ named. Zero means it reconciles. */
  unassigned: Paise;
  balanced: boolean;
}

export function computeSplit(total: Paise, rows: readonly SplitRow[], myShareOverride: Paise | null): SplitResult {
  const count = rows.length + 1;
  const even = total > 0 ? splitEvenly(total, count) : [];

  const myShare = myShareOverride ?? even[0] ?? 0;
  const remainder = Math.max(0, total - myShare);

  // Anyone without a fixed share divides what is left between them.
  const flexible = rows.filter((r) => r.shareAmount === null);
  const fixedTotal = sumPaise(rows.map((r) => r.shareAmount ?? 0));
  const forFlexible = Math.max(0, remainder - fixedTotal);
  const flexibleShares = flexible.length > 0 ? splitEvenly(forFlexible, flexible.length) : [];

  let flexibleIndex = 0;
  const participants = rows.map((row) => ({
    personId: row.personId,
    shareAmount: row.shareAmount ?? flexibleShares[flexibleIndex++] ?? 0,
  }));

  const named = sumPaise(participants.map((p) => p.shareAmount));
  const unassigned = total - myShare - named;

  return {
    myShare,
    participants,
    unassigned,
    balanced: unassigned === 0 && myShare >= 0 && participants.every((p) => p.shareAmount > 0),
  };
}
