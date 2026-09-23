import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Layers, ListTree, Search } from 'lucide-react';
import { formatPaise } from '@shared/money';
import type { TransactionView } from '@shared/domain';
import { api, ApiError } from '../lib/api';
import { useLedger } from '../store/ledger';
import { ScreenHeader } from '../components/AppShell';
import { Card, EmptyState, List, SectionLabel, Skeleton, TextInput } from '../components/ui/primitives';
import { Mascot } from '../components/Mascot';
import { KIND_META } from '../lib/kinds';
import { usePrefs } from '../store/prefs';
import { cn } from '../lib/cn';
import { Button } from '../components/ui/Button';
import { TransactionRow } from '../components/TransactionRow';
import { groupByDay } from '../lib/dates';
import { ErrorState } from '../components/ErrorState';

type Filter = 'all' | 'expense' | 'income' | 'transfer';

const FILTER_KINDS: Record<Filter, string | undefined> = {
  all: undefined,
  expense: 'expense,paid_for_someone,someone_paid_for_me',
  income: 'income,refund,settle_receivable',
  transfer: 'transfer,lend,borrow,settle_payable',
};

const FILTERS: { value: Filter; label: string; hue: string; icon: React.ReactNode }[] = [
  { value: 'all', label: 'All', hue: '#8583f0', icon: <Layers /> },
  { value: 'expense', label: 'Spent', hue: '#ff5d73', icon: <ArrowUpRight /> },
  { value: 'income', label: 'Received', hue: '#34d399', icon: <ArrowDownLeft /> },
  { value: 'transfer', label: 'Moved', hue: '#5b8cff', icon: <ArrowLeftRight /> },
];

/** Money in minus money out for a day. Transfers and reversed entries count for nothing. */
function dayNet(items: TransactionView[]): number {
  return items.reduce((sum, t) => {
    if (t.reversedByTransactionId || t.kind === 'reversal') return sum;
    const direction = KIND_META[t.kind].direction;
    return direction === 'in' ? sum + t.amount : direction === 'out' ? sum - t.amount : sum;
  }, 0);
}

export function ActivityScreen() {
  const hidden = usePrefs((s) => s.balancesHidden);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<TransactionView[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  // Re-runs whenever a transaction is committed anywhere in the app.
  const version = useLedger((s) => s.version);

  // Search waits for a pause in typing; a request per keystroke would make
  // the list flicker and the app feel busy.
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: '40' });
    const kinds = FILTER_KINDS[filter];
    if (kinds) params.set('kind', kinds);
    if (debounced) params.set('search', debounced);
    return params;
  }, [filter, debounced]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setItems(null);
    setError(null);
    try {
      const result = await api.get<{ items: TransactionView[]; nextCursor: string | null }>(
        `/transactions?${query.toString()}`,
      );
      if (id !== requestId.current) return;
      setItems(result.items);
      setCursor(result.nextCursor);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof ApiError ? err.message : 'We could not load your activity.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, version]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams(query);
      params.set('cursor', cursor);
      const result = await api.get<{ items: TransactionView[]; nextCursor: string | null }>(
        `/transactions?${params.toString()}`,
      );
      setItems((prev) => [...(prev ?? []), ...result.items]);
      setCursor(result.nextCursor);
    } catch {
      setError('We could not load any more. Your earlier entries are unaffected.');
    } finally {
      setLoadingMore(false);
    }
  }

  const groups = useMemo(() => groupByDay(items ?? []), [items]);

  if (error && !items) {
    return <ErrorState message={error} onRetry={() => void load()} />;
  }

  return (
    <div>
      <ScreenHeader
        title="Activity"
        subtitle="Every rupee, newest first"
        action={<Mascot size={50} mood={items === null ? 'thinking' : 'idle'} className="-mt-1" />}
      />

      <div className="sticky top-0 z-20 -mx-4 space-y-2.5 bg-gradient-to-b from-canvas via-canvas to-transparent px-4 pb-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
            aria-hidden
          />
          <TextInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search transactions"
            className="pl-10"
            type="search"
            enterKeyHint="search"
          />
        </div>
        <div role="radiogroup" aria-label="Show" className="grid grid-cols-4 gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={filter === f.value}
              onClick={() => setFilter(f.value)}
              style={{ '--tone': f.hue } as React.CSSProperties}
              className={cn('filter-chip flex items-center justify-center gap-1.5 rounded-full py-2 text-[13px] font-semibold', filter === f.value && 'is-on')}
            >
              <span className="[&>svg]:size-[15px]">{f.icon}</span>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {items === null ? (
        <div className="card mt-2 divide-y divide-line">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5">
              <Skeleton className="size-10 rounded-[14px]" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-4 w-14" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card className="mt-2">
          <EmptyState
            icon={<ListTree />}
            title={debounced ? 'Nothing matched' : 'No transactions yet'}
            description={
              debounced
                ? `We could not find anything for “${debounced}”.`
                : 'Your financial history will appear here, newest first.'
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {groups.map((group, index) => {
            // The last day on screen may continue on the next page; its total would be partial.
            const partial = Boolean(cursor) && index === groups.length - 1;
            const net = dayNet(group.items);
            return (
            <section key={group.label}>
              <div className="flex items-baseline justify-between">
                <SectionLabel className="day-label">{group.label}</SectionLabel>
                {!partial && net !== 0 && (
                  <span
                    className={cn(
                      'tnum px-1 pb-2 text-[13px] font-semibold',
                      net > 0 ? 'glow-positive text-positive' : 'text-ink-soft',
                    )}
                  >
                    {hidden ? '••••' : `${net > 0 ? '+' : '−'}${formatPaise(Math.abs(net))}`}
                  </span>
                )}
              </div>
              <List>
                <div className="stagger divide-y divide-line">
                  {group.items.map((tx) => (
                    <TransactionRow key={tx.id} transaction={tx} />
                  ))}
                </div>
              </List>
            </section>
            );
          })}

          {cursor && (
            <Button variant="secondary" block onClick={loadMore} loading={loadingMore}>
              Load older
            </Button>
          )}

          {error && <p className="px-1 text-center text-[13px] text-negative">{error}</p>}
        </div>
      )}
    </div>
  );
}

