import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banknote, CreditCard, PiggyBank, Plus, Smartphone, Wallet, Scale } from 'lucide-react';
import { toast } from 'sonner';
import type { AccountKind } from '@shared/domain';
import { ACCOUNT_KINDS } from '@shared/domain';
import { useLedger } from '../store/ledger';
import { ScreenHeader } from '../components/AppShell';
import { Card, EmptyState, Field, IconBadge, List, Row, SectionLabel, Skeleton, TextInput } from '../components/ui/primitives';
import { Button } from '../components/ui/Button';
import { Sheet } from '../components/ui/Sheet';
import { Money } from '../components/ui/Money';
import { ErrorState } from '../components/ErrorState';
import { api, ApiError } from '../lib/api';
import { CashCheckSheet } from './Reconcile';

const ACCOUNT_ICONS: Record<AccountKind, React.ReactNode> = {
  cash: <Banknote />,
  bank: <CreditCard />,
  upi: <Smartphone />,
  wallet: <Wallet />,
  savings: <PiggyBank />,
  other: <Wallet />,
};

export function AccountsScreen() {
  const navigate = useNavigate();
  const { accounts, pools, dashboard, state, error, unavailable, load } = useLedger();
  const [adding, setAdding] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);

  if (state === 'error') {
    return <ErrorState message={error} unavailable={unavailable} onRetry={() => void load()} />;
  }

  const loading = accounts === null;
  const active = (accounts ?? []).filter((a) => !a.archivedAt);

  return (
    <div>
      <ScreenHeader
        title="Accounts"
        action={
          <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
            Add
          </Button>
        }
      />

      <Card glass className="px-5 py-5">
        <p className="text-[14px] text-ink-soft">Total balance</p>
        {loading ? (
          <Skeleton className="mt-1 h-8 w-40" />
        ) : (
          <Money paise={dashboard?.ownedMoney} size="xl" maskable className="mt-0.5" />
        )}
      </Card>

      <section className="mt-5">
        <SectionLabel>Where the money is</SectionLabel>
        {loading ? (
          <div className="card divide-y divide-line">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <Skeleton className="size-10 rounded-[14px]" />
                <Skeleton className="h-3.5 w-24 flex-1" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        ) : active.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Wallet />}
              title="No accounts yet"
              description="Add where your money sits — cash, bank, UPI — and balances build themselves from what you record."
              action={<Button onClick={() => setAdding(true)}>Add account</Button>}
            />
          </Card>
        ) : (
          <List>
            <div className="stagger divide-y divide-line">
              {active.map((account) => (
                <Row
                  key={account.id}
                  icon={<IconBadge tone="neutral">{ACCOUNT_ICONS[account.kind]}</IconBadge>}
                  title={account.name}
                  subtitle={account.isDefault ? 'Default' : undefined}
                  trailing={<Money paise={account.balance} size="md" maskable />}
                  onClick={() => navigate(`/accounts/${account.id}`)}
                  chevron
                />
              ))}
            </div>
          </List>
        )}
      </section>

      {/* Ownership is a separate axis: the same cash can belong to two people. */}
      <section className="mt-5">
        <SectionLabel>Whose money it is</SectionLabel>
        {loading ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : (
          <List>
            {(pools ?? []).map((pool) => {
              const balance = dashboard?.byPool.find((p) => p.id === pool.id)?.balance;
              return (
                <Row
                  key={pool.id}
                  icon={<IconBadge tone={pool.kind === 'dad' ? 'accent' : 'neutral'}><Wallet /></IconBadge>}
                  title={pool.name}
                  trailing={<Money paise={balance} size="md" maskable />}
                />
              );
            })}
          </List>
        )}
      </section>

      <section className="mt-5">
        <SectionLabel>Check</SectionLabel>
        <List>
          <Row
            icon={<IconBadge tone="neutral"><Scale /></IconBadge>}
            title="Cash check"
            subtitle="Compare the ledger against what is actually in your pocket"
            onClick={() => setChecking(active.find((a) => a.kind === 'cash')?.id ?? active[0]?.id ?? null)}
            chevron
          />
        </List>
      </section>

      <AddAccountSheet open={adding} onClose={() => setAdding(false)} />
      <CashCheckSheet accountId={checking} onClose={() => setChecking(null)} />
    </div>
  );
}

const KIND_LABELS: Record<AccountKind, string> = {
  cash: 'Cash',
  bank: 'Bank',
  upi: 'UPI',
  wallet: 'Wallet',
  savings: 'Savings',
  other: 'Other',
};

function AddAccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const refresh = useLedger((s) => s.refresh);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('bank');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.post('/accounts', { name: name.trim(), kind });
      await refresh();
      toast.success(`${name.trim()} added`);
      setName('');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not add that account.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add an account">
      <div className="space-y-4 pb-2">
        <Field label="Name">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="HDFC, Paytm, Pocket cash…"
            autoFocus
            autoComplete="off"
          />
        </Field>

        <Field label="Type" hint="Savings is kept out of your spendable total.">
          <div className="grid grid-cols-3 gap-2">
            {ACCOUNT_KINDS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setKind(option)}
                className={`flex h-[52px] flex-col items-center justify-center gap-1 rounded-md border text-[13px] font-medium transition-[transform,background-color,border-color] duration-[140ms] ease-out-strong active:scale-[0.96] ${
                  kind === option
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-line-strong bg-surface text-ink-soft'
                }`}
              >
                <span className="[&>svg]:size-4">{ACCOUNT_ICONS[option]}</span>
                {KIND_LABELS[option]}
              </button>
            ))}
          </div>
        </Field>

        {error && <p className="text-[13px] text-negative">{error}</p>}

        <Button block size="lg" onClick={save} loading={saving} disabled={!name.trim()}>
          Add account
        </Button>
      </div>
    </Sheet>
  );
}
