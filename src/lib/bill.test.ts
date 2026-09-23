import { describe, it, expect } from 'vitest';
import type { TransactionView } from '@shared/domain';
import { buildStatement } from './bill';

const P = 'arsalaan';

function tx(
  id: string,
  kind: TransactionView['kind'],
  date: string,
  amounts: number[],
  extra: Partial<TransactionView> = {},
): TransactionView {
  return {
    id,
    kind,
    occurredAt: `${date}T10:00:00.000Z`,
    note: null,
    amount: Math.abs(amounts[0] ?? 0),
    reversedByTransactionId: null,
    reversesTransactionId: null,
    createdAt: `${date}T10:00:00.000Z`,
    entries: [],
    labels: {
      account: 'Cash',
      toAccount: null,
      pool: 'My money',
      toPool: null,
      category: null,
      people: amounts.map((amount) => ({ id: P, name: 'Arsalaan', amount })),
    },
    ...extra,
  } as TransactionView;
}

describe('buildStatement', () => {
  it('lists lending and repayments oldest first, with a running balance', () => {
    const history = [
      tx('c', 'settle_receivable', '2026-09-20', [-20000]),
      tx('b', 'paid_for_someone', '2026-09-12', [22500], { note: 'Dinner' }),
      tx('a', 'lend', '2026-09-01', [50000]),
    ];
    const s = buildStatement({ id: P, netBalance: 52500 }, history);

    expect(s.broughtForward).toBe(0);
    expect(s.lines.map((l) => [l.id, l.change, l.balance])).toEqual([
      ['a', 50000, 50000],
      ['b', 22500, 72500],
      ['c', -20000, 52500],
    ]);
    expect(s.lines[1]?.description).toBe('Your share · Dinner');
    expect(s.total).toBe(52500);
  });

  it('leaves out anything reversed, and the reversal itself', () => {
    const history = [
      tx('r', 'reversal', '2026-09-03', [-10000]),
      tx('x', 'lend', '2026-09-02', [10000], { reversedByTransactionId: 'r' }),
      tx('a', 'lend', '2026-09-01', [30000]),
    ];
    const s = buildStatement({ id: P, netBalance: 30000 }, history);
    expect(s.lines.map((l) => l.id)).toEqual(['a']);
    expect(s.broughtForward).toBe(0);
  });

  it('always ends on the ledger total, carrying anything unseen forward', () => {
    // Only the latest page is on hand: the ledger says 80,000 but we can see 30,000 of it.
    const s = buildStatement({ id: P, netBalance: 80000 }, [tx('a', 'lend', '2026-09-01', [30000])]);
    expect(s.broughtForward).toBe(50000);
    expect(s.lines.at(-1)?.balance).toBe(80000);
  });

  it('folds lines beyond the limit into the brought-forward figure', () => {
    const history = Array.from({ length: 5 }, (_, i) => tx(`t${i}`, 'lend', `2026-09-0${i + 1}`, [1000]));
    const s = buildStatement({ id: P, netBalance: 5000 }, history, 3);
    expect(s.lines.map((l) => l.id)).toEqual(['t2', 't3', 't4']);
    expect(s.broughtForward).toBe(2000);
    expect(s.lines.at(-1)?.balance).toBe(5000);
  });

  it('nets two entries for the same person on one transaction', () => {
    const s = buildStatement({ id: P, netBalance: 500 }, [tx('a', 'lend', '2026-09-01', [1500, -1000])]);
    expect(s.lines[0]?.change).toBe(500);
  });
});
