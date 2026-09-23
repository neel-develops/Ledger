import { describe, it, expect } from 'vitest';
import { buildReminder } from './reminder';
import type { TransactionView } from '@shared/domain';

const ARSALAAN = { id: 'p-ars', name: 'Arsalaan Khan', netBalance: 50000 };

function tx(partial: Partial<TransactionView> & { amountOwed: number }): TransactionView {
  return {
    id: Math.random().toString(36),
    kind: 'lend',
    occurredAt: '2026-09-21T12:00:00.000Z',
    note: null,
    amount: partial.amountOwed,
    reversedByTransactionId: null,
    reversesTransactionId: null,
    createdAt: '2026-09-21T12:00:00.000Z',
    entries: [],
    labels: {
      account: 'Cash',
      toAccount: null,
      pool: 'My money',
      toPool: null,
      category: null,
      people: [{ id: 'p-ars', name: 'Arsalaan Khan', amount: partial.amountOwed }],
    },
    ...partial,
  } as TransactionView;
}

describe('debt reminders', () => {
  it('uses their first name and the amount they owe', () => {
    const text = buildReminder(ARSALAAN, []);
    expect(text).toContain('Hey Arsalaan!');
    expect(text).toContain('₹500');
  });

  it('says what it was for when one item explains the whole amount', () => {
    const text = buildReminder(ARSALAAN, [tx({ amountOwed: 50000, note: 'Dinner at Tanay’s' })]);
    expect(text).toMatch(/₹500 for dinner at Tanay’s on 21 Sept?/);
  });

  it('does not cite a single item when the total is made of several', () => {
    // A ₹300 item but ₹500 outstanding: naming the item would understate it.
    const text = buildReminder(ARSALAAN, [tx({ amountOwed: 30000, note: 'Movie' })]);
    expect(text).not.toContain('movie');
    expect(text).toContain('₹500');
  });

  it('ignores reversed transactions', () => {
    const text = buildReminder(ARSALAAN, [
      tx({ amountOwed: 50000, note: 'Mistake', reversedByTransactionId: 'r1' }),
    ]);
    expect(text).not.toContain('mistake');
  });

  it('has nothing to say to someone who does not owe you', () => {
    expect(buildReminder({ ...ARSALAAN, netBalance: 0 }, [])).toBeNull();
    expect(buildReminder({ ...ARSALAAN, netBalance: -20000 }, [])).toBeNull();
  });
});
