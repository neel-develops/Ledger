import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TransactionKind } from '@shared/domain';
import type { ThemePreference } from '../lib/theme';

/**
 * What the app remembers so you barely have to type.
 *
 * Only choices are remembered — never amounts. The app will happily default
 * your category and account to what you always pick, but it will never
 * pre-fill a number you did not enter.
 */

interface Recents {
  accountByKind: Partial<Record<TransactionKind, string>>;
  poolByKind: Partial<Record<TransactionKind, string>>;
  categoryByKind: Partial<Record<TransactionKind, string>>;
  peopleIds: string[];
  kinds: TransactionKind[];
}

interface PrefsState extends Recents {
  /**
   * Who these memories belong to. Remembered ids are meaningless to anyone
   * else, so signing in as a different person wipes them rather than handing
   * over account ids that do not exist in their ledger.
   */
  ownerId: string | null;
  bindUser: (userId: string) => void;

  /** Light, dark, or whatever the phone is doing. */
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;

  /** Hide balances at a glance, for use in public. */
  balancesHidden: boolean;
  toggleBalances: () => void;

  /** Chillar's animation when something is recorded. */
  celebrations: boolean;
  toggleCelebrations: () => void;

  /** Daily nudge to record anything you forgot. Android only. */
  reminderEnabled: boolean;
  reminderTime: string;
  setReminder: (enabled: boolean, time?: string) => void;
  remember: (input: {
    kind: TransactionKind;
    accountId?: string | null;
    poolId?: string | null;
    categoryId?: string | null;
    personIds?: string[];
  }) => void;
  /** Most-used kinds first, so the action sheet reorders itself around you. */
  rankKinds: (kinds: readonly TransactionKind[]) => TransactionKind[];
}

const MAX_RECENT_PEOPLE = 8;
const MAX_RECENT_KINDS = 40;

export const usePrefs = create<PrefsState>()(
  persist(
    (set, get) => ({
      accountByKind: {},
      poolByKind: {},
      categoryByKind: {},
      peopleIds: [],
      kinds: [],
      ownerId: null,
      theme: 'system' as ThemePreference,
      balancesHidden: false,
      celebrations: true,
      reminderEnabled: false,
      reminderTime: '21:00',

      bindUser: (userId) =>
        set((s) =>
          s.ownerId === userId
            ? {}
            : {
                ownerId: userId,
                accountByKind: {},
                poolByKind: {},
                categoryByKind: {},
                peopleIds: [],
                kinds: [],
              },
        ),

      setTheme: (theme) => set({ theme }),

      toggleBalances: () => set((s) => ({ balancesHidden: !s.balancesHidden })),

      toggleCelebrations: () => set((s) => ({ celebrations: !s.celebrations })),

      setReminder: (enabled, time) =>
        set((s) => ({ reminderEnabled: enabled, reminderTime: time ?? s.reminderTime })),

      remember: ({ kind, accountId, poolId, categoryId, personIds }) =>
        set((s) => ({
          accountByKind: accountId ? { ...s.accountByKind, [kind]: accountId } : s.accountByKind,
          poolByKind: poolId ? { ...s.poolByKind, [kind]: poolId } : s.poolByKind,
          categoryByKind: categoryId ? { ...s.categoryByKind, [kind]: categoryId } : s.categoryByKind,
          peopleIds: personIds?.length
            ? [...new Set([...personIds, ...s.peopleIds])].slice(0, MAX_RECENT_PEOPLE)
            : s.peopleIds,
          kinds: [kind, ...s.kinds].slice(0, MAX_RECENT_KINDS),
        })),

      rankKinds: (kinds) => {
        const history = get().kinds;
        const frequency = new Map<TransactionKind, number>();
        for (const k of history) frequency.set(k, (frequency.get(k) ?? 0) + 1);
        // Stable: ties keep the designed order rather than shuffling.
        return [...kinds].sort((a, b) => (frequency.get(b) ?? 0) - (frequency.get(a) ?? 0));
      },
    }),
    { name: 'ledger.prefs.v1' },
  ),
);
