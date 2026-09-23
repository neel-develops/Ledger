import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useAnchoredPopover } from '../../lib/useAnchoredPopover';

/**
 * When a transaction happened.
 *
 * Replaces <input type="date">, whose calendar belongs to the OS and ignored
 * dark mode. Most entries are today or a day or two back, so those are one tap;
 * anything older is a month grid. The future is never selectable — a ledger
 * records what happened, not what might.
 *
 * Picking a day keeps the time of day, so same-day entries keep their order.
 */

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const PANEL_HEIGHT = 420;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const monthOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

/** "Today", "Yesterday", or "Mon, 22 Sep" (with the year when it is not this one). */
function describeDay(value: Date, now = new Date()): string {
  if (sameDay(value, now)) return 'Today';
  if (sameDay(value, addDays(now, -1))) return 'Yesterday';
  return value.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(value.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export function DatePicker({
  value,
  onChange,
  label = 'When',
}: {
  value: Date;
  onChange: (value: Date) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => monthOf(value));
  const [cursor, setCursor] = useState(() => startOfDay(value));
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const today = startOfDay(new Date());

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus({ preventScroll: true });
  }, []);
  const dismiss = useCallback(() => close(false), [close]);

  const place = useAnchoredPopover({
    open,
    trigger,
    panel,
    onDismiss: dismiss,
    wantedHeight: PANEL_HEIGHT,
    maxHeight: PANEL_HEIGHT,
    minWidth: 312,
  });

  const openPanel = () => {
    setMonth(monthOf(value));
    setCursor(startOfDay(value));
    setOpen(true);
  };

  const pick = (day: Date) => {
    if (startOfDay(day) > today) return;
    const next = new Date(value);
    next.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
    const now = new Date();
    onChange(next > now ? now : next);
    close();
  };

  // Keep keyboard focus on the cursor day as it moves, across months too.
  useEffect(() => {
    if (!open || !place) return;
    panel.current?.querySelector<HTMLButtonElement>(`[data-day="${cursor.toDateString()}"]`)?.focus({ preventScroll: true });
  }, [open, place, cursor, month]);

  const moveCursor = (days: number) => {
    const next = addDays(cursor, days);
    if (next > today) return;
    setCursor(next);
    if (next.getMonth() !== month.getMonth() || next.getFullYear() !== month.getFullYear()) setMonth(monthOf(next));
  };

  const onGridKey = (event: React.KeyboardEvent) => {
    const moves: Record<string, () => void> = {
      ArrowLeft: () => moveCursor(-1),
      ArrowRight: () => moveCursor(1),
      ArrowUp: () => moveCursor(-7),
      ArrowDown: () => moveCursor(7),
      Escape: () => close(),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    move();
  };

  const cells = useMemo(() => {
    const first = month.getDay();
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [
      ...Array.from({ length: first }, () => null),
      ...Array.from({ length: days }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)),
    ];
  }, [month]);

  const canGoForward = monthOf(addDays(month, 32)) <= monthOf(today);
  const quick = [
    { label: 'Today', day: today },
    { label: 'Yesterday', day: addDays(today, -1) },
    { label: '2 days ago', day: addDays(today, -2) },
  ];

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : openPanel())}
        className={cn(
          'flex w-full items-center gap-2 rounded-md border bg-surface px-3 py-2 text-left',
          'transition-[border-color,transform] duration-150 ease-out active:scale-[0.99]',
          open ? 'border-accent' : 'border-line',
        )}
      >
        <CalendarDays className="size-4 shrink-0 text-ink-faint" aria-hidden />
        <span className="shrink-0 text-[13px] text-ink-muted">{label}</span>
        <span className="min-w-0 flex-1 truncate text-right text-[14px] font-medium text-ink">
          {describeDay(value)}
        </span>
        <ChevronDown
          aria-hidden
          className={cn('size-4 shrink-0 text-ink-muted transition-transform duration-200 ease-out-strong', open && 'rotate-180')}
        />
      </button>

      {open &&
        place &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-modal="false"
            aria-labelledby={titleId}
            style={{
              left: place.left,
              width: place.width,
              top: place.top,
              bottom: place.bottom,
              maxHeight: place.maxHeight,
              transformOrigin: `${place.origin} center`,
            }}
            className={cn(
              'picker-in fixed z-[60] overflow-y-auto overscroll-contain rounded-[20px] p-3',
              'border border-line bg-[var(--popover-bg)] shadow-[0_18px_48px_-12px_rgb(0_0_0/0.45)]',
            )}
          >
            <div className="flex gap-1.5">
              {quick.map((q) => {
                const selected = sameDay(q.day, value);
                return (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => pick(q.day)}
                    className={cn(
                      'flex-1 rounded-full px-2 py-2 text-[13px] font-medium transition-[transform,background-color] duration-150 ease-out active:scale-[0.96]',
                      selected ? 'bg-accent text-white' : 'bg-surface-sunken text-ink-soft',
                    )}
                  >
                    {q.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex items-center justify-between px-1">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                className="grid size-9 place-items-center rounded-full text-ink-soft transition-transform duration-150 active:scale-[0.9] hover:bg-surface-sunken"
              >
                <ChevronLeft className="size-[18px]" />
              </button>
              <p id={titleId} className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
                {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
              </p>
              <button
                type="button"
                aria-label="Next month"
                disabled={!canGoForward}
                onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                className="grid size-9 place-items-center rounded-full text-ink-soft transition-transform duration-150 active:scale-[0.9] hover:bg-surface-sunken disabled:opacity-25"
              >
                <ChevronRight className="size-[18px]" />
              </button>
            </div>

            <div className="mt-1 grid grid-cols-7 text-center" aria-hidden>
              {WEEKDAYS.map((d, i) => (
                <span key={i} className="py-1.5 text-[11.5px] font-medium text-ink-faint">
                  {d}
                </span>
              ))}
            </div>

            <div role="grid" aria-labelledby={titleId} onKeyDown={onGridKey} className="grid grid-cols-7 gap-y-1">
              {cells.map((day, i) => {
                if (!day) return <span key={`blank-${i}`} />;
                const future = day > today;
                const selected = sameDay(day, value);
                const isToday = sameDay(day, today);
                const isCursor = sameDay(day, cursor);
                return (
                  <div key={day.toDateString()} role="gridcell" className="flex justify-center">
                    <button
                      type="button"
                      data-day={day.toDateString()}
                      tabIndex={isCursor ? 0 : -1}
                      disabled={future}
                      aria-selected={selected}
                      aria-label={day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                      onClick={() => pick(day)}
                      className={cn(
                        'tnum grid size-10 place-items-center rounded-full text-[14.5px] outline-none',
                        'transition-[transform,background-color] duration-150 ease-out active:scale-[0.88]',
                        'focus-visible:ring-2 focus-visible:ring-accent',
                        selected
                          ? 'bg-accent font-semibold text-white shadow-[0_6px_18px_-6px_var(--color-accent)]'
                          : isToday
                            ? 'font-semibold text-accent ring-1 ring-inset ring-accent'
                            : 'text-ink hover:bg-surface-sunken',
                        future && 'text-ink-faint opacity-35',
                      )}
                    >
                      {day.getDate()}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
