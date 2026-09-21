import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';

/**
 * A bottom sheet with drag-to-dismiss.
 *
 * Details that matter here and are invisible when they work:
 *  - It enters from the bottom and leaves to the bottom, so dragging down to
 *    dismiss feels like continuing a motion the sheet already started.
 *  - Dragging past the top meets increasing friction rather than a wall.
 *  - A quick flick dismisses regardless of distance, because intent is in the
 *    velocity, not the displacement.
 *  - The pointer is captured, so the drag survives leaving the element.
 */

const DISMISS_DISTANCE = 96;
const DISMISS_VELOCITY = 0.55; // px per ms
const ENTER_MS = 420;
const EXIT_MS = 240;

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Rendered in the header's trailing slot. */
  action?: ReactNode;
  children: ReactNode;
  /** Sheets that own the whole screen (the add-transaction flow). */
  fullHeight?: boolean;
  className?: string;
}

export function Sheet({ open, onClose, title, action, children, fullHeight, className }: SheetProps) {
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; startTime: number; offset: number; active: boolean } | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(frame);
    }
    setEntered(false);
    const timer = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);

  // Escape is a keyboard action: it closes immediately, without ceremony.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Lock the page behind the sheet without letting it jump.
  useEffect(() => {
    if (!mounted) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [mounted]);

  if (!mounted) return null;

  const setOffset = (value: number) => {
    const panel = panelRef.current;
    if (!panel) return;
    // Written straight onto the element: updating a CSS variable on the
    // container would recalculate styles for every child on every frame.
    panel.style.transform = `translate3d(0, ${value}px, 0)`;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.active) return; // ignore a second finger mid-drag
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    drag.current = { startY: event.clientY, startTime: Date.now(), offset: 0, active: true };
    event.currentTarget.setPointerCapture(event.pointerId);
    const panel = panelRef.current;
    if (panel) panel.style.transition = 'none';
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state?.active) return;

    const delta = event.clientY - state.startY;
    // Upward drag is allowed, but resisted — things slow down before stopping.
    state.offset = delta >= 0 ? delta : -Math.sqrt(-delta) * 3;
    setOffset(state.offset);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state?.active) return;
    state.active = false;
    event.currentTarget.releasePointerCapture(event.pointerId);

    const panel = panelRef.current;
    if (panel) panel.style.transition = '';

    const elapsed = Math.max(Date.now() - state.startTime, 1);
    const velocity = state.offset / elapsed;

    if (state.offset > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY) {
      onClose();
      return;
    }
    setOffset(0);
  };

  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <div
        onClick={onClose}
        className={cn(
          // Dim only. The panel above already runs a full-viewport
          // backdrop-filter, and stacking a second one doubles the
          // compositing cost for an effect nobody can see behind the sheet.
          'absolute inset-0 bg-[rgb(16_16_26/0.28)]',
          'transition-opacity duration-300 ease-out-strong',
          entered ? 'opacity-100' : 'opacity-0',
        )}
      />

      <div
        ref={panelRef}
        style={{ transitionDuration: entered ? `${ENTER_MS}ms` : `${EXIT_MS}ms` }}
        className={cn(
          'absolute inset-x-0 bottom-0 mx-auto w-full max-w-[560px]',
          'rounded-t-[28px] glass-strong shadow-sheet',
          'flex flex-col',
          fullHeight ? 'h-[92svh]' : 'max-h-[88svh]',
          'transition-transform ease-drawer will-change-transform',
          entered ? 'translate-y-0' : 'translate-y-full',
          className,
        )}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="shrink-0 cursor-grab touch-none pt-3 pb-1 active:cursor-grabbing"
        >
          <div className="mx-auto h-[5px] w-10 rounded-full bg-line-strong" />
        </div>

        {(title || action) && (
          <header className="flex shrink-0 items-center justify-between gap-3 px-5 pt-2 pb-3">
            <h2 className="text-[19px] font-semibold tracking-[-0.02em] text-ink">{title}</h2>
            {action}
          </header>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
