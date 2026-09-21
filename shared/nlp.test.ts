import { describe, it, expect } from 'vitest';
import { parseTransaction, NLP_EXAMPLES, type ParseContext } from './nlp';

const context: ParseContext = {
  people: [
    { id: 'p-rahul', name: 'Rahul' },
    { id: 'p-aayush', name: 'Aayush' },
    { id: 'p-sahil', name: 'Sahil' },
  ],
  categories: [
    { id: 'c-food', name: 'Food', direction: 'expense' },
    { id: 'c-travel', name: 'Travel', direction: 'expense' },
    { id: 'c-salary', name: 'Salary', direction: 'income' },
  ],
  accounts: [
    { id: 'a-cash', name: 'Cash' },
    { id: 'a-bank', name: 'Bank' },
    { id: 'a-savings', name: 'Savings' },
  ],
  pools: [
    { id: 'pool-personal', name: 'Personal', kind: 'personal' },
    { id: 'pool-dad', name: 'Dad', kind: 'dad' },
  ],
};

const parse = (text: string) => parseTransaction(text, context);

describe('natural language entry', () => {
  it('reads an expense with a category', () => {
    const draft = parse('spent 150 on food');
    expect(draft?.kind).toBe('expense');
    expect(draft?.amount).toBe(15000);
    expect(draft?.categoryId).toBe('c-food');
    expect(draft?.missing).toEqual([]);
  });

  it('reads money arriving into a pool', () => {
    const draft = parse('dad gave me 2000');
    expect(draft?.kind).toBe('income');
    expect(draft?.amount).toBe(200000);
    expect(draft?.toPoolId).toBe('pool-dad');
  });

  it('reads lending', () => {
    const draft = parse('gave Rahul 500');
    expect(draft?.kind).toBe('lend');
    expect(draft?.amount).toBe(50000);
    expect(draft?.personId).toBe('p-rahul');
  });

  it('reads a debt owed to me', () => {
    const draft = parse('Rahul owes me 300');
    expect(draft?.kind).toBe('lend');
    expect(draft?.personId).toBe('p-rahul');
    expect(draft?.amount).toBe(30000);
  });

  it('reads paying on behalf of someone', () => {
    const draft = parse('paid 250 for Aayush');
    expect(draft?.kind).toBe('paid_for_someone');
    expect(draft?.personId).toBe('p-aayush');
    expect(draft?.amount).toBe(25000);
  });

  it('reads borrowing', () => {
    const draft = parse('borrowed 1000 from Sahil');
    expect(draft?.kind).toBe('borrow');
    expect(draft?.personId).toBe('p-sahil');
    expect(draft?.amount).toBe(100000);
  });

  it('reads a pool-to-pool move', () => {
    const draft = parse('moved 500 from dad to personal');
    expect(draft?.kind).toBe('transfer');
    expect(draft?.poolId).toBe('pool-dad');
    expect(draft?.toPoolId).toBe('pool-personal');
    expect(draft?.amount).toBe(50000);
  });

  it('reads saving', () => {
    const draft = parse('saved 1000');
    expect(draft?.kind).toBe('transfer');
    expect(draft?.toAccountId).toBe('a-savings');
    expect(draft?.amount).toBe(100000);
  });

  it('reads a repayment coming back to me', () => {
    const draft = parse('Rahul returned 300');
    expect(draft?.kind).toBe('settle_receivable');
    expect(draft?.personId).toBe('p-rahul');
  });

  it('handles every documented example without throwing', () => {
    for (const example of NLP_EXAMPLES) {
      const draft = parse(example);
      expect(draft, example).not.toBeNull();
      expect(draft?.amount, example).toBeGreaterThan(0);
    }
  });

  it('flags an unknown person instead of silently inventing one', () => {
    const draft = parse('gave Priya 500');
    expect(draft?.kind).toBe('lend');
    expect(draft?.personId).toBeNull();
    expect(draft?.unknownPersonName).toBe('Priya');
    expect(draft?.confidence).toBe('low');
    expect(draft?.missing.join(' ')).toContain('Priya');
  });

  it('reads "X gave me N" as a repayment when X already owes me', () => {
    const owed: ParseContext = {
      ...context,
      people: [{ id: 'p-rahul', name: 'Rahul', netBalance: 50000 }],
    };
    expect(parseTransaction('Rahul gave me 500', owed)?.kind).toBe('settle_receivable');
    // ...and as plain income when nothing is outstanding.
    expect(parse('Rahul gave me 500')?.kind).toBe('income');
  });

  it('marks a bare number as low confidence rather than guessing', () => {
    const draft = parse('250');
    expect(draft?.kind).toBe('expense');
    expect(draft?.amount).toBe(25000);
    expect(draft?.confidence).toBe('low');
  });

  it('returns null for text that is not a transaction', () => {
    expect(parse('hello there')).toBeNull();
    expect(parse('')).toBeNull();
    expect(parse('   ')).toBeNull();
  });

  it('never returns a zero or negative amount', () => {
    expect(parse('spent 0 on food')).toBeNull();
    const draft = parse('spent 0.01 on food');
    expect(draft?.amount).toBe(1);
  });

  it('handles rupee symbols and separators', () => {
    expect(parse('spent ₹1,250.50 on travel')?.amount).toBe(125050);
  });
});
