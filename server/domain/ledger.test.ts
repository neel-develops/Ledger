import { describe, it, expect } from 'vitest';
import {
  buildEntries,
  netPosition,
  bucketTotal,
  headlineAmount,
  ownedMoney,
  owedToMe,
  iOwe,
  totalExpenses,
  totalIncome,
  LedgerError,
  type BuiltEntry,
  type LedgerIntent,
  type Position,
} from './ledger';
import { parseRupeesToPaise, formatPaise, splitEvenly, sumPaise } from '@shared/money';

/* ------------------------------------------------------------------ *
 * Fixtures — ids only, no amounts. There is no seeded money anywhere.
 * ------------------------------------------------------------------ */

const CASH = 'acc-cash';
const BANK = 'acc-bank';
const SAVINGS = 'acc-savings';
const PERSONAL = 'pool-personal';
const DAD = 'pool-dad';
const RAHUL = 'person-rahul';
const AAYUSH = 'person-aayush';
const SAHIL = 'person-sahil';
const FOOD = 'cat-food';

const cash: Position = { accountId: CASH, poolId: PERSONAL };
const bank: Position = { accountId: BANK, poolId: PERSONAL };
const savings: Position = { accountId: SAVINGS, poolId: PERSONAL };
const dadCash: Position = { accountId: CASH, poolId: DAD };

/** ₹ -> paise, for readable tests. */
const r = (rupees: string | number): number => {
  const p = parseRupeesToPaise(rupees);
  if (p === null) throw new Error(`bad fixture amount: ${rupees}`);
  return p;
};

/** A tiny in-memory ledger so we can assert on running balances. */
class TestLedger {
  readonly entries: BuiltEntry[] = [];

  post(intent: LedgerIntent): BuiltEntry[] {
    const built = buildEntries(intent);
    this.entries.push(...built);
    return built;
  }

  accountBalance(accountId: string): number {
    return sumPaise(
      this.entries.filter((e) => e.bucket === 'asset' && e.accountId === accountId).map((e) => e.amount),
    );
  }

  poolBalance(poolId: string): number {
    return sumPaise(
      this.entries.filter((e) => e.bucket === 'asset' && e.poolId === poolId).map((e) => e.amount),
    );
  }

  positionBalance(p: Position): number {
    return sumPaise(
      this.entries
        .filter((e) => e.bucket === 'asset' && e.accountId === p.accountId && e.poolId === p.poolId)
        .map((e) => e.amount),
    );
  }

  /** > 0 they owe me, < 0 I owe them. */
  personNet(personId: string): number {
    return sumPaise(
      this.entries
        .filter((e) => (e.bucket === 'receivable' || e.bucket === 'payable') && e.personId === personId)
        .map((e) => e.amount),
    );
  }

  owned(): number {
    return ownedMoney(this.entries);
  }
  owedToMe(): number {
    return owedToMe(this.entries);
  }
  iOwe(): number {
    return iOwe(this.entries);
  }
  expenses(): number {
    return totalExpenses(this.entries);
  }
  income(): number {
    return totalIncome(this.entries);
  }
  net(): number {
    return netPosition(this.entries);
  }

  /** The books must balance after every single posting, not just at the end. */
  assertBooksBalance(): void {
    expect(sumPaise(this.entries.map((e) => e.amount))).toBe(0);
  }
}

/* ------------------------------------------------------------------ *
 * Money primitives
 * ------------------------------------------------------------------ */

describe('money is integer paise, always', () => {
  it('parses rupee input exactly', () => {
    expect(parseRupeesToPaise('150.50')).toBe(15050);
    expect(parseRupeesToPaise('150.5')).toBe(15050);
    expect(parseRupeesToPaise('150')).toBe(15000);
    expect(parseRupeesToPaise('0.01')).toBe(1);
    expect(parseRupeesToPaise('₹1,250.75')).toBe(125075);
    expect(parseRupeesToPaise('')).toBeNull();
    expect(parseRupeesToPaise('abc')).toBeNull();
    expect(parseRupeesToPaise('1.234')).toBeNull();
  });

  it('never produces a float rounding error', () => {
    // 0.1 + 0.2 !== 0.3 in floats; in paise it is exact.
    expect(r('0.10') + r('0.20')).toBe(r('0.30'));
    const hundredTimesTenPaise = sumPaise(Array.from({ length: 100 }, () => r('0.10')));
    expect(hundredTimesTenPaise).toBe(r('10'));
  });

  it('formats with Indian digit grouping', () => {
    expect(formatPaise(r('150.50'))).toBe('₹150.50');
    expect(formatPaise(r('1500'))).toBe('₹1,500');
    expect(formatPaise(r('125000'))).toBe('₹1,25,000');
    expect(formatPaise(r('10000000'))).toBe('₹1,00,00,000');
    expect(formatPaise(-r('50'), { signed: true })).toBe('-₹50');
  });

  it('splits without losing a paisa', () => {
    expect(splitEvenly(r('100'), 3)).toEqual([3334, 3333, 3333]);
    expect(sumPaise(splitEvenly(r('100'), 3))).toBe(r('100'));
    expect(sumPaise(splitEvenly(r('0.05'), 2))).toBe(r('0.05'));
  });
});

/* ------------------------------------------------------------------ *
 * Per-kind accounting rules
 * ------------------------------------------------------------------ */

describe('expense', () => {
  it('moves money out of an account and into spending', () => {
    const l = new TestLedger();
    l.post({ kind: 'opening_balance', amount: r('1000'), to: cash });
    l.post({ kind: 'expense', amount: r('500'), from: cash, categoryId: FOOD });

    expect(l.accountBalance(CASH)).toBe(-r('500') + r('1000'));
    expect(l.expenses()).toBe(r('500'));
    expect(l.net()).toBe(r('500'));
    l.assertBooksBalance();
  });

  it('refuses a zero or negative amount', () => {
    expect(() => buildEntries({ kind: 'expense', amount: 0, from: cash })).toThrow(LedgerError);
    expect(() => buildEntries({ kind: 'expense', amount: -100, from: cash })).toThrow(LedgerError);
  });
});

describe('income', () => {
  it('is not booked as an expense reversal', () => {
    const l = new TestLedger();
    l.post({ kind: 'income', amount: r('2000'), to: bank });
    expect(l.accountBalance(BANK)).toBe(r('2000'));
    expect(l.income()).toBe(r('2000'));
    expect(l.expenses()).toBe(0);
    expect(l.net()).toBe(r('2000'));
  });
});

describe('transfer', () => {
  it('leaves total owned money unchanged', () => {
    const l = new TestLedger();
    l.post({ kind: 'opening_balance', amount: r('5000'), to: cash });
    const before = l.owned();
    l.post({ kind: 'transfer', amount: r('2000'), from: cash, to: bank });

    expect(l.accountBalance(CASH)).toBe(r('3000'));
    expect(l.accountBalance(BANK)).toBe(r('2000'));
    expect(l.owned()).toBe(before);
    expect(l.net()).toBe(before);
  });

  it('cannot transfer to the same position', () => {
    expect(() => buildEntries({ kind: 'transfer', amount: r('1'), from: cash, to: { ...cash } })).toThrow(
      /two different positions/,
    );
  });

  it('moves between pools without changing what I control', () => {
    const l = new TestLedger();
    l.post({ kind: 'opening_balance', amount: r('5000'), to: dadCash });
    const before = l.owned();

    l.post({ kind: 'transfer', amount: r('1000'), from: dadCash, to: cash });

    expect(l.poolBalance(DAD)).toBe(r('4000'));
    expect(l.poolBalance(PERSONAL)).toBe(r('1000'));
    expect(l.owned()).toBe(before);
    // Same physical account, two different owners.
    expect(l.accountBalance(CASH)).toBe(r('5000'));
  });

  it('keeps savings out of spendable money without calling it an expense', () => {
    const l = new TestLedger();
    l.post({ kind: 'opening_balance', amount: r('10000'), to: cash });
    l.post({ kind: 'transfer', amount: r('2000'), from: cash, to: savings });

    expect(l.accountBalance(CASH)).toBe(r('8000'));
    expect(l.accountBalance(SAVINGS)).toBe(r('2000'));
    expect(l.owned()).toBe(r('10000'));
    expect(l.expenses()).toBe(0);
  });
});

describe('lending', () => {
  it('is not an expense and does not reduce net position', () => {
    const l = new TestLedger();
    l.post({ kind: 'opening_balance', amount: r('2000'), to: cash });
    const before = l.net();

    l.post({ kind: 'lend', amount: r('500'), personId: RAHUL, from: cash });

    expect(l.accountBalance(CASH)).toBe(r('1500'));
    expect(l.owedToMe()).toBe(r('500'));
    expect(l.expenses()).toBe(0);
    expect(l.net()).toBe(before);
    expect(l.personNet(RAHUL)).toBe(r('500'));
  });

  it('can record a debt that predates the app, with no cash movement', () => {
    const l = new TestLedger();
    l.post({ kind: 'lend', amount: r('300'), personId: AAYUSH, from: null });

    expect(l.owned()).toBe(0);
    expect(l.owedToMe()).toBe(r('300'));
    l.assertBooksBalance();
  });
});

describe('borrowing', () => {
  it('is not income and does not increase net position', () => {
    const l = new TestLedger();
    const before = l.net();
    l.post({ kind: 'borrow', amount: r('1000'), personId: SAHIL, to: cash });

    expect(l.accountBalance(CASH)).toBe(r('1000'));
    expect(l.iOwe()).toBe(r('1000'));
    expect(l.income()).toBe(0);
    expect(l.net()).toBe(before);
    expect(l.personNet(SAHIL)).toBe(-r('1000'));
  });
});

describe('debt settlement', () => {
  it('reduces a receivable without booking income', () => {
    const l = new TestLedger();
    l.post({ kind: 'opening_balance', amount: r('2000'), to: cash });
    l.post({ kind: 'lend', amount: r('500'), personId: RAHUL, from: cash });
    l.post({ kind: 'settle_receivable', amount: r('500'), personId: RAHUL, to: cash });

    expect(l.accountBalance(CASH)).toBe(r('2000'));
    expect(l.owedToMe()).toBe(0);
    expect(l.income()).toBe(0);
    expect(l.personNet(RAHUL)).toBe(0);
  });

  it('reduces a liability without booking an expense', () => {
    const l = new TestLedger();
    l.post({ kind: 'borrow', amount: r('1000'), personId: SAHIL, to: cash });
    l.post({ kind: 'settle_payable', amount: r('1000'), personId: SAHIL, from: cash });

    expect(l.accountBalance(CASH)).toBe(0);
    expect(l.iOwe()).toBe(0);
    expect(l.expenses()).toBe(0);
  });

  it('handles a partial settlement and leaves the remainder outstanding', () => {
    const l = new TestLedger();
    l.post({ kind: 'opening_balance', amount: r('1000'), to: cash });
    l.post({ kind: 'lend', amount: r('500'), personId: RAHUL, from: cash });
    l.post({ kind: 'settle_receivable', amount: r('300'), personId: RAHUL, to: cash });

    expect(l.personNet(RAHUL)).toBe(r('200'));
    expect(l.accountBalance(CASH)).toBe(r('800'));
    expect(l.net()).toBe(r('1000'));
  });

  it('settles a debt by paying the other person’s bill directly', () => {
    // I owe Rahul ₹500. Instead of handing him cash, I pay his ₹500 online
    // bill. My bank drops by ₹500 and the debt is gone. No expense of mine.
    const l = new TestLedger();
    l.post({ kind: 'opening_balance', amount: r('5000'), to: bank });
    l.post({ kind: 'borrow', amount: r('500'), personId: RAHUL, to: bank });
    const netAfterBorrow = l.net();

    l.post({ kind: 'settle_payable', amount: r('500'), personId: RAHUL, from: bank });

    expect(l.accountBalance(BANK)).toBe(r('5000'));
    expect(l.iOwe()).toBe(0);
    expect(l.expenses()).toBe(0);
    expect(l.net()).toBe(netAfterBorrow);
  });

  it('nets a person who has owed in both directions over time', () => {
    const l = new TestLedger();
    l.post({ kind: 'opening_balance', amount: r('5000'), to: cash });
    l.post({ kind: 'lend', amount: r('800'), personId: RAHUL, from: cash });
    l.post({ kind: 'borrow', amount: r('300'), personId: RAHUL, to: cash });

    // Both histories survive; only the net is netted.
    expect(l.owedToMe()).toBe(r('800'));
    expect(l.iOwe()).toBe(r('300'));
    expect(l.personNet(RAHUL)).toBe(r('500'));
  });
});

describe('paid for someone', () => {
  it('books only my share as an expense', () => {
    const l = new TestLedger();
    l.post({ kind: 'opening_balance', amount: r('5000'), to: cash });
    l.post({
      kind: 'paid_for_someone',
      amount: r('1200'),
      from: cash,
      myShare: r('400'),
      participants: [{ personId: RAHUL, shareAmount: r('800') }],
      categoryId: FOOD,
    });

    expect(l.accountBalance(CASH)).toBe(r('3800'));
    expect(l.expenses()).toBe(r('400'));
    expect(l.personNet(RAHUL)).toBe(r('800'));
    expect(l.net()).toBe(r('5000') - r('400'));
  });

  it('splits across several people', () => {
    const l = new TestLedger();
    l.post({ kind: 'opening_balance', amount: r('5000'), to: cash });
    l.post({
      kind: 'paid_for_someone',
      amount: r('900'),
      from: cash,
      myShare: r('300'),
      participants: [
        { personId: RAHUL, shareAmount: r('300') },
        { personId: AAYUSH, shareAmount: r('300') },
      ],
    });

    expect(l.owedToMe()).toBe(r('600'));
    expect(l.expenses()).toBe(r('300'));
    l.assertBooksBalance();
  });

  it('supports paying entirely for someone else (my share is zero)', () => {
    const l = new TestLedger();
    l.post({ kind: 'opening_balance', amount: r('1000'), to: cash });
    l.post({
      kind: 'paid_for_someone',
      amount: r('250'),
      from: cash,
      myShare: 0,
      participants: [{ personId: AAYUSH, shareAmount: r('250') }],
    });

    expect(l.expenses()).toBe(0);
    expect(l.personNet(AAYUSH)).toBe(r('250'));
    expect(l.net()).toBe(r('1000'));
  });

  it('rejects shares that do not add up', () => {
    expect(() =>
      buildEntries({
        kind: 'paid_for_someone',
        amount: r('1200'),
        from: cash,
        myShare: r('400'),
        participants: [{ personId: RAHUL, shareAmount: r('700') }],
      }),
    ).toThrow(/do not add up/);
  });

  it('rejects the same person twice', () => {
    expect(() =>
      buildEntries({
        kind: 'paid_for_someone',
        amount: r('200'),
        from: cash,
        myShare: 0,
        participants: [
          { personId: RAHUL, shareAmount: r('100') },
          { personId: RAHUL, shareAmount: r('100') },
        ],
      }),
    ).toThrow(/twice/);
  });
});

describe('someone paid for me', () => {
  it('records my expense and my new debt, with no cash movement', () => {
    const l = new TestLedger();
    l.post({ kind: 'someone_paid_for_me', amount: r('450'), personId: AAYUSH, categoryId: FOOD });

    expect(l.owned()).toBe(0);
    expect(l.expenses()).toBe(r('450'));
    expect(l.iOwe()).toBe(r('450'));
    expect(l.net()).toBe(-r('450'));
  });
});

describe('refund', () => {
  it('unwinds spending rather than creating income', () => {
    const l = new TestLedger();
    l.post({ kind: 'opening_balance', amount: r('1000'), to: cash });
    l.post({ kind: 'expense', amount: r('300'), from: cash, categoryId: FOOD });
    l.post({ kind: 'refund', amount: r('300'), to: cash, categoryId: FOOD });

    expect(l.accountBalance(CASH)).toBe(r('1000'));
    expect(l.expenses()).toBe(0);
    expect(l.income()).toBe(0);
  });
});

describe('reversal', () => {
  it('exactly mirrors the original and leaves history intact', () => {
    const l = new TestLedger();
    l.post({ kind: 'opening_balance', amount: r('1000'), to: cash });
    const original = l.post({ kind: 'expense', amount: r('250'), from: cash, categoryId: FOOD });
    expect(l.accountBalance(CASH)).toBe(r('750'));

    l.post({ kind: 'reversal', original, amount: r('250') });

    expect(l.accountBalance(CASH)).toBe(r('1000'));
    expect(l.expenses()).toBe(0);
    // The original entries were never removed.
    expect(l.entries.filter((e) => e.bucket === 'expense')).toHaveLength(2);
  });

  it('reverses a multi-leg split correctly', () => {
    const l = new TestLedger();
    l.post({ kind: 'opening_balance', amount: r('5000'), to: cash });
    const split = l.post({
      kind: 'paid_for_someone',
      amount: r('900'),
      from: cash,
      myShare: r('300'),
      participants: [
        { personId: RAHUL, shareAmount: r('300') },
        { personId: AAYUSH, shareAmount: r('300') },
      ],
    });
    l.post({ kind: 'reversal', original: split, amount: r('900') });

    expect(l.accountBalance(CASH)).toBe(r('5000'));
    expect(l.owedToMe()).toBe(0);
    expect(l.expenses()).toBe(0);
    l.assertBooksBalance();
  });
});

describe('cash adjustment', () => {
  it('books a shortfall against equity, never as an expense', () => {
    const l = new TestLedger();
    l.post({ kind: 'opening_balance', amount: r('4750'), to: cash });
    l.post({ kind: 'adjustment', amount: r('50'), position: cash, direction: 'decrease' });

    expect(l.accountBalance(CASH)).toBe(r('4700'));
    expect(l.expenses()).toBe(0);
    expect(bucketTotal(l.entries, 'equity')).toBe(-r('4700'));
    l.assertBooksBalance();
  });

  it('books a surplus the same way', () => {
    const l = new TestLedger();
    l.post({ kind: 'adjustment', amount: r('25'), position: cash, direction: 'increase' });
    expect(l.accountBalance(CASH)).toBe(r('25'));
    expect(l.income()).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Structural guarantees
 * ------------------------------------------------------------------ */

describe('structural invariants', () => {
  const allIntents: LedgerIntent[] = [
    { kind: 'expense', amount: r('100'), from: cash },
    { kind: 'income', amount: r('100'), to: cash },
    { kind: 'transfer', amount: r('100'), from: cash, to: bank },
    { kind: 'lend', amount: r('100'), personId: RAHUL, from: cash },
    { kind: 'lend', amount: r('100'), personId: RAHUL, from: null },
    { kind: 'borrow', amount: r('100'), personId: RAHUL, to: cash },
    { kind: 'borrow', amount: r('100'), personId: RAHUL, to: null },
    { kind: 'settle_receivable', amount: r('100'), personId: RAHUL, to: cash },
    { kind: 'settle_payable', amount: r('100'), personId: RAHUL, from: cash },
    {
      kind: 'paid_for_someone',
      amount: r('100'),
      from: cash,
      myShare: r('40'),
      participants: [{ personId: RAHUL, shareAmount: r('60') }],
    },
    { kind: 'someone_paid_for_me', amount: r('100'), personId: RAHUL },
    { kind: 'refund', amount: r('100'), to: cash },
    { kind: 'adjustment', amount: r('100'), position: cash, direction: 'increase' },
    { kind: 'opening_balance', amount: r('100'), to: cash },
  ];

  it('every transaction kind balances to zero', () => {
    for (const intent of allIntents) {
      const entries = buildEntries(intent);
      expect(sumPaise(entries.map((e) => e.amount)), intent.kind).toBe(0);
      expect(entries.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('every transaction kind reports a positive headline amount', () => {
    for (const intent of allIntents) {
      const entries = buildEntries(intent);
      expect(headlineAmount(intent.kind, entries), intent.kind).toBe(r('100'));
    }
  });

  it('cash-backed transfers, loans and settlements leave net position untouched', () => {
    const neutral: LedgerIntent[] = [
      { kind: 'transfer', amount: r('100'), from: cash, to: bank },
      { kind: 'lend', amount: r('100'), personId: RAHUL, from: cash },
      { kind: 'borrow', amount: r('100'), personId: RAHUL, to: cash },
      { kind: 'settle_receivable', amount: r('100'), personId: RAHUL, to: cash },
      { kind: 'settle_payable', amount: r('100'), personId: RAHUL, from: cash },
    ];
    for (const intent of neutral) {
      expect(netPosition(buildEntries(intent)), `${intent.kind} must not change net position`).toBe(0);
    }
  });

  it('recording a pre-existing debt does change net position, by design', () => {
    // No cash moved, but a claim I always had is now on the books.
    expect(netPosition(buildEntries({ kind: 'lend', amount: r('100'), personId: RAHUL, from: null }))).toBe(
      r('100'),
    );
    expect(netPosition(buildEntries({ kind: 'borrow', amount: r('100'), personId: RAHUL, to: null }))).toBe(
      -r('100'),
    );
  });

  it('asset entries always carry both an account and an owner', () => {
    for (const intent of allIntents) {
      for (const e of buildEntries(intent)) {
        if (e.bucket === 'asset') {
          expect(e.accountId).toBeTruthy();
          expect(e.poolId).toBeTruthy();
        }
        if (e.bucket === 'receivable' || e.bucket === 'payable') {
          expect(e.personId).toBeTruthy();
        }
        expect(e.amount).not.toBe(0);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * The end-to-end scenario from the spec, recalculated at every step
 * ------------------------------------------------------------------ */

describe('real-world scenario', () => {
  it('stays mathematically accountable at every stage', () => {
    const l = new TestLedger();

    // Starting position
    l.post({ kind: 'opening_balance', amount: r('2000'), to: cash });
    l.post({ kind: 'opening_balance', amount: r('5000'), to: dadCash });
    l.post({ kind: 'opening_balance', amount: r('1000'), to: savings });

    expect(l.poolBalance(PERSONAL)).toBe(r('3000')); // cash 2000 + savings 1000
    expect(l.poolBalance(DAD)).toBe(r('5000'));
    expect(l.owned()).toBe(r('8000'));
    expect(l.net()).toBe(r('8000'));
    l.assertBooksBalance();

    // 1. Dad gives ₹2,000
    l.post({ kind: 'income', amount: r('2000'), to: dadCash });
    expect(l.poolBalance(DAD)).toBe(r('7000'));
    expect(l.owned()).toBe(r('10000'));
    expect(l.net()).toBe(r('10000'));

    // 2. Move ₹1,000 Dad -> Personal. Total controlled money unchanged.
    l.post({ kind: 'transfer', amount: r('1000'), from: dadCash, to: cash });
    expect(l.poolBalance(DAD)).toBe(r('6000'));
    expect(l.poolBalance(PERSONAL)).toBe(r('4000'));
    expect(l.owned()).toBe(r('10000'));
    expect(l.net()).toBe(r('10000'));

    // 3. Spend ₹300 on food
    l.post({ kind: 'expense', amount: r('300'), from: cash, categoryId: FOOD });
    expect(l.positionBalance(cash)).toBe(r('2700')); // 2000 + 1000 - 300
    expect(l.owned()).toBe(r('9700'));
    expect(l.net()).toBe(r('9700'));
    expect(l.expenses()).toBe(r('300'));

    // 4. Pay Rahul ₹500 as a loan. Net position must NOT drop.
    const netBeforeLending = l.net();
    l.post({ kind: 'lend', amount: r('500'), personId: RAHUL, from: cash });
    expect(l.positionBalance(cash)).toBe(r('2200'));
    expect(l.owedToMe()).toBe(r('500'));
    expect(l.personNet(RAHUL)).toBe(r('500'));
    expect(l.net()).toBe(netBeforeLending);
    expect(l.expenses()).toBe(r('300')); // still just the food

    // 5. Rahul returns ₹300
    l.post({ kind: 'settle_receivable', amount: r('300'), personId: RAHUL, to: cash });
    expect(l.positionBalance(cash)).toBe(r('2500'));
    expect(l.personNet(RAHUL)).toBe(r('200'));
    expect(l.owedToMe()).toBe(r('200'));
    expect(l.net()).toBe(netBeforeLending);
    // Getting money back is not income — the only income so far is Dad's ₹2,000.
    expect(l.income()).toBe(r('2000'));

    // 6. Save ₹1,000 Personal -> Savings
    l.post({ kind: 'transfer', amount: r('1000'), from: cash, to: savings });
    expect(l.positionBalance(cash)).toBe(r('1500'));
    expect(l.accountBalance(SAVINGS)).toBe(r('2000'));
    expect(l.poolBalance(PERSONAL)).toBe(r('3500')); // 1500 cash + 2000 savings
    expect(l.owned()).toBe(r('9500'));
    expect(l.expenses()).toBe(r('300'));

    // Final, independently recomputed position
    //   owned  = cash 1500 (personal) + cash 6000 (dad) + savings 2000 = 9500
    //   owed to me = 200, I owe = 0
    expect(l.owned()).toBe(r('9500'));
    expect(l.owedToMe()).toBe(r('200'));
    expect(l.iOwe()).toBe(0);
    expect(l.net()).toBe(r('9700'));
    expect(l.net()).toBe(l.owned() + l.owedToMe() - l.iOwe());

    // And the whole double-entry set still sums to zero.
    l.assertBooksBalance();

    // Cross-check: net position must equal opening equity plus income minus expenses.
    const equity = -bucketTotal(l.entries, 'equity');
    expect(l.net()).toBe(equity + l.income() - l.expenses());
  });
});
