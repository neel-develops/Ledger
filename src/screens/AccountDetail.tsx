import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Archive, Banknote, CreditCard, PiggyBank, Scale, Smartphone, Star, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import type { AccountKind, TransactionView } from '@shared/domain';
import { api, ApiError } from '../lib/api';
import { useLedger } from '../store/ledger';
import { Card, EmptyState, IconBadge, List, Row, SectionLabel, Skeleton } from '../components/ui/primitives';
import { Money } from '../components/ui/Money';
import { TransactionRow } from '../components/TransactionRow';
import { groupByDay } from '../lib/dates';
import { ErrorState } from '../components/ErrorState';
import { CashCheckSheet } from './Reconcile';

const ICONS: Record<AccountKind, React.ReactNode> = {
  cash: <Banknote />,
  bank: <CreditCard />,
  upi: <Smartphone />,
  wallet: <Wallet />,
  savings: <PiggyBank />,
  other: <Wallet />,
};

/**
 * One account: what is in it, split by whose money it is, and everything that
 * ever moved through it.
 */
export function AccountDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { accounts, refresh } = useLedger();
  const version = useLedger((s) => s.version);

  const [items, setItems] = useState<TransactionView[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const account = accounts?.find((a) => a.id === id);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const result = await api.get<{ items: TransactionView[]; nextCursor: string | null }>(
        `/transactions?limit=50&accountId=${id}`,
      );
      setItems(result.items);
      setCursor(result.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not load this account.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, version]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setDefault() {
    if (!id) return;
    try {
      await api.patch(`/accounts/${id}`, { isDefault: true });
      await refresh();
      toast.success(`${account?.name} is now your default account`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'We could not update that account.');
    }
  }

  async function archive() {
    if (!id) return;
    try {
      await api.delete(`/accounts/${id}`);
      await refresh();
      toast.success(`${account?.name} archived`, {
        description: 'Its history is kept. Nothing was deleted.',
      });
      navigate('/accounts');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'We could not archive that account.');
    }
  }

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

  return (
    <div>
      <header className="flex items-center gap-2 px-1 pt-3 pb-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="-ml-2 grid size-10 place-items-center rounded-full text-ink-soft press active:scale-[0.92]"
        >
          <ArrowLeft className="size-5" />
        </button>
        <h1 className="truncate text-[20px] font-semibold tracking-[-0.02em]">{account?.name ?? ' '}</h1>
      </header>

      <Card glass className="px-5 py-5">
        {account ? (
          <>
            <IconBadge tone="neutral" size="lg">
              {ICONS[account.kind]}
            </IconBadge>
            <Money paise={account.balance} size="xl" maskable className="mt-3 block" />
            <p className="mt-1 text-[13.5px] text-ink-soft">
              {account.isDefault ? 'Your default account' : 'Balance, from every entry recorded'}
            </p>
          </>
        ) : (
          <div className="space-y-3">
            <Skeleton className="size-12 rounded-[16px]" />
            <Skeleton className="h-8 w-36" />
          </div>
        )}
      </Card>

      <section className="mt-5">
        <SectionLabel>Manage</SectionLabel>
        <List>
          <Row
            icon={<IconBadge tone="neutral" size="sm"><Scale /></IconBadge>}
            title="Cash check"
            subtitle="Compare against what is actually there"
            onClick={() => setChecking(true)}
            chevron
          />
          {account && !account.isDefault && (
            <Row
              icon={<IconBadge tone="neutral" size="sm"><Star /></IconBadge>}
              title="Make this the default"
              subtitle="New transactions will start here"
              onClick={setDefault}
            />
          )}
          <Row
            icon={<IconBadge tone="neutral" size="sm"><Archive /></IconBadge>}
            title="Archive this account"
            subtitle="Hides it. Its history is kept."
            onClick={archive}
          />
        </List>
      </section>

      <section className="mt-5">
        <SectionLabel>Transactions</SectionLabel>
        {items === null ? (
          <div className="card divide-y divide-line">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <Skeleton className="size-10 rounded-[14px]" />
                <Skeleton className="h-3.5 w-32 flex-1" />
                <Skeleton className="h-4 w-14" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Wallet />}
              title="Nothing here yet"
              description={`Transactions that touch ${account?.name ?? 'this account'} will appear here.`}
            />
          </Card>
        ) : (
          <div className="space-y-5">
            {groupByDay(items).map((group) => (
              <div key={group.label}>
                <SectionLabel>{group.label}</SectionLabel>
                <List>
                  <div className="divide-y divide-line">
                    {group.items.map((tx) => (
                      <TransactionRow key={tx.id} transaction={tx} />
                    ))}
                  </div>
                </List>
              </div>
            ))}
            {cursor && (
              <p className="text-center text-[13px] text-ink-muted">
                Older entries are in Activity, filtered by this account.
              </p>
            )}
          </div>
        )}
      </section>

      <CashCheckSheet
        accountId={checking ? (id ?? null) : null}
        onClose={() => {
          setChecking(false);
          void load();
        }}
      />
    </div>
  );
}
