import { useCallback, useEffect } from 'react';
import { Delete } from 'lucide-react';
import { formatPaise } from '@shared/money';
import { appendDigit } from '../lib/amount';
import { cn } from '../lib/cn';

/**
 * The amount keypad.
 *
 * Digits are appended to a paise integer, so what you type is exactly what is
 * stored — there is no float anywhere between the keypress and the database.
 * Typing 1, 5, 0 gives 150 paise (₹1.50); the decimal point is implicit.
 */

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'del'] as const;

export interface AmountPadProps {
  value: number;
  onChange: (value: number) => void;
  /** Rendered between the readout and the keys (category chips, etc.). */
  children?: React.ReactNode;
  autoFocusKeyboard?: boolean;
}

export function AmountPad({ value, onChange, children, autoFocusKeyboard = true }: AmountPadProps) {
  const press = useCallback(
    (key: string) => {
      onChange(appendDigit(value, key));
      // A short tick on supporting devices. Silent everywhere else.
      if ('vibrate' in navigator) navigator.vibrate?.(8);
    },
    [value, onChange],
  );

  // A physical keyboard should work too, with no animation attached to it.
  useEffect(() => {
    if (!autoFocusKeyboard) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        press(event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        press('del');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, autoFocusKeyboard]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col items-center justify-center py-6">
        <output
          aria-live="polite"
          aria-label="Amount"
          className={cn(
            'tnum text-[48px] leading-none font-semibold tracking-[-0.035em]',
            value === 0 ? 'text-ink-faint' : 'text-ink',
          )}
        >
          {formatPaise(value, { compactPaise: false })}
        </output>
      </div>

      {children}

      <div className="mt-auto grid grid-cols-3 gap-2 pt-4">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => press(key)}
            aria-label={key === 'del' ? 'Delete last digit' : key}
            className={cn(
              'grid h-[58px] place-items-center rounded-lg text-[22px] font-medium',
              'bg-[color-mix(in_srgb,white_70%,transparent)] text-ink',
              'border border-[color-mix(in_srgb,white_60%,transparent)]',
              'transition-[transform,background-color] duration-[120ms] ease-out-strong',
              'active:scale-[0.96] active:bg-surface-sunken',
              key === 'del' && 'text-ink-soft',
            )}
          >
            {key === 'del' ? <Delete className="size-5" aria-hidden /> : key}
          </button>
        ))}
      </div>
    </div>
  );
}
