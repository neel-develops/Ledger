import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Places a floating panel against the field that opened it — below when it
 * fits, otherwise on whichever side has more room — and caps its height to
 * that room so it never runs off the screen. Also closes it on an outside
 * tap or when the page scrolls (the panel itself may scroll).
 */

export interface PopoverPlace {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
  origin: 'top' | 'bottom';
}

const GAP = 6;
const EDGE = 12;

export function useAnchoredPopover({
  open,
  trigger,
  panel,
  onDismiss,
  wantedHeight,
  maxHeight,
  minWidth = 200,
}: {
  open: boolean;
  trigger: RefObject<HTMLElement | null>;
  panel: RefObject<HTMLElement | null>;
  onDismiss: () => void;
  /** Roughly how tall the panel would like to be; only used to choose a side. */
  wantedHeight: number;
  maxHeight: number;
  minWidth?: number;
}): PopoverPlace | null {
  const [place, setPlace] = useState<PopoverPlace | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const measure = () => {
      const box = trigger.current?.getBoundingClientRect();
      if (!box) return;
      const width = Math.min(Math.max(box.width, minWidth), window.innerWidth - 16);
      const left = Math.min(Math.max(8, box.left), window.innerWidth - width - 8);
      const below = window.innerHeight - box.bottom - GAP - EDGE;
      const above = box.top - GAP - EDGE;
      const wanted = Math.min(maxHeight, wantedHeight);
      setPlace(
        below >= wanted || below >= above
          ? { left, width, top: box.bottom + GAP, maxHeight: Math.min(maxHeight, below), origin: 'top' }
          : {
              left,
              width,
              bottom: window.innerHeight - box.top + GAP,
              maxHeight: Math.min(maxHeight, above),
              origin: 'bottom',
            },
      );
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, trigger, wantedHeight, maxHeight, minWidth]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) onDismiss();
    };
    const onScroll = (event: Event) => {
      if (!panel.current?.contains(event.target as Node)) onDismiss();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open, trigger, panel, onDismiss]);

  return place;
}
