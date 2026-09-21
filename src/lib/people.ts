export interface PickablePerson {
  id: string;
  name: string;
}

/**
 * Ordering and filtering for the person picker.
 *
 * These are separate from the component because of the bug they exist to
 * prevent: the picker used to render `people.slice(0, 10)`, so once you knew
 * more than ten people the ones at the end of the alphabet were simply
 * unreachable — no search, no overflow affordance, no hint that anything was
 * missing. The form behaved as though those people did not exist.
 *
 * The rule is: ordering may change what comes first, and filtering may narrow
 * by what the user typed, but nothing else is ever allowed to drop a person.
 */

/** Recently used first; everyone else keeps their incoming (alphabetical) order. */
export function orderPeople<T extends PickablePerson>(
  people: readonly T[],
  recentIds: readonly string[],
): T[] {
  const rank = new Map(recentIds.map((id, i) => [id, i]));
  // Array.prototype.sort is stable, so equal ranks preserve the server order.
  return [...people].sort(
    (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

/** Case-insensitive substring match. An empty query matches everyone. */
export function filterPeople<T extends PickablePerson>(people: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...people];
  return people.filter((p) => p.name.toLowerCase().includes(needle));
}

/** An exact name match, so typing a known name never creates a duplicate. */
export function findByExactName<T extends PickablePerson>(
  people: readonly T[],
  name: string,
): T | undefined {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  return people.find((p) => p.name.toLowerCase() === needle);
}
