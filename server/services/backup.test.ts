import { describe, it, expect } from 'vitest';
import { validateBackup, toCsv, BACKUP_FORMAT_VERSION, type BackupPayload } from './backup';
import { AppError } from '../http/errors';

/**
 * A backup file is untrusted input that claims to be financial history. These
 * tests exist because importing a file that does not balance would put the
 * ledger into a state the app can never explain.
 */

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const POOL = '22222222-2222-4222-8222-222222222222';
const PERSON = '33333333-3333-4333-8333-333333333333';
const CATEGORY = '44444444-4444-4444-8444-444444444444';
const TX = '55555555-5555-4555-8555-555555555555';
const E1 = '66666666-6666-4666-8666-666666666666';
const E2 = '77777777-7777-4777-8777-777777777777';

function makeBackup(overrides: Partial<BackupPayload> = {}): unknown {
  const base: BackupPayload = {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: '2026-09-21T00:00:00.000Z',
    currency: 'INR',
    amountUnit: 'paise',
    accounts: [{ id: ACCOUNT, name: 'Cash', kind: 'cash', isDefault: true }],
    pools: [{ id: POOL, name: 'My money', kind: 'personal', isDefault: true }],
    people: [{ id: PERSON, name: 'Rahul', relation: null, note: null }],
    categories: [{ id: CATEGORY, name: 'Food', icon: null, direction: 'expense' }],
    transactions: [
      {
        id: TX,
        kind: 'expense',
        amount: 15000,
        occurredAt: '2026-09-21T10:00:00.000Z',
        note: 'Lunch',
        reversesTransactionId: null,
        reversedByTransactionId: null,
      },
    ],
    entries: [
      {
        id: E1,
        transactionId: TX,
        bucket: 'asset',
        amount: -15000,
        accountId: ACCOUNT,
        poolId: POOL,
        personId: null,
        categoryId: null,
        memo: null,
        occurredAt: '2026-09-21T10:00:00.000Z',
      },
      {
        id: E2,
        transactionId: TX,
        bucket: 'expense',
        amount: 15000,
        accountId: null,
        poolId: null,
        personId: null,
        categoryId: CATEGORY,
        memo: null,
        occurredAt: '2026-09-21T10:00:00.000Z',
      },
    ],
    participants: [],
  };
  return { ...base, ...overrides };
}

describe('backup validation', () => {
  it('accepts a consistent backup and reports exactly what is in it', () => {
    const { preview } = validateBackup(makeBackup());
    expect(preview.valid).toBe(true);
    expect(preview.problems).toEqual([]);
    expect(preview.counts).toEqual({
      transactions: 1,
      entries: 2,
      accounts: 1,
      people: 1,
      categories: 1,
    });
  });

  it('rejects a backup whose transaction does not balance', () => {
    const backup = makeBackup() as BackupPayload;
    backup.entries[1]!.amount = 14000; // ₹10 short
    const { preview } = validateBackup(backup);
    expect(preview.valid).toBe(false);
    expect(preview.problems.join(' ')).toMatch(/does not balance/);
  });

  it('rejects an entry pointing at a transaction that is not in the file', () => {
    const backup = makeBackup() as BackupPayload;
    backup.entries[0]!.transactionId = '99999999-9999-4999-8999-999999999999';
    const { preview } = validateBackup(backup);
    expect(preview.valid).toBe(false);
    expect(preview.problems.join(' ')).toMatch(/missing transaction/);
  });

  it('rejects an entry pointing at an account that is not in the file', () => {
    const backup = makeBackup() as BackupPayload;
    backup.entries[0]!.accountId = '99999999-9999-4999-8999-999999999999';
    const { preview } = validateBackup(backup);
    expect(preview.valid).toBe(false);
    expect(preview.problems.join(' ')).toMatch(/missing account/);
  });

  it('refuses a file of the wrong shape rather than guessing', () => {
    expect(() => validateBackup({ hello: 'world' })).toThrow(AppError);
    expect(() => validateBackup(null)).toThrow(AppError);
    expect(() => validateBackup(makeBackup({ formatVersion: 99 } as never))).toThrow(AppError);
  });

  it('refuses amounts that are not integer paise', () => {
    const backup = makeBackup() as BackupPayload;
    backup.entries[0]!.amount = -150.5;
    expect(() => validateBackup(backup)).toThrow(AppError);
  });

  it('refuses a zero-amount entry', () => {
    const backup = makeBackup() as BackupPayload;
    backup.entries[0]!.amount = 0;
    expect(() => validateBackup(backup)).toThrow(AppError);
  });
});

describe('csv export', () => {
  it('writes one row per ledger entry, with both paise and rupees', () => {
    const csv = toCsv(makeBackup() as BackupPayload);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3); // header + 2 entries
    expect(lines[0]).toContain('amount_paise');
    expect(lines[1]).toContain('"-15000"');
    expect(lines[1]).toContain('"-150.00"');
    expect(lines[1]).toContain('"Cash"');
  });

  it('neutralises formulas so a spreadsheet cannot execute a note', () => {
    const backup = makeBackup() as BackupPayload;
    backup.transactions[0]!.note = '=1+1';
    const csv = toCsv(backup);
    expect(csv).toContain(`"'=1+1"`);
    expect(csv).not.toMatch(/,"=1\+1"/);
  });

  it('escapes quotes rather than breaking the row', () => {
    const backup = makeBackup() as BackupPayload;
    backup.transactions[0]!.note = 'He said "hi"';
    expect(toCsv(backup)).toContain('"He said ""hi"""');
  });
});
