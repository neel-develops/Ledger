import type { TransactionView } from '@shared/domain';

/** "Today" / "Yesterday" / "Mon, 22 Sep" — the grouping the timeline uses. */
export function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, yesterday)) return 'Yesterday';

  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/**
 * Group an already-sorted list into day sections. It relies on the server's
 * ordering rather than re-sorting, so what you see matches what was asked for.
 */
export function groupByDay(items: TransactionView[]): { label: string; items: TransactionView[] }[] {
  const groups: { label: string; items: TransactionView[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.occurredAt);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}
