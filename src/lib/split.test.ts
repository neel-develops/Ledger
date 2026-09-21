import { describe, it, expect } from 'vitest';
import { computeSplit } from './split';
import { parseRupeesToPaise, sumPaise } from '@shared/money';

const r = (rupees: string | number): number => {
  const p = parseRupeesToPaise(rupees);
  if (p === null) throw new Error(`bad amount: ${rupees}`);
  return p;
};

const row = (personId: string, shareAmount: number | null = null) => ({ personId, shareAmount });

describe('splitting a bill', () => {
  it('divides evenly between me and one other person', () => {
    const { myShare, participants, balanced } = computeSplit(r('1000'), [row('rahul')], null);
    expect(myShare).toBe(r('500'));
    expect(participants).toEqual([{ personId: 'rahul', shareAmount: r('500') }]);
    expect(balanced).toBe(true);
  });

  it('divides evenly between four people', () => {
    const rows = [row('a'), row('b'), row('c')];
    const { myShare, participants } = computeSplit(r('1200'), rows, null);
    expect(myShare).toBe(r('300'));
    expect(participants.map((p) => p.shareAmount)).toEqual([r('300'), r('300'), r('300')]);
  });

  it('loses nothing to rounding on an awkward total', () => {
    // ₹100 three ways does not divide cleanly.
    const { myShare, participants, unassigned } = computeSplit(r('100'), [row('a'), row('b')], null);
    expect(unassigned).toBe(0);
    expect(myShare + sumPaise(participants.map((p) => p.shareAmount))).toBe(r('100'));
    expect(myShare).toBe(3334);
    expect(participants.map((p) => p.shareAmount)).toEqual([3333, 3333]);
  });

  it('honours my own share and re-divides the rest', () => {
    // The spec's case: ₹1,200 bill, my share ₹400, Rahul owes ₹800.
    const { myShare, participants, balanced } = computeSplit(r('1200'), [row('rahul')], r('400'));
    expect(myShare).toBe(r('400'));
    expect(participants[0]?.shareAmount).toBe(r('800'));
    expect(balanced).toBe(true);
  });

  it('spreads the remainder across the people who have no fixed share', () => {
    const rows = [row('a', r('500')), row('b'), row('c')];
    const { participants, unassigned } = computeSplit(r('1100'), rows, r('300'));
    expect(participants[0]?.shareAmount).toBe(r('500'));
    expect(participants[1]?.shareAmount).toBe(r('150'));
    expect(participants[2]?.shareAmount).toBe(r('150'));
    expect(unassigned).toBe(0);
  });

  it('reports a shortfall rather than quietly absorbing it', () => {
    const rows = [row('a', r('100')), row('b', r('100'))];
    const { unassigned, balanced } = computeSplit(r('1000'), rows, r('400'));
    expect(unassigned).toBe(r('400'));
    expect(balanced).toBe(false);
  });

  it('reports an overshoot too', () => {
    const rows = [row('a', r('900'))];
    const { unassigned, balanced } = computeSplit(r('1000'), rows, r('400'));
    expect(unassigned).toBe(-r('300'));
    expect(balanced).toBe(false);
  });

  it('refuses a zero share, which the ledger would reject anyway', () => {
    const { balanced } = computeSplit(r('500'), [row('a', 0)], r('500'));
    expect(balanced).toBe(false);
  });

  it('supports paying entirely for someone else', () => {
    const { myShare, participants, balanced } = computeSplit(r('250'), [row('aayush')], 0);
    expect(myShare).toBe(0);
    expect(participants[0]?.shareAmount).toBe(r('250'));
    expect(balanced).toBe(true);
  });

  it('always reconciles to the exact total, for any even split', () => {
    for (const total of [1, 7, 99, 100, 12345, 999_999]) {
      for (const people of [1, 2, 3, 5, 7]) {
        const rows = Array.from({ length: people }, (_, i) => row(`p${i}`));
        const { myShare, participants } = computeSplit(total, rows, null);
        expect(myShare + sumPaise(participants.map((p) => p.shareAmount)), `${total}/${people}`).toBe(total);
      }
    }
  });
});
