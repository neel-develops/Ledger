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
  ChartPie,
  ChevronRight,
} from 'lucide-react';
import { useLedger } from '../store/ledger';
import { usePrefs } from '../store/prefs';
import { useSession } from '../lib/auth-client';
import { Money } from '../components/ui/Money';
import { Card, EmptyState, List, SectionLabel, Skeleton } from '../components/ui/primitives';
import { TransactionRow } from '../components/TransactionRow';
import { ErrorState } from '../components/ErrorState';
import { Mascot, type MascotMood } from '../components/Mascot';
import { useCountUp } from '../lib/useCountUp';

export function HomeScreen() {
  const navigate = useNavigate();
  const { state, dashboard, error, unavailable, load } = useLedger();
  const { data: session } = useSession();
  const hidden = usePrefs((s) => s.balancesHidden);
  const toggleBalances = usePrefs((s) => s.toggleBalances);

  // The headline figures count to their new value, so a new entry is felt.
  // (Hooks, so above the early return.)
  const owned = useCountUp(dashboard?.ownedMoney);
  const net = useCountUp(dashboard?.netPosition);

  if (state === 'error') {
    return <ErrorState message={error} unavailable={unavailable} onRetry={() => void load()} />;
  }

  // Only ever skeleton when there is genuinely nothing to show. A background
  // refresh must not blank out figures the user is already reading.
  const loading = dashboard === null;
  const firstName = session?.user?.name?.split(' ')[0];

  // Chillar in the corner reads the room.
  const mood: MascotMood = !dashboard?.hasAnyData
    ? 'idle'
    : dashboard.netPosition > 0
      ? 'happy'
      : dashboard.netPosition < 0
        ? 'sad'
        : 'idle';

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between px-1 pt-4 pb-1">
        <div>
          <p className="text-[14px] text-ink-muted">
            {greeting()} <span className="text-ink-faint">· {today()}</span>
          </p>
          <p className="text-[24px] font-bold tracking-[-0.03em] text-ink">{firstName ?? 'Welcome'}</p>
        </div>
        <Mascot size={58} mood={mood} trackPointer className="-mb-3 shrink-0" label="Chillar" />
      </header>

      {/* The one number that matters, on the one glass surface that matters. */}
      <Card glass className="hero-card px-5 py-5">
        {/* The aurora and drifting coins live in their own clipped layer, so the
            rotating border outside it is not cut off. */}
        <div aria-hidden className="hero-fx">
          <span className="hero-aurora hero-aurora-a" />
          <span className="hero-aurora hero-aurora-b" />
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`hero-coin hero-coin-${i}`}>
              ₹
            </span>
          ))}
        </div>
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
            <Money paise={owned} size="display" maskable className="hero-amount" />
          )}
        </div>

        <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-ink-muted">
          {loading
            ? '\u00a0'
            : !dashboard?.hasAnyData
              ? 'No money recorded yet'
              : dashboard.hasPrivate
                ? // Not "savings combined" when savings is exactly what is being
                  // left out; the caption has to stay true to the number above it.
                  'Everything you are showing'
                : 'Cash, bank and savings combined'}
          {/*
            An account is being held back. Deliberately just a small icon: it
            means something to you and nothing to whoever is glancing at your
            phone, which is the entire point of the feature.
          */}
          {!loading && dashboard?.hasPrivate && (
            <EyeOff
              className="size-3.5 shrink-0 text-ink-faint"
              aria-label="Some accounts are hidden from this total"
            />
          )}
        </p>

        {dashboard && dashboard.hasAnyData && (
          <div className="relative mt-4 flex items-center justify-between border-t border-[var(--tile-border)] pt-3.5">
            <div>
              <p className="text-[12px] text-ink-muted">Net position</p>
              <Money paise={net} size="lg" maskable className="mt-0.5" />
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
          tone="#34d399"
          index={0}
          icon={<Banknote />}
          label="Cash"
          value={dashboard?.byLocation.cash}
          loading={loading}
          to="/accounts"
        />
        <BalanceTile
          tone="#5b8cff"
          index={1}
          icon={<CreditCard />}
          label="Digital"
          value={dashboard?.byLocation.digital}
          loading={loading}
          to="/accounts"
        />
        <BalanceTile
          tone="#b06bff"
          index={2}
          icon={<PiggyBank />}
          label="Savings"
          value={dashboard?.byLocation.savings}
          loading={loading}
          to="/accounts"
        />
        <BalanceTile
          tone="#ffb547"
          index={3}
          icon={<Wallet />}
          label={dashboard?.byPool.find((p) => p.kind === 'dad')?.name ?? 'Dad money'}
          value={dashboard?.byPool.find((p) => p.kind === 'dad')?.balance}
          loading={loading}
          to="/accounts"
        />
      </div>

      {/* Who owes whom */}
      <div className="grid grid-cols-2 gap-3">
        <NeonTile
          tone="#2fd3e0"
          index={4}
          icon={<UserRoundPlus />}
          label="Others owe me"
          onClick={() => navigate('/people')}
        >
          {loading ? <Skeleton className="h-5 w-16" /> : <Money paise={dashboard?.owedToMe} size="lg" maskable />}
        </NeonTile>
        <NeonTile
          tone="#ff5d73"
          index={5}
          icon={<UserRoundMinus />}
          label="I owe others"
          onClick={() => navigate('/people')}
        >
          {loading ? <Skeleton className="h-5 w-16" /> : <Money paise={dashboard?.iOwe} size="lg" maskable />}
        </NeonTile>
      </div>

      <button
        type="button"
        onClick={() => navigate('/insights')}
        style={{ '--tone': '#ff7ad9', '--shine-delay': '740ms' } as React.CSSProperties}
        className="kind-tile group flex w-full items-center gap-3.5 rounded-xl px-4 py-3.5 text-left"
      >
        <span aria-hidden className="kind-glow" />
        <span className="kind-icon grid size-10 shrink-0 place-items-center rounded-[14px] [&>svg]:size-[19px]">
          <ChartPie />
        </span>
        <span className="relative min-w-0 flex-1">
          <span className="block text-[16px] font-semibold tracking-[-0.01em] text-ink">Insights</span>
          <span className="block text-[13px] text-ink-muted">Where your money went this week</span>
        </span>
        <ChevronRight
          className="relative size-4 text-ink-faint transition-transform duration-200 ease-out-strong group-active:translate-x-1"
          aria-hidden
        />
      </button>

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
              icon={<span className="grid place-items-center"><Mascot size={46} /></span>}
              title="No transactions yet"
              description="Add your first one and every rupee starts staying accounted for."
            />
          </Card>
        )}
      </section>
    </div>
  );
}

/** A balance on a neon tile: its own hue, a glow in dark mode, a shine as it arrives. */
function BalanceTile({
  icon,
  label,
  value,
  loading,
  to,
  tone,
  index,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null | undefined;
  loading: boolean;
  to: string;
  tone: string;
  index: number;
}) {
  return (
    <Link
      to={to}
      style={{ '--tone': tone, '--shine-delay': `${200 + index * 90}ms` } as React.CSSProperties}
      className="kind-tile flex flex-col gap-2.5 rounded-xl p-4"
    >
      <span aria-hidden className="kind-glow" />
      <span className="kind-icon grid size-9 place-items-center rounded-[12px] [&>svg]:size-[17px]">{icon}</span>
      <div className="relative">
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

/** The same tile as a button, for the owed / owing pair. */
function NeonTile({
  icon,
  label,
  tone,
  index,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  tone: string;
  index: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ '--tone': tone, '--shine-delay': `${200 + index * 90}ms` } as React.CSSProperties}
      className="kind-tile flex flex-col gap-2.5 rounded-xl p-4 text-left"
    >
      <span aria-hidden className="kind-glow" />
      <span className="kind-icon grid size-9 place-items-center rounded-[12px] [&>svg]:size-[17px]">{icon}</span>
      <div className="relative">
        <p className="text-[13px] text-ink-muted">{label}</p>
        <div className="mt-0.5">{children}</div>
      </div>
    </button>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function today(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
