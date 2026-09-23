import { describe, it, expect } from 'vitest';
import { savingsWithdrawal } from './savings';

const accounts = [
  { id: 'cash', name: 'Cash', kind: 'cash' },
  { id: 'sav', name: 'Savings', kind: 'savings' },
  { id: 'fd', name: 'FD', kind: 'savings' },
];

describe('savingsWithdrawal', () => {
  it('catches spending straight out of savings', () => {
    expect(savingsWithdrawal({ accountId: 'sav' }, accounts)?.name).toBe('Savings');
  });

  it('catches moving savings into cash', () => {
    expect(savingsWithdrawal({ accountId: 'sav', toAccountId: 'cash' }, accounts)?.id).toBe('sav');
  });

  it('leaves money going into savings alone', () => {
    expect(savingsWithdrawal({ accountId: 'cash', toAccountId: 'sav' }, accounts)).toBeNull();
    expect(savingsWithdrawal({ toAccountId: 'sav' }, accounts)).toBeNull();
  });

  it('leaves reshuffling between savings accounts alone', () => {
    expect(savingsWithdrawal({ accountId: 'sav', toAccountId: 'fd' }, accounts)).toBeNull();
  });

  it('treats an unnamed or unknown source as not savings', () => {
    expect(savingsWithdrawal({ accountId: null }, accounts)).toBeNull();
    expect(savingsWithdrawal({ accountId: 'gone' }, accounts)).toBeNull();
  });
});
