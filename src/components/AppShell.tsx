import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useSearchParams } from 'react-router-dom';
import { Home, ListTree, Users, MoreHorizontal, Plus, CloudOff } from 'lucide-react';
import { AddTransaction } from './AddTransaction';
import { AssistantSheet } from './Assistant';
import { Mascot } from './Mascot';
import { CelebrationLayer } from './Celebration';
import { useLedger } from '../store/ledger';
import { subscribeToOutbox } from '../lib/outbox';
import { cn } from '../lib/cn';
import type { TransactionKind } from '@shared/domain';
import type { TransactionDraft } from '@shared/nlp';

const LEFT_TABS = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/activity', label: 'Activity', icon: ListTree },
] as const;

const RIGHT_TABS = [
  { to: '/people', label: 'People', icon: Users },
  { to: '/more', label: 'More', icon: MoreHorizontal },
] as const;

type Tab = { to: string; label: string; icon: typeof Home; end?: boolean };

/**
 * The app shell. One column on a phone, the same column centred on a desktop —
 * a money app is a one-handed thing, and widening it would not make it better.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [adding, setAdding] = useState(false);
  const [asking, setAsking] = useState(false);
  const [presetKind, setPresetKind] = useState<TransactionKind | null>(null);
  const pendingCount = useLedger((s) => s.pendingCount);
  const setPendingCount = useLedger((s) => s.setPendingCount);
  const location = useLocation();
  const [params, setParams] = useSearchParams();

  useEffect(() => subscribeToOutbox((entries) => setPendingCount(entries.length)), [setPendingCount]);

  /*
   * The widget's quick actions arrive as ?add=<kind>. Open the sheet on that
   * kind and strip the parameter immediately, so a back-navigation or a
   * refresh does not reopen it behind the user.
   */
  const addParam = params.get('add');
  useEffect(() => {
    if (!addParam) return;
    // Only kinds the widget actually offers; anything else just opens the picker.
    const kind = (['expense', 'income', 'transfer'] as const).find((k) => k === addParam) ?? null;
    setPresetKind(kind);
    setAdding(true);

    const next = new URLSearchParams(params);
    next.delete('add');
    setParams(next, { replace: true });
  }, [addParam, params, setParams]);

  // A new screen always starts at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="relative z-10 mx-auto flex min-h-[100svh] w-full max-w-[560px] flex-col">
      <main className="flex-1 px-4 pt-safe pb-[calc(132px+env(safe-area-inset-bottom))]">{children}</main>

      {/*
        The bottom scrim. Content scrolling under the navigation fades into the
        canvas instead of being clipped by an opaque bar or hidden behind the
        action button — so a balance is never half-covered by a circle.
      */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 z-20 h-[calc(140px+env(safe-area-inset-bottom))] bg-gradient-to-t from-canvas via-canvas/92 to-transparent"
      />

      {pendingCount > 0 && (
        <div className="animate-fade pointer-events-none fixed inset-x-0 bottom-[calc(100px+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-[560px] justify-start px-4">
          <span className="glass-strong flex items-center gap-2 rounded-full px-3.5 py-2 text-[13px] font-medium text-ink-soft shadow-card">
            <CloudOff className="size-3.5" aria-hidden />
            {pendingCount} waiting to sync
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={() => setAdding(true)}
        aria-label="Add transaction"
        className={cn(
          // Bottom-right, clear of the content column and of the nav's own
          // tap targets, and within reach of a thumb.
          'fixed bottom-[calc(88px+env(safe-area-inset-bottom))] z-40',
          'right-[max(1rem,calc(50%-280px+1rem))]',
          'grid size-14 place-items-center rounded-full bg-accent text-white',
          'shadow-[0_2px_8px_rgb(88_86_214/0.3),0_12px_32px_-8px_rgb(88_86_214/0.55)]',
          'transition-transform duration-[160ms] ease-out-strong active:scale-[0.93]',
        )}
      >
        <Plus className="size-6" strokeWidth={2.25} aria-hidden />
      </button>

      <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-[560px] px-4 pb-safe">
        <div className="glass-strong relative mb-3 grid grid-cols-5 items-end rounded-[22px] px-1 py-1.5 shadow-card">
          {LEFT_TABS.map((tab) => (
            <TabLink key={tab.to} tab={tab} />
          ))}

          {/*
            Chillar sits raised in the centre of the bar: the one button that
            can do everything the others can, by just being asked.
          */}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setAsking(true)}
              aria-label="Ask Chillar"
              className={cn(
                'orb-halo -mt-7 grid size-[62px] place-items-center rounded-full',
                'border border-[var(--glass-border-strong)] bg-[var(--glass-bg-strong)] backdrop-blur-xl',
                'shadow-[0_10px_28px_-8px_rgb(88_86_214/0.55)]',
                'transition-transform duration-[160ms] ease-out-strong active:scale-[0.92]',
              )}
            >
              <Mascot size={48} className="-mb-0.5" />
            </button>
          </div>

          {RIGHT_TABS.map((tab) => (
            <TabLink key={tab.to} tab={tab} />
          ))}
        </div>
      </nav>

      <AssistantSheet open={asking} onClose={() => setAsking(false)} />

      <CelebrationLayer />

      <AddTransaction
        open={adding}
        onClose={() => {
          setAdding(false);
          setPresetKind(null);
        }}
        initialDraft={presetKind ? emptyDraftFor(presetKind) : null}
      />
    </div>
  );
}

/**
 * A draft that names only the kind. Everything else stays null so the form
 * falls back to your usual account and category — a widget tap should land
 * you on the keypad, not on a half-filled form you have to check.
 */
function emptyDraftFor(kind: TransactionKind): TransactionDraft {
  return {
    kind,
    amount: null,
    personId: null,
    personName: null,
    unknownPersonName: null,
    categoryId: null,
    accountId: null,
    poolId: null,
    toAccountId: null,
    toPoolId: null,
    note: null,
    confidence: 'high',
    missing: [],
  };
}

function TabLink({ tab }: { tab: Tab }) {
  return (
    <NavLink
      to={tab.to}
      end={tab.end ?? false}
      className={({ isActive }) =>
        cn(
          'flex flex-col items-center gap-0.5 rounded-[14px] px-1 py-1.5',
          // Used constantly, so it changes colour rather than animating.
          'transition-colors duration-150 ease-out',
          isActive ? 'text-accent' : 'text-ink-muted',
        )
      }
    >
      {({ isActive }) => (
        <>
          <tab.icon className="size-[19px]" strokeWidth={isActive ? 2.3 : 1.9} aria-hidden />
          <span className="text-[10.5px] font-medium tracking-[0.01em]">{tab.label}</span>
        </>
      )}
    </NavLink>
  );
}

/** Screen header. Large title, optional trailing control. */
export function ScreenHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-3 px-1 pt-3 pb-5">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.03em] text-ink">
          {title}
        </h1>
        {subtitle && <p className="mt-0.5 text-[14px] text-ink-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
