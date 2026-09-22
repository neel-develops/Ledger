import { create } from 'zustand';
import { api, ApiError, newIdempotencyKey } from '../lib/api';
import { enqueue, flushOutbox } from '../lib/outbox';
import { syncWidget } from '../lib/native';
import type { CreateTransactionPayload } from '../lib/types';
import { usePrefs } from './prefs';
import type {
  DashboardView,
  AccountView,
  PoolView,
  PersonView,
  CategoryView,
  TransactionView,
} from '@shared/domain';

/**
 * The client's view of the ledger.
 *
 * Nothing in this store has a default value that looks like money. Before the
 * first successful load every figure is `null`, and the UI renders "—" for a
 * null. A zero is only ever shown when the server actually said zero.
 */

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

interface LedgerState {
  state: LoadState;
  error: string | null;
  /** True when the server is reachable but has no ledger configured. */
  unavailable: boolean;

  dashboard: DashboardView | null;
  accounts: AccountView[] | null;
  pools: PoolView[] | null;
  people: PersonView[] | null;
  categories: CategoryView[] | null;

  /** Writes that are waiting for the network. */
  pendingCount: number;

  /**
   * Bumped after every committed write. Screens that fetch their own data
   * (Activity, a person's ledger, Insights) watch this so recording a
   * transaction never leaves a stale list on screen.
   */
  version: number;

  load: (options?: { quiet?: boolean }) => Promise<void>;
  refresh: () => Promise<void>;
  addTransaction: (payload: CreateTransactionPayload) => Promise<AddResult>;
  reverseTransaction: (id: string) => Promise<void>;
  addPerson: (name: string, relation?: string | null) => Promise<PersonView>;
  setPendingCount: (count: number) => void;
}

export interface AddResult {
  status: 'saved' | 'queued';
  transaction: TransactionView | null;
}

/** Read without subscribing: this runs inside an action, not a render. */
function readBalancesHidden(): boolean {
  return usePrefs.getState().balancesHidden;
}

export const useLedger = create<LedgerState>((set, get) => ({
  state: 'idle',
  error: null,
  unavailable: false,

  dashboard: null,
  accounts: null,
  pools: null,
  people: null,
  categories: null,
  pendingCount: 0,
  version: 0,

  async load(options) {
    if (!options?.quiet) set({ state: 'loading', error: null });

    try {
      const [dashboard, people, categories, pools] = await Promise.all([
        api.get<DashboardView>('/dashboard'),
        api.get<PersonView[]>('/people'),
        api.get<CategoryView[]>('/categories'),
        api.get<PoolView[]>('/pools'),
      ]);

      set({
        state: 'ready',
        error: null,
        unavailable: false,
        dashboard,
        accounts: dashboard.accounts,
        pools,
        people,
        categories,
      });

      // The home-screen widget shows whatever the app last knew, so it is
      // refreshed on every successful load rather than on a timer of its own.
      void syncWidget(dashboard, readBalancesHidden());
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      // An unauthenticated load is not an error state — the router shows
      // the sign-in screen instead.
      if (apiError?.isUnauthorized) {
        set({ state: 'idle', error: null });
        return;
      }
      set({
        state: 'error',
        unavailable:
          apiError?.code === 'database_unavailable' || apiError?.code === 'not_configured',
        error: apiError?.message ?? 'We could not load your ledger.',
      });
    }
  },

  async refresh() {
    await get().load({ quiet: true });
  },

  /**
   * Save a transaction. The idempotency key is minted here, once, so the
   * same logical write can be retried or replayed without ever landing twice.
   */
  async addTransaction(payload) {
    const withKey: CreateTransactionPayload = {
      ...payload,
      idempotencyKey: payload.idempotencyKey ?? newIdempotencyKey(),
    };

    try {
      const result = await api.post<{ transaction: TransactionView }>('/transactions', withKey);
      set({ version: get().version + 1 });
      await get().refresh();
      return { status: 'saved', transaction: result.transaction };
    } catch (error) {
      if (error instanceof ApiError && error.isOffline) {
        await enqueue(withKey);
        const outbox = await flushOutbox().catch(() => null);
        set({ pendingCount: outbox?.remaining ?? get().pendingCount + 1, version: get().version + 1 });
        return { status: 'queued', transaction: null };
      }
      throw error;
    }
  },

  async reverseTransaction(id) {
    await api.post(`/transactions/${id}/reverse`, { idempotencyKey: newIdempotencyKey() });
    set({ version: get().version + 1 });
    await get().refresh();
  },

  async addPerson(name, relation) {
    const person = await api.post<{ id: string; name: string }>('/people', {
      name,
      relation: relation ?? null,
    });
    set({ version: get().version + 1 });
    await get().refresh();
    const created = get().people?.find((p) => p.id === person.id);
    return (
      created ?? { id: person.id, name: person.name, netBalance: 0, receivable: 0, payable: 0, archivedAt: null }
    );
  },

  setPendingCount(count) {
    set({ pendingCount: count });
  },
}));

/** Default account/pool, used so a normal expense needs only an amount. */
export function useDefaults() {
  const accounts = useLedger((s) => s.accounts);
  const pools = useLedger((s) => s.pools);
  return {
    accountId: accounts?.find((a) => a.isDefault)?.id ?? accounts?.[0]?.id ?? null,
    poolId: pools?.find((p) => p.isDefault)?.id ?? pools?.[0]?.id ?? null,
    savingsAccountId: accounts?.find((a) => a.kind === 'savings')?.id ?? null,
  };
}
