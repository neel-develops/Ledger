export type ThemePreference = 'light' | 'dark' | 'system';

/**
 * Applying the theme.
 *
 * The chosen theme is written to `<html data-theme>`, which flips the CSS
 * variables everything else is built from. Transitions are suppressed for a
 * frame while it happens — a whole-app repaint fading between two palettes
 * reads as a rendering fault, not as polish.
 *
 * The browser chrome is told too, so the status bar and the area behind a
 * rubber-band scroll match the canvas instead of flashing white.
 */

const DARK_CANVAS = '#0b0c10';
const LIGHT_CANVAS = '#f6f6f8';

export function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference !== 'system') return preference;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(preference: ThemePreference): void {
  if (typeof document === 'undefined') return;

  const resolved = resolveTheme(preference);
  const root = document.documentElement;

  root.setAttribute('data-theme-changing', '');
  root.setAttribute('data-theme', resolved);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? DARK_CANVAS : LIGHT_CANVAS);

  // One frame is enough for the repaint to land un-animated.
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => root.removeAttribute('data-theme-changing'));
  });
}

/** Follow the OS while the preference is "system". Returns an unsubscribe. */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
