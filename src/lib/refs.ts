/**
 * Resolving remembered choices against what currently exists.
 *
 * The app remembers which account and category you normally pick, so a routine
 * expense needs only an amount. Those memories outlive the things they point
 * at: an account gets archived, a backup is restored, someone signs in on a
 * shared device.
 *
 * A stale id must never reach a form. A `<select>` whose value matches no
 * option renders the FIRST option instead, so the screen would show "Cash"
 * while holding a deleted account — and the save would fail citing a
 * reference the user was never shown.
 */

export interface HasId {
  id: string;
}

/**
 * The first candidate that still exists in `list`, or null.
 * Candidates are tried in priority order: explicit choice, then remembered,
 * then the workspace default.
 */
export function firstExisting(
  list: readonly HasId[],
  ...candidates: (string | null | undefined)[]
): string | null {
  for (const candidate of candidates) {
    if (candidate && list.some((item) => item.id === candidate)) return candidate;
  }
  return null;
}

/** True when a picker can actually display this value. */
export function isSelectable(list: readonly HasId[], value: string | null | undefined): boolean {
  return Boolean(value) && list.some((item) => item.id === value);
}
