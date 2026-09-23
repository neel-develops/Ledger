import { create } from 'zustand';
import type { TransactionKind } from '@shared/domain';

/**
 * What Chillar does when something is recorded.
 *
 * One scene per kind of money movement, so the animation says what just
 * happened before you read a word:
 *   rain     money came in            — coins pour down, Chillar drops in grinning
 *   flyaway  money went out           — Chillar flies off with the coins, waving
 *   toss     you lent it              — coins arc away; it will come back
 *   owe      you now owe someone      — coins arrive, Chillar sweats
 *   cleared  a debt was settled       — confetti
 *   saved    moved into savings       — coins hop into the piggy bank
 *   hop      moved between accounts   — coins hop across
 */

export type Scene = 'rain' | 'flyaway' | 'toss' | 'owe' | 'cleared' | 'saved' | 'hop';

export interface Celebration {
  id: number;
  scene: Scene;
  amount: number;
  /** For "cleared": which way the debt went. */
  direction?: 'in' | 'out';
}

export function sceneFor(kind: TransactionKind, intoSavings: boolean): Pick<Celebration, 'scene' | 'direction'> | null {
  switch (kind) {
    case 'income':
    case 'refund':
    case 'opening_balance':
      return { scene: 'rain' };
    case 'expense':
    case 'paid_for_someone':
      return { scene: 'flyaway' };
    case 'lend':
      return { scene: 'toss' };
    case 'borrow':
    case 'someone_paid_for_me':
      return { scene: 'owe' };
    case 'settle_receivable':
      return { scene: 'cleared', direction: 'in' };
    case 'settle_payable':
      return { scene: 'cleared', direction: 'out' };
    case 'transfer':
      return { scene: intoSavings ? 'saved' : 'hop' };
    default:
      // Reversals and corrections are housekeeping, not moments.
      return null;
  }
}

let nextId = 1;

export const useCelebration = create<{
  current: Celebration | null;
  fire: (celebration: Omit<Celebration, 'id'>) => void;
  clear: (id: number) => void;
}>((set) => ({
  current: null,
  fire: (celebration) => set({ current: { ...celebration, id: nextId++ } }),
  // Only clear the one that finished; a newer one may already be playing.
  clear: (id) => set((s) => (s.current?.id === id ? { current: null } : s)),
}));
