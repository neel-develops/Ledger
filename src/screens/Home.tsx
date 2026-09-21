import { Link, useNavigate } from 'react-router-dom';
import {
  Banknote,
  CreditCard,
  Eye,
  EyeOff,
  PiggyBank,
  UserRoundPlus,
  UserRoundMinus,
  Wallet,
  Sparkles,
} from 'lucide-react';
import { useLedger } from '../store/ledger';
import { usePrefs } from '../store/prefs';
import { useSession } from '../lib/auth-client';
import { Money } from '../components/ui/Money';
import { Card, EmptyState, IconBadge, List, Row, SectionLabel, Skeleton } from '../components/ui/primitives';
import { TransactionRow } from '../components/TransactionRow';
import { ErrorState } from '../components/ErrorState';
import { cn } from '../lib/cn';

export function HomeScreen() {
  const navigate = useNavigate();
  const { state, dashboard, error, unavailable, load } = useLedger();
  const { data: session } = useSession();
  const hidden = usePrefs((s) => s.balancesHidden);
  const toggleBalances = usePrefs((s) => s.toggleBalances);

  if (state === 'error') {
    return <ErrorState message={error} unavailable={unavailable} onRetry={() => void load()} />;
  }

  // Only ever skeleton when there is genuinely nothing to show. A background
  // refresh must not blank out figures the user is already reading.
  const loading = dashboard === null;
  const firstName = session?.user?.name?.split(' ')[0];

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between px-1 pt-4 pb-1">
        <div>
          <p className="text-[14px] text-ink-muted">{greeting()}</p>
          <p className="text-[22px] font-semibold tracking-[-0.025em] text-ink">
            {firstName ?? 'Welcome'}
          </p>
        </div>
        <p className="text-[13px] text-ink-faint">{today()}</p>
      </header>

      {/* The one number that matters, on the one glass surface that matters. */}
      <Card glass className="overflow-hidden px-5 py-5">
        <div className="flex items-start justify-between">
          <span className="text-[14px] text-ink-soft">Total money</span>
          <button
            type="button"
            onClick={toggleBalances}
            aria-label={hidden ? 'Show balances' : 'Hide balances'}
            className="-m-2 grid size-9 place-items-center rounded-full text-ink-muted press active:scale-[0.92]"
          >
            {hidden ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
          </button>
        </div>

        <div className="mt-1">
          {loading ? (
            <Skeleton className="h-[44px] w-48" />
          ) : (
            <Money paise={dashboard?.ownedMoney} size="display" maskable />
          )}
        </div>

        <p className="mt-1.5 text-[13px] text-ink-muted">
          {loading
            ? ' '
            : dashboard?.hasAnyData
              ? 'Cash, bank and savings combined'
              : 'No money recorded yet'}
        </p>

        {dashboard && dashboard.hasAnyData && (
          <div className="mt-4 flex items-center justify-between border-t border-[color-mix(in_srgb,white_60%,transparent)] pt-3.5">
            <div>
              <p className="text-[12px] text-ink-muted">Net position</p>
              <Money paise={dashboard.netPosition} size="lg" maskable className="mt-0.5" />
            </div>
            <p className="max-w-[16ch] text-right text-[11.5px] leading-snug text-ink-faint">
              What you hold, plus what is owed to you, minus what you owe
            </p>
          </div>
        )}
      </Card>

      {/* Where the money is */}
      <div className="grid grid-cols-2 gap-3">
        <BalanceTile
          icon={<Banknote />}
          label="Cash"
          value={dashboard?.byLocation.cash}
          loading={loading}
          to="/accounts"
        />
        <BalanceTile
          icon={<CreditCard />}
          label="Digital"
          value={dashboard?.byLocation.digital}
          loading={loading}
          to="/accounts"
        />
        <BalanceTile
          icon={<PiggyBank />}
          label="Savings"
          value={dashboard?.byLocation.savings}
          loading={loading}
          to="/accounts"
        />
        <BalanceTile
          icon={<Wallet />}
          label={dashboard?.byPool.find((p) => p.kind === 'dad')?.name ?? 'Dad money'}
          value={dashboard?.byPool.find((p) => p.kind === 'dad')?.balance}
          loading={loading}
          to="/accounts"
        />
      </div>

      {/* Who owes whom */}
      <List>
        <Row
          icon={<IconBadge tone="positive"><UserRoundPlus /></IconBadge>}
          title="Others owe me"
          trailing={
            loading ? <Skeleton className="h-5 w-16" /> : <Money paise={dashboard?.owedToMe} size="md" maskable />
          }
          chevron
          onClick={() => navigate('/people')}
        />
        <Row
          icon={<IconBadge tone="negative"><UserRoundMinus /></IconBadge>}
          title="I owe others"
          trailing={
            loading ? <Skeleton className="h-5 w-16" /> : <Money paise={dashboard?.iOwe} size="md" maskable />
          }
          chevron
          onClick={() => navigate('/people')}
        />
      </List>

      <section>
        <div className="flex items-baseline justify-between">
          <SectionLabel>Recent</SectionLabel>
          {dashboard?.recentTransactions.length ? (
            <Link
              to="/activity"
              className="px-1 pb-2 text-[13px] font-medium text-accent press active:scale-[0.97]"
            >
              See all
            </Link>
          ) : null}
        </div>

        {loading ? (
          <div className="card divide-y divide-line">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <Skeleton className="size-10 rounded-[14px]" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="h-4 w-14" />
              </div>
            ))}
          </div>
        ) : dashboard?.recentTransactions.length ? (
          <List>
            <div className="stagger divide-y divide-line">
              {dashboard.recentTransactions.map((tx) => (
                <TransactionRow key={tx.id} transaction={tx} />
              ))}
            </div>
          </List>
        ) : (
          <Card>
            <EmptyState
              icon={<Sparkles />}
              title="No transactions yet"
              description="Add your first one and every rupee starts staying accounted for."
            />
          </Card>
        )}
      </section>
    </div>
  );
}

function BalanceTile({
  icon,
  label,
  value,
  loading,
  to,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null | undefined;
  loading: boolean;
  to: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'card flex flex-col gap-2.5 p-4',
        'transition-transform duration-[140ms] ease-out-strong active:scale-[0.98]',
      )}
    >
      <IconBadge tone="neutral" size="sm">
        {icon}
      </IconBadge>
      <div>
        <p className="text-[13px] text-ink-muted">{label}</p>
        {loading ? (
          <Skeleton className="mt-1 h-5 w-20" />
        ) : (
          <Money paise={value} size="lg" maskable className="mt-0.5" />
        )}
      </div>
    </Link>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Good night,';
  if (hour < 12) return 'Good morning,';
  if (hour < 17) return 'Good afternoon,';
  return 'Good evening,';
}

function today(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
