import { useEffect, useRef, useState } from 'react';

/**
 * A number that counts to its new value instead of jumping there.
 *
 * Integer in, integer out (paise stay paise). Starts from zero on first show,
 * then from wherever it was — so recording ₹500 of income visibly ticks the
 * total up. Reduced-motion users get the final value immediately.
 */
export function useCountUp(target: number | null | undefined, durationMs = 900): number | null | undefined {
  const [shown, setShown] = useState(target);
  const from = useRef(0);
  const frame = useRef(0);

  useEffect(() => {
    if (typeof target !== 'number') {
      setShown(target);
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      from.current = target;
      setShown(target);
      return;
    }

    const start = from.current;
    const began = performance.now();
    cancelAnimationFrame(frame.current);

    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / durationMs);
      // Ease-out expo: fast off the mark, settling gently on the exact value.
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      const value = Math.round(start + (target - start) * eased);
      from.current = value;
      setShown(value);
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);

    // Animation frames stop when the app is in the background or the WebView
    // is throttled. The figure on screen must never be left stale, so the
    // true value lands shortly after the animation should have finished,
    // whether or not a single frame ran.
    const settle = setTimeout(() => {
      cancelAnimationFrame(frame.current);
      from.current = target;
      setShown(target);
    }, durationMs + 80);

    return () => {
      cancelAnimationFrame(frame.current);
      clearTimeout(settle);
    };
  }, [target, durationMs]);

  return shown;
}
