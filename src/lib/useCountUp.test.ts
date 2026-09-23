// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCountUp } from './useCountUp';

describe('useCountUp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    // Frames never arrive — the throttled / backgrounded case.
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('still lands on the exact value when no animation frame ever runs', () => {
    const { result, rerender } = renderHook(({ value }) => useCountUp(value, 900), {
      initialProps: { value: 10_000 as number | null },
    });
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current).toBe(10_000);

    rerender({ value: 60_000 });
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current).toBe(60_000);
  });

  it('passes an unknown value straight through', () => {
    const { result } = renderHook(() => useCountUp(null));
    expect(result.current).toBeNull();
  });
});
