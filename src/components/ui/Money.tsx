import { formatPaise, NO_VALUE } from '@shared/money';
import { usePrefs } from '../../store/prefs';
import { cn } from '../../lib/cn';

/**
 * The only component allowed to render an amount.
 *
 *   null / undefined  ->  "—"      (we do not know yet)
 *   0                 ->  "₹0"     (we know, and it is zero)
 *
 * The distinction matters: a dash is honest about not knowing, and the app
 * never fills the gap with a number it made up.
 */

export interface MoneyProps {
  paise: number | null | undefined;
  /** Colour by direction. Off by default — most figures are neutral. */
  tone?: 'auto' | 'neutral' | 'positive' | 'negative';
  signed?: boolean;
  size?: 'display' | 'xl' | 'lg' | 'md' | 'sm' | 'xs';
  className?: string;
  /** Respect the global "hide balances" toggle. On for balances, off in forms. */
  maskable?: boolean;
}

const SIZES: Record<NonNullable<MoneyProps['size']>, string> = {
  display: 'text-[44px] leading-[1.05] font-semibold tracking-[-0.03em]',
  xl: 'text-[30px] leading-tight font-semibold tracking-[-0.025em]',
  lg: 'text-[22px] leading-tight font-semibold tracking-[-0.02em]',
  md: 'text-[17px] font-medium tracking-[-0.01em]',
  sm: 'text-[15px] font-medium',
  xs: 'text-[13px] font-medium',
};

export function Money({
  paise,
  tone = 'neutral',
  signed = false,
  size = 'md',
  className,
  maskable = false,
}: MoneyProps) {
  const hidden = usePrefs((s) => s.balancesHidden);

  const known = typeof paise === 'number';
  const masked = maskable && hidden && known;

  const resolvedTone =
    tone === 'auto' ? (!known || paise === 0 ? 'neutral' : paise > 0 ? 'positive' : 'negative') : tone;

  return (
    <span
      className={cn(
        'tnum inline-block whitespace-nowrap',
        SIZES[size],
        resolvedTone === 'positive' && 'text-positive',
        resolvedTone === 'negative' && 'text-negative',
        resolvedTone === 'neutral' && 'text-ink',
        !known && 'text-ink-faint',
        className,
      )}
      title={known && !masked ? formatPaise(paise, { compactPaise: false }) : undefined}
    >
      {!known ? NO_VALUE : masked ? '••••' : formatPaise(paise, { signed })}
    </span>
  );
}

/** A compact label like "Owes you ₹500" / "Settled". */
export function DebtLabel({ netBalance }: { netBalance: number | null }) {
  if (netBalance === null) return <span className="text-ink-faint">{NO_VALUE}</span>;
  if (netBalance === 0) return <span className="text-ink-muted">Settled</span>;
  return (
    <span className={netBalance > 0 ? 'text-positive' : 'text-negative'}>
      {netBalance > 0 ? 'Owes you ' : 'You owe '}
      <span className="tnum font-medium">{formatPaise(Math.abs(netBalance))}</span>
    </span>
  );
}
