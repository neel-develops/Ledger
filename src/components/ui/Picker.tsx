import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useAnchoredPopover } from '../../lib/useAnchoredPopover';

/**
 * A select that looks like the rest of the app.
 *
 * The native <select> hands its menu to the OS, and Android's ignores the
 * page's colour scheme: in dark mode it opened as a white box of near-white
 * text. This one draws its own menu, anchored under the field (or above it,
 * when the field sits low on the screen), on the same surface as the sheet.
 *
 * It keeps what the native one got right: arrow keys, Enter, Escape, Home and
 * End, and it is announced as a listbox. A value that matches no option shows
 * the placeholder rather than silently displaying the first option.
 */

export interface PickerOption {
  id: string;
  label: string;
  icon?: ReactNode;
  /** A quiet trailing line, e.g. a balance. */
  hint?: string;
}

export interface PickerProps {
  label: string;
  value: string | null;
  options: PickerOption[];
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
}

const MENU_MAX_HEIGHT = 300;
/** An option with a hint line is about this tall. Only used to choose a side. */
const ROW_ESTIMATE = 64;

export function Picker({ label, value, options, onChange, placeholder = 'Choose…', className }: PickerProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.id === value) ?? null;

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus({ preventScroll: true });
  }, []);

  const openMenu = () => {
    setActive(Math.max(0, options.findIndex((o) => o.id === value)));
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.id);
    close();
  };

  const dismiss = useCallback(() => close(false), [close]);
  const place = useAnchoredPopover({
    open,
    trigger,
    panel: menu,
    onDismiss: dismiss,
    wantedHeight: options.length * ROW_ESTIMATE + 12,
    maxHeight: MENU_MAX_HEIGHT,
  });

  useEffect(() => {
    if (open && place) menu.current?.focus({ preventScroll: true });
  }, [open, place]);

  // Keep the highlighted option in view while arrowing through a long list.
  useEffect(() => {
    if (open) menu.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onMenuKey = (event: React.KeyboardEvent) => {
    const last = options.length - 1;
    const moves: Record<string, () => void> = {
      ArrowDown: () => setActive((i) => Math.min(last, i + 1)),
      ArrowUp: () => setActive((i) => Math.max(0, i - 1)),
      Home: () => setActive(0),
      End: () => setActive(last),
      Enter: () => choose(active),
      ' ': () => choose(active),
      Escape: () => close(),
      Tab: () => close(false),
    };
    const move = moves[event.key];
    if (!move) return;
    if (event.key !== 'Tab') event.preventDefault();
    move();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
            event.preventDefault();
            openMenu();
          }
        }}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 rounded-md border bg-surface px-3 py-2 text-left',
          'transition-[border-color,transform] duration-150 ease-out active:scale-[0.98]',
          open ? 'border-accent' : 'border-line',
          className,
        )}
      >
        <span className="shrink-0 text-[13px] text-ink-muted">{label}</span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-right text-[14px] font-medium',
            selected ? 'text-ink' : 'text-ink-faint',
          )}
        >
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-ink-muted transition-transform duration-200 ease-out-strong',
            open && 'rotate-180',
          )}
        />
      </button>

      {open &&
        place &&
        createPortal(
          <div
            ref={menu}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label={label}
            aria-activedescendant={`${listId}-${active}`}
            onKeyDown={onMenuKey}
            style={{
              left: place.left,
              width: place.width,
              top: place.top,
              bottom: place.bottom,
              maxHeight: place.maxHeight,
              transformOrigin: `${place.origin} center`,
            }}
            className={cn(
              'picker-in fixed z-[60] overflow-y-auto overscroll-contain rounded-[18px] p-1.5 outline-none',
              'border border-line bg-[var(--popover-bg)] shadow-[0_18px_48px_-12px_rgb(0_0_0/0.45)]',
            )}
          >
            {options.map((option, index) => {
              const isSelected = option.id === value;
              return (
                <div
                  key={option.id}
                  id={`${listId}-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={isSelected}
                  onPointerEnter={() => setActive(index)}
                  onClick={() => choose(index)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-[12px] px-3 py-2.5',
                    'transition-colors duration-100',
                    index === active && 'bg-surface-sunken',
                  )}
                >
                  {option.icon && (
                    <span
                      className={cn(
                        'grid size-8 shrink-0 place-items-center rounded-[10px] [&>svg]:size-[17px]',
                        isSelected ? 'bg-accent text-white' : 'bg-surface-sunken text-ink-soft',
                      )}
                    >
                      {option.icon}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-[15px]', isSelected ? 'font-semibold text-ink' : 'text-ink')}>
                      {option.label}
                    </span>
                    {option.hint && <span className="tnum block truncate text-[12.5px] text-ink-muted">{option.hint}</span>}
                  </span>
                  {isSelected && <Check aria-hidden className="size-[18px] shrink-0 text-accent" strokeWidth={2.5} />}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
