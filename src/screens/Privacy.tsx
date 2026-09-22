import { useState } from 'react';
import { EyeOff, Moon, ShieldCheck, Sun, SunMoon } from 'lucide-react';
import { toast } from 'sonner';
import { formatPaise } from '@shared/money';
import { useLedger } from '../store/ledger';
import { usePrefs } from '../store/prefs';
import { Sheet } from '../components/ui/Sheet';
import { Card, List, Row, SectionLabel, Skeleton } from '../components/ui/primitives';
import { Money } from '../components/ui/Money';
import { api, ApiError } from '../lib/api';
import type { ThemePreference } from '../lib/theme';

/* ------------------------------------------------------------------ *
 * Appearance
 * ------------------------------------------------------------------ */

export function AppearanceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const theme = usePrefs((s) => s.theme);
  const setTheme = usePrefs((s) => s.setTheme);

  const options: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: 'Light', icon: <Sun className="size-4" /> },
    { value: 'dark', label: 'Dark', icon: <Moon className="size-4" /> },
    { value: 'system', label: 'Automatic', icon: <SunMoon className="size-4" /> },
  ];

  return (
    <Sheet open={open} onClose={onClose} title="Appearance">
      <div className="space-y-4 pb-2">
        <div className="grid grid-cols-3 gap-2">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setTheme(option.value)}
              className={`flex h-[72px] flex-col items-center justify-center gap-1.5 rounded-lg border text-[13px] font-medium transition-[transform,background-color,border-color] duration-[140ms] ease-out-strong active:scale-[0.96] ${
                theme === option.value
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line-strong bg-surface text-ink-soft'
              }`}
            >
              {option.icon}
              {option.label}
            </button>
          ))}
        </div>

        <p className="px-1 text-[13px] leading-relaxed text-ink-muted">
          {theme === 'system'
            ? 'Follows your phone, and changes with it.'
            : `Always ${theme}, whatever your phone is set to.`}
        </p>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ *
 * Private accounts
 * ------------------------------------------------------------------ */

/**
 * Choosing what other people get to see.
 *
 * A private account is left out of "Total money", out of the Cash/Digital
 * tiles, out of the per-pool balances and out of the home-screen widget — so
 * when someone glances at your phone, the number they see is the one you meant
 * them to see.
 *
 * It changes nothing about the ledger. The balance is real and still here, the
 * cash check still counts it, backups still contain it, and the health checks
 * still verify it. This is about what is displayed, never about what is true.
 */
export function PrivacySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const accounts = useLedger((s) => s.accounts);
  const dashboard = useLedger((s) => s.dashboard);
  const refresh = useLedger((s) => s.refresh);
  const [busy, setBusy] = useState<string | null>(null);

  const active = (accounts ?? []).filter((a) => !a.archivedAt);

  async function toggle(id: string, name: string, next: boolean) {
    setBusy(id);
    try {
      await api.patch(`/accounts/${id}`, { isPrivate: next });
      await refresh();
      toast.success(next ? `${name} is now hidden` : `${name} is visible again`, {
        description: next ? 'Left out of your total and the widget.' : undefined,
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'We could not change that.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="What others see">
      <div className="space-y-4 pb-2">
        <p className="text-[14px] leading-relaxed text-ink-muted">
          Hide an account and it drops out of Total money, the tiles and the home-screen widget. Your ledger
          is unchanged — the balance is still real, still counted, still backed up.
        </p>

        {accounts === null ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : (
          <>
            <SectionLabel>Accounts</SectionLabel>
            <List>
              {active.map((account) => (
                <Row
                  key={account.id}
                  title={account.name}
                  subtitle={account.isPrivate ? 'Hidden from your total' : 'Counted in your total'}
                  trailing={
                    <span className="flex items-center gap-2.5">
                      <Money paise={account.balance} size="sm" />
                      <Toggle
                        on={account.isPrivate}
                        disabled={busy === account.id}
                        onChange={() => toggle(account.id, account.name, !account.isPrivate)}
                      />
                    </span>
                  }
                />
              ))}
            </List>
          </>
        )}

        {dashboard && dashboard.hasPrivate && (
          <Card className="flex items-center gap-3 p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-surface-sunken text-ink-soft">
              <EyeOff className="size-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] text-ink-muted">Hidden from your total</span>
              <span className="block text-[17px] font-semibold tracking-[-0.015em]">
                {formatPaise(dashboard.privateMoney)}
              </span>
            </span>
          </Card>
        )}

        <div className="flex gap-2.5 rounded-md bg-surface-sunken px-3.5 py-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
          <p className="text-[13px] leading-relaxed text-ink-soft">
            This only changes what is displayed. Nothing is deleted or moved, and a cash check on a hidden
            account still expects its real balance.
          </p>
        </div>
      </div>
    </Sheet>
  );
}

function Toggle({
  on,
  disabled,
  onChange,
}: {
  on: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={`relative inline-flex h-[30px] w-[50px] shrink-0 items-center rounded-full transition-colors duration-200 ease-out disabled:opacity-50 ${
        on ? 'bg-accent' : 'bg-line-strong'
      }`}
    >
      <span
        className="absolute left-0.5 size-[26px] rounded-full bg-white shadow-[0_1px_3px_rgb(16_16_26/0.2)] transition-transform duration-[220ms] ease-out-strong"
        style={{ transform: on ? 'translateX(20px)' : 'translateX(0)' }}
      />
    </button>
  );
}
