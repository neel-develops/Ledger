import { describe, it, expect } from 'vitest';
import { firstExisting, isSelectable } from './refs';

/**
 * Regression cover for a bug that reached the screen: a remembered account id
 * survived in localStorage after the account it named was gone. The form
 * seeded itself with the dead id, the picker rendered "Cash" because a
 * <select> falls back to its first option, and saving failed with "The source
 * account could not be found" — naming something the user had never chosen.
 */

const ACCOUNTS = [{ id: 'acc-cash' }, { id: 'acc-bank' }, { id: 'acc-savings' }];

describe('resolving remembered references', () => {
  it('prefers an explicit choice over a remembered one', () => {
    expect(firstExisting(ACCOUNTS, 'acc-bank', 'acc-cash')).toBe('acc-bank');
  });

  it('falls through a remembered id that no longer exists', () => {
    // The exact failure: a stale id from a deleted account, then the default.
    expect(firstExisting(ACCOUNTS, null, 'acc-from-deleted-user', 'acc-cash')).toBe('acc-cash');
  });

  it('returns null when nothing survives, so the form asks instead of guessing', () => {
    expect(firstExisting(ACCOUNTS, 'gone', 'also-gone')).toBeNull();
    expect(firstExisting([], 'acc-cash')).toBeNull();
  });

  it('ignores empty candidates', () => {
    expect(firstExisting(ACCOUNTS, null, undefined, '', 'acc-savings')).toBe('acc-savings');
  });

  it('never returns an id that is absent from the list', () => {
    for (const candidate of ['', 'x', 'acc-cash ', 'ACC-CASH']) {
      const result = firstExisting(ACCOUNTS, candidate);
      expect(result === null || ACCOUNTS.some((a) => a.id === result)).toBe(true);
    }
  });

  it('knows when a picker cannot display a value', () => {
    expect(isSelectable(ACCOUNTS, 'acc-cash')).toBe(true);
    expect(isSelectable(ACCOUNTS, 'acc-from-deleted-user')).toBe(false);
    expect(isSelectable(ACCOUNTS, null)).toBe(false);
  });
});
