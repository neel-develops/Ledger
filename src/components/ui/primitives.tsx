import type { ReactNode, InputHTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';

/* ------------------------------------------------------------------ *
 * Surfaces
 * ------------------------------------------------------------------ */

export function Card({
  children,
  className,
  glass,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  glass?: boolean;
  as?: 'div' | 'section' | 'li';
}) {
  return (
    <Tag className={cn(glass ? 'glass rounded-2xl' : 'card', 'relative', className)}>
      {children}
    </Tag>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2
      className={cn(
        'px-1 pb-2 text-[13px] font-medium tracking-[0.01em] text-ink-muted',
        className,
      )}
    >
      {children}
    </h2>
  );
}

/** A grouped list, the way iOS does it — one card, hairline separators. */
export function List({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'card overflow-hidden divide-y divide-line',
        '[&>*]:first:rounded-t-xl [&>*]:last:rounded-b-xl',
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface RowProps {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  href?: string;
  chevron?: boolean;
  className?: string;
  danger?: boolean;
}

export function Row({ icon, title, subtitle, trailing, onClick, chevron, className, danger }: RowProps) {
  const interactive = Boolean(onClick);
  const Tag = interactive ? 'button' : 'div';

  return (
    <Tag
      {...(interactive ? { type: 'button' as const, onClick } : {})}
      className={cn(
        'hoverable flex w-full items-center gap-3 bg-surface px-4 py-3 text-left',
        'min-h-[56px] transition-[background-color,transform] duration-[140ms] ease-out-strong',
        interactive && 'active:scale-[0.985] active:bg-surface-sunken',
        danger && 'text-negative',
        className,
      )}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-current">{title}</span>
        {subtitle && (
          <span className="mt-0.5 block truncate text-[13px] text-ink-muted">{subtitle}</span>
        )}
      </span>
      {trailing && <span className="shrink-0 text-right">{trailing}</span>}
      {chevron && <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />}
    </Tag>
  );
}

/* ------------------------------------------------------------------ *
 * Icon badge
 * ------------------------------------------------------------------ */

export function IconBadge({
  children,
  tone = 'neutral',
  size = 'md',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'positive' | 'negative';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-[14px] border',
        size === 'sm' && 'size-8 [&>svg]:size-4 rounded-[10px]',
        size === 'md' && 'size-10 [&>svg]:size-[18px]',
        size === 'lg' && 'size-12 [&>svg]:size-5 rounded-[16px]',
        tone === 'neutral' && 'border-line bg-surface-sunken text-ink-soft',
        tone === 'accent' && 'border-transparent bg-accent-soft text-accent',
        tone === 'positive' && 'border-transparent bg-positive-soft text-positive',
        tone === 'negative' && 'border-transparent bg-negative-soft text-negative',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Initials avatar. Hue is derived from the name so it is stable per person. */
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();

  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;

  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        background: `oklch(0.94 0.045 ${hash})`,
        color: `oklch(0.45 0.11 ${hash})`,
        fontSize: size * 0.36,
      }}
      className="grid shrink-0 place-items-center rounded-full font-semibold"
    >
      {initials || '?'}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-12 w-full rounded-md border border-line-strong bg-surface px-3.5',
          'text-[16px] text-ink placeholder:text-ink-faint',
          'transition-[border-color,box-shadow] duration-150 ease-out',
          'focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent-soft',
          'disabled:bg-surface-sunken disabled:text-ink-muted',
          className,
        )}
        {...props}
      />
    );
  },
);

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-ink-soft">{label}</span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-[13px] text-negative">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-[13px] text-ink-muted">{hint}</span>
      ) : null}
    </label>
  );
}

/**
 * Segmented control. The selected pill slides between options rather than
 * fading, so the eye can follow where the selection went.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  return (
    <div
      role="tablist"
      className={cn(
        'relative grid gap-0.5 rounded-md bg-surface-sunken p-1',
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className="absolute inset-y-1 rounded-[10px] bg-surface shadow-[0_1px_3px_rgb(16_16_26/0.1)] transition-transform duration-[260ms] ease-out-strong"
        style={{
          width: `calc((100% - 0.5rem) / ${options.length})`,
          left: '0.25rem',
          transform: `translateX(calc(${index} * 100%))`,
        }}
      />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'relative z-10 h-9 rounded-[10px] px-2 text-[14px] font-medium',
            'transition-colors duration-200 ease-out',
            option.value === value ? 'text-ink' : 'text-ink-muted',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * States
 * ------------------------------------------------------------------ */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      {icon && (
        <span className="mb-4 grid size-14 place-items-center rounded-[18px] bg-surface-sunken text-ink-faint [&>svg]:size-6">
          {icon}
        </span>
      )}
      <p className="text-[17px] font-semibold tracking-[-0.015em] text-ink">{title}</p>
      {description && (
        <p className="mt-1.5 max-w-[34ch] text-[14px] leading-relaxed text-ink-muted">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={cn('skeleton block rounded-[8px]', className)} aria-hidden />;
}
