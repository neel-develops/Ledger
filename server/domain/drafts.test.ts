import { describe, it, expect } from 'vitest';
import { convertDraft, DraftError } from './drafts';

/**
 * The assistant's output is untrusted input that proposes to move money. These
 * tests pin down how it is turned into an ordinary transaction payload — and
 * every way it is refused.
 */

const RAHUL = '11111111-1111-4111-8111-111111111111';
const CASH = '22222222-2222-4222-8222-222222222222';
const BANK = '33333333-3333-4333-8333-333333333333';

const context = {
  people: [{ id: RAHUL, name: 'Rahul' }],
  today: '2026-09-23',
  timeZoneOffsetMinutes: 330,
  now: new Date('2026-09-23T10:30:00Z'),
};

describe('converting an assistant draft', () => {
  it('turns rupee text into integer paise', () => {
    const d = convertDraft({ kind: 'expense', amount: '150.50', summary: 'Lunch' }, context);
    expect(d.payload.amount).toBe(15050);
    expect(d.input.kind).toBe('expense');
  });

  it('refuses an amount that is not money', () => {
    expect(() => convertDraft({ kind: 'expense', amount: 'about 200', summary: 'x' }, context)).toThrow(DraftError);
    expect(() => convertDraft({ kind: 'expense', amount: '0', summary: 'x' }, context)).toThrow(/more than zero/);
    expect(() => convertDraft({ kind: 'expense', amount: '1.234', summary: 'x' }, context)).toThrow(DraftError);
  });

  it('uses the current moment for today, and noon local time for another day', () => {
    const today = convertDraft({ kind: 'expense', amount: '10', summary: 'x' }, context);
    expect(today.payload.occurredAt).toBe('2026-09-23T10:30:00.000Z');

    const earlier = convertDraft({ kind: 'expense', amount: '10', summary: 'x', date: '2026-09-20' }, context);
    // 12:00 in India is 06:30 UTC.
    expect(earlier.payload.occurredAt).toBe('2026-09-20T06:30:00.000Z');
  });

  it('refuses a date in the future', () => {
    expect(() =>
      convertDraft({ kind: 'expense', amount: '10', summary: 'x', date: '2026-09-24' }, context),
    ).toThrow(/future/);
  });

  it('resolves a name that already exists to that person instead of a duplicate', () => {
    const d = convertDraft({ kind: 'lend', amount: '500', summary: 'x', newPersonName: 'rahul' }, context);
    expect(d.payload.personId).toBe(RAHUL);
    expect(d.newPeople).toEqual({});
  });

  it('gives a genuinely new person a placeholder, created only on confirm', () => {
    const d = convertDraft({ kind: 'lend', amount: '500', summary: 'x', newPersonName: 'Priya' }, context);
    const placeholder = d.payload.personId as string;
    expect(d.newPeople).toEqual({ [placeholder]: 'Priya' });
  });

  it('treats a lone account on an incoming transaction as where the money lands', () => {
    const d = convertDraft({ kind: 'income', amount: '2000', summary: 'x', accountId: BANK }, context);
    expect(d.payload.toAccountId).toBe(BANK);
    expect(d.payload.accountId).toBeNull();
  });

  it('keeps source and destination apart on a transfer', () => {
    const d = convertDraft(
      { kind: 'transfer', amount: '1000', summary: 'x', accountId: CASH, toAccountId: BANK },
      context,
    );
    expect(d.payload.accountId).toBe(CASH);
    expect(d.payload.toAccountId).toBe(BANK);
  });

  it('splits a bill so that the shares add up to the total exactly', () => {
    const d = convertDraft(
      {
        kind: 'paid_for_someone',
        amount: '1200',
        summary: 'Dinner',
        participants: [{ personId: RAHUL, share: '800' }],
      },
      context,
    );
    expect(d.payload.myShare).toBe(40000);
    expect(d.payload.participants).toEqual([{ personId: RAHUL, shareAmount: 80000 }]);
  });

  it('refuses shares that do not add up, with a reason the model can act on', () => {
    expect(() =>
      convertDraft(
        {
          kind: 'paid_for_someone',
          amount: '1200',
          summary: 'x',
          myShare: '400',
          participants: [{ personId: RAHUL, share: '700' }],
        },
        context,
      ),
    ).toThrow(/do not add up to ₹1,200/);
  });

  it('records an existing debt without cash moving', () => {
    const d = convertDraft(
      { kind: 'lend', amount: '500', summary: 'x', personId: RAHUL, withoutCashMovement: true },
      context,
    );
    expect(d.payload.withoutCashMovement).toBe(true);
  });

  it('refuses kinds the assistant may not create', () => {
    expect(() => convertDraft({ kind: 'reversal', amount: '10', summary: 'x' }, context)).toThrow(DraftError);
    expect(() => convertDraft({ kind: 'adjustment', amount: '10', summary: 'x' }, context)).toThrow(DraftError);
  });

  it('refuses garbage outright', () => {
    for (const junk of [null, 'hello', 42, {}, { kind: 'expense' }]) {
      expect(() => convertDraft(junk, context)).toThrow(DraftError);
    }
  });
});
