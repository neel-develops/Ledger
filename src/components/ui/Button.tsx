import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * Buttons scale to 0.97 on press. It costs nothing and it is the difference
 * between an interface that responds and one that merely works.
 */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-white shadow-[0_1px_2px_rgb(88_86_214/0.24),0_8px_20px_-8px_rgb(88_86_214/0.5)] ' +
    'hover:bg-accent-ink disabled:bg-ink-faint disabled:shadow-none',
  secondary:
    'bg-surface text-ink border border-line-strong shadow-[0_1px_2px_rgb(16_16_26/0.04)] ' +
    'hover:bg-surface-warm',
  ghost: 'bg-transparent text-ink-soft hover:bg-surface-sunken',
  danger: 'bg-negative-soft text-negative hover:bg-[#f7e0de]',
};

const SIZES: Record<Size, string> = {
  // 44px minimum touch target, always.
  sm: 'h-11 px-4 text-[15px] rounded-md',
  md: 'h-12 px-5 text-[15px] rounded-lg',
  lg: 'h-14 px-6 text-[17px] rounded-xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', block, loading, icon, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={props.type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'relative inline-flex items-center justify-center gap-2 font-medium select-none',
        'transition-[transform,background-color,box-shadow,opacity] duration-[160ms] ease-out-strong',
        'active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
      {...props}
    >
      {/*
        The label keeps its place while loading — the button must not resize,
        or the layout jumps under the user's finger.
      */}
      <span
        className={cn(
          'inline-flex items-center gap-2 transition-[opacity,filter] duration-200 ease-out',
          loading && 'opacity-0 blur-[2px]',
        )}
      >
        {icon}
        {children}
      </span>
      {loading && (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner />
        </span>
      )}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('size-[18px] animate-spin', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
