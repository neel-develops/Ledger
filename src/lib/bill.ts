import type { TransactionView } from '@shared/domain';

/**
 * The statement behind a shareable bill: what has passed between you and one
 * person, oldest first, with the running balance after each line.
 *
 * The total is the ledger's own figure for this person, never a sum this code
 * worked out. If the history on hand does not add up to it — older pages not
 * loaded, or more lines than fit on a picture — the difference is shown as a
 * "brought forward" line, so the bill always ends on the true amount.
 */

export interface StatementLine {
  id: string;
  date: string;
  description: string;
  /** Change in what they owe you, in paise: positive adds to it, negative pays it down. */
  change: number;
  /** What they owe you after this line. */
  balance: number;
}

export interface Statement {
  /** What they owed before the first line shown. Zero when the history is complete. */
  broughtForward: number;
  lines: StatementLine[];
  /** The ledger's figure for what they owe you now. */
  total: number;
}

const MAX_LINES = 14;

/** This person's net effect on a transaction; a split can touch them more than once. */
function changeFor(transaction: TransactionView, personId: string): number {
  return transaction.labels.people.filter((p) => p.id === personId).reduce((sum, p) => sum + p.amount, 0);
}

function describe(transaction: TransactionView): string {
  const what = (transaction.note ?? transaction.labels.category ?? '').trim();
  switch (transaction.kind) {
    case 'lend':
      return what ? `Lent to you · ${what}` : 'Lent to you';
    case 'paid_for_someone':
      return what ? `Your share · ${what}` : 'Your share of a bill';
    case 'settle_receivable':
      return 'You paid back';
    case 'borrow':
      return what ? `You lent me · ${what}` : 'You lent me';
    case 'settle_payable':
      return 'I paid you back';
    case 'someone_paid_for_me':
      return what ? `You paid for me · ${what}` : 'You paid for me';
    default:
      return what || 'Adjustment';
  }
}

export function buildStatement(
  person: { id: string; netBalance: number },
  history: TransactionView[],
  maxLines = MAX_LINES,
): Statement {
  // A reversed entry and its reversal cancel out; neither belongs on a bill.
  const effective = history
    .filter((t) => t.kind !== 'reversal' && !t.reversedByTransactionId)
    .map((t) => ({ t, change: changeFor(t, person.id) }))
    .filter((x) => x.change !== 0)
    .sort((a, b) => a.t.occurredAt.localeCompare(b.t.occurredAt));

  const shown = effective.slice(-maxLines);
  const shownSum = shown.reduce((sum, x) => sum + x.change, 0);
  const broughtForward = person.netBalance - shownSum;

  let balance = broughtForward;
  const lines = shown.map(({ t, change }) => {
    balance += change;
    return { id: t.id, date: t.occurredAt, description: describe(t), change, balance };
  });

  return { broughtForward, lines, total: person.netBalance };
}
