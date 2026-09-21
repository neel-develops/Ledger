import { useState } from 'react';
import { toast } from 'sonner';
import { formatPaise, parseRupeesToPaise } from '@shared/money';
import type { TransactionView } from '@shared/domain';
import { Sheet } from './ui/Sheet';
import { Button } from './ui/Button';
import { Field, TextInput } from './ui/primitives';
import { DateField } from './SplitEditor';
import { api, ApiError, newIdempotencyKey } from '../lib/api';
import { useLedger } from '../store/ledger';
import { KIND_META } from '../lib/kinds';

/**
 * Correcting a transaction.
 *
 * Only the three things people actually get wrong are editable: the amount,
 * the note and the date. Changing what KIND of thing happened, or who it was
 * with, is a different event — reverse it and record the right one, so the
 * history says what you believed at each point.
 *
 * The server does the work as a single atomic replace: the original is
 * reversed and the corrected version written together, or neither is.
 */
export function EditTransaction({
  open,
  transaction,
  onClose,
  onSaved,
}: {
  open: boolean;
  transaction: TransactionView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const refresh = useLedger((s) => s.refresh);

  const [amount, setAmount] = useState((transaction.amount / 100).toFixed(2));
  const [note, setNote] = useState(transaction.note ?? '');
  const [occurredAt, setOccurredAt] = useState(new Date(transaction.occurredAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paise = parseRupeesToPaise(amount);
  const unchanged =
    paise === transaction.amount &&
    note.trim() === (transaction.note ?? '').trim() &&
    occurredAt.toISOString() === transaction.occurredAt;

  async function save() {
    if (paise === null || paise <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    setSaving(true);
    setError(null);

    try {
      // Rebuild the original payload from its own entries, changing only what
      // the user edited — so nothing else about the transaction drifts.
      const asset = transaction.entries.filter((e) => e.bucket === 'asset');
      const outgoing = asset.find((e) => e.amount < 0);
      const incoming = asset.find((e) => e.amount > 0);
      const person = transaction.entries.find((e) => e.personId)?.personId;
      const category = transaction.entries.find((e) => e.categoryId)?.categoryId;

      const ratio = paise / transaction.amount;
      const participants = transaction.entries
        .filter((e) => e.bucket === 'receivable' && e.personId)
        .map((e) => ({ personId: e.personId as string, shareAmount: Math.round(e.amount * ratio) }));
      const myShare = paise - participants.reduce((sum, p) => sum + p.shareAmount, 0);

      const payload: Record<string, unknown> = {
        kind: transaction.kind,
        amount: paise,
        occurredAt: occurredAt.toISOString(),
        note: note.trim() || null,
        idempotencyKey: newIdempotencyKey(),
        accountId: outgoing?.accountId ?? null,
        poolId: outgoing?.poolId ?? null,
        toAccountId: incoming?.accountId ?? null,
        toPoolId: incoming?.poolId ?? null,
        categoryId: category ?? null,
      };

      if (person) payload.personId = person;
      if (transaction.kind === 'paid_for_someone') {
        payload.participants = participants;
        payload.myShare = Math.max(0, myShare);
      }
      if (transaction.kind === 'lend' || transaction.kind === 'borrow') {
        payload.withoutCashMovement = asset.length === 0;
      }

      await api.put(`/transactions/${transaction.id}`, payload);
      await refresh();
      toast.success('Corrected', { description: 'The original is still in your history.' });
      onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'We could not save that correction. Nothing was changed.',
      );
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Edit ${KIND_META[transaction.kind].label.toLowerCase()}`}>
      <div className="space-y-4 pb-2">
        <Field label="Amount" hint={`Was ${formatPaise(transaction.amount)}`}>
          <TextInput
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="tnum"
            autoFocus
          />
        </Field>

        <Field label="Note">
          <TextInput
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional"
            maxLength={200}
          />
        </Field>

        <DateField value={occurredAt} onChange={setOccurredAt} />

        <p className="rounded-md bg-surface-sunken px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-soft">
          Saving reverses the original and records the corrected version. Both stay in your history, so the
          books still show what you believed at the time.
        </p>

        {error && (
          <p role="alert" className="rounded-md bg-negative-soft px-3.5 py-2.5 text-[13.5px] text-negative">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button variant="secondary" block onClick={onClose}>
            Cancel
          </Button>
          <Button block onClick={save} loading={saving} disabled={unchanged || paise === null}>
            {unchanged ? 'No changes' : 'Save correction'}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
