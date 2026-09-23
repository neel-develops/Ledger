import { describe, it, expect } from 'vitest';
import { sceneFor } from './celebrate';

describe('sceneFor', () => {
  it('rains for money in and flies away for money out', () => {
    expect(sceneFor('income', false)?.scene).toBe('rain');
    expect(sceneFor('refund', false)?.scene).toBe('rain');
    expect(sceneFor('expense', false)?.scene).toBe('flyaway');
    expect(sceneFor('paid_for_someone', false)?.scene).toBe('flyaway');
  });

  it('tells lending apart from owing', () => {
    expect(sceneFor('lend', false)?.scene).toBe('toss');
    expect(sceneFor('borrow', false)?.scene).toBe('owe');
    expect(sceneFor('someone_paid_for_me', false)?.scene).toBe('owe');
  });

  it('celebrates a cleared debt in either direction', () => {
    expect(sceneFor('settle_receivable', false)).toEqual({ scene: 'cleared', direction: 'in' });
    expect(sceneFor('settle_payable', false)).toEqual({ scene: 'cleared', direction: 'out' });
  });

  it('saves into savings, hops everywhere else', () => {
    expect(sceneFor('transfer', true)?.scene).toBe('saved');
    expect(sceneFor('transfer', false)?.scene).toBe('hop');
  });

  it('stays quiet for housekeeping', () => {
    expect(sceneFor('reversal', false)).toBeNull();
    expect(sceneFor('adjustment', false)).toBeNull();
  });
});
