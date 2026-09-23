import { formatPaise } from '@shared/money';
import type { TransactionView } from '@shared/domain';

/**
 * A friendly nudge to someone who owes you.
 *
 * Written the way you would actually text a friend: first name, the amount,
 * what it was for if we know, and no pressure. It is only ever a starting
 * point — it opens in WhatsApp (or whatever you share to) for you to edit
 * before anything is sent. The app never messages anyone itself.
 */

/** Transactions that ADD to what someone owes you. */
const OWED_KINDS = new Set(['lend', 'paid_for_someone']);

export function buildReminder(
  person: { id: string; name: string; netBalance: number },
  history: TransactionView[],
): string | null {
  if (person.netBalance <= 0) return null;

  const firstName = person.name.trim().split(/\s+/)[0] || person.name;
  const total = formatPaise(person.netBalance);

  // The most recent thing that created the debt, to jog their memory.
  const latest = history.find(
    (t) => OWED_KINDS.has(t.kind) && !t.reversedByTransactionId && t.labels.people.some((p) => p.id === person.id),
  );

  let reason = '';
  if (latest) {
    const what = (latest.note ?? latest.labels.category ?? '').trim();
    const when = new Date(latest.occurredAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const share = latest.labels.people.find((p) => p.id === person.id)?.amount ?? 0;
    // Only mention the item when it is the whole story; otherwise the total
    // is what matters and a single line item would be misleading.
    if (share === person.netBalance) {
      reason = what ? ` for ${lowerFirst(what)} on ${when}` : ` from ${when}`;
    }
  }

  return `Hey ${firstName}! Just a gentle reminder about the ${total}${reason}. No rush — whenever you get a chance 🙂`;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/**
 * Hand the text to the phone. The native share sheet lets you pick WhatsApp
 * and the contact; where that is unavailable, WhatsApp's own link opens with
 * the message filled in and you choose who it goes to.
 */
export async function sendReminder(text: string): Promise<'shared' | 'opened' | 'cancelled'> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (error) {
      // The user closing the sheet is a choice, not a failure.
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  return 'opened';
}
