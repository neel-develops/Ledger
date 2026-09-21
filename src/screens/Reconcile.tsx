import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { formatPaise, parseRupeesToPaise } from '@shared/money';
import { useLedger } from '../store/ledger';
import { Sheet } from '../components/ui/Sheet';
import { Button } from '../components/ui/Button';
import { Field, TextInput } from '../components/ui/primitives';
import { Money } from '../components/ui/Money';
import { api, ApiError } from '../lib/api';
import type { ReconciliationResult } from '../lib/types';

/**
 * Cash check.
 *
 * Count what is actually in your pocket, and the app tells you how far the
 * ledger has drifted. It will not quietly fix the gap: either you go and find
 * the missing transaction, or you record an adjustment that says out loud
 * that a gap existed.
 */
export function CashCheckSheet({ accountId, onClose }: { accountId: string | null; onClose: () => void }) {
  const accounts = useLedger((s) => s.accounts) ?? [];
  const refresh = useLedger((s) => s.refresh);
  const account = accounts.find((a) => a.id === accountId);

  const [actual, setActual] = useState('');
  const [result, setResult] = useState<ReconciliationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (accountId) {
      setActual('');
      setResult(null);
      setError(null);
    }
  }, [accountId]);

  const actualPaise = parseRupeesToPaise(actual);
  const expected = account?.balance ?? null;
  const difference = actualPaise !== null && expected !== null ? actualPaise - expected : null;

  async function check(createAdjustment: boolean) {
    if (!accountId || actualPaise === null) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await api.post<ReconciliationResult>('/reconciliation', {
        accountId,
        actualAmount: actualPaise,
        createAdjustment,
      });
      setResult(outcome);
      if (createAdjustment && outcome.adjustmentTransactionId) {
        await refresh();
        toast.success('Adjustment recorded', {
          description: `${account?.name} now matches your count.`,
        });
        onClose();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not run that check.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={Boolean(accountId)} onClose={onClose} title={`Cash check · ${account?.name ?? ''}`}>
      <div className="space-y-4 pb-2">
        <div className="card divide-y divide-line">
          <div className="flex items-center justify-between px-4 py-3.5">
            <span className="text-[15px] text-ink-soft">Expected</span>
            <Money paise={expected} size="md" />
          </div>
          <div className="flex items-center justify-between px-4 py-3.5">
            <span className="text-[15px] text-ink-soft">Actual</span>
            <span className="tnum text-[17px] font-medium">
              {actualPaise !== null ? formatPaise(actualPaise) : '—'}
            </span>
          </div>
          {difference !== null && (
            <div className="animate-fade flex items-center justify-between px-4 py-3.5">
              <span className="text-[15px] font-medium">Difference</span>
              <Money paise={difference} size="md" tone="auto" signed />
            </div>
          )}
        </div>

        <Field label="What did you count?" hint="Enter the amount actually there, right now.">
          <TextInput
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            autoFocus
            className="tnum"
          />
        </Field>

        {difference === 0 && actualPaise !== null && (
          <p className="animate-fade rounded-md bg-positive-soft px-4 py-3 text-[14px] text-positive">
            Everything matches. Nothing to correct.
          </p>
        )}

        {result && !result.adjustmentTransactionId && result.differenceAmount !== 0 && (
          <p className="animate-fade rounded-md bg-surface-sunken px-4 py-3 text-[13.5px] leading-relaxed text-ink-soft">
            Nothing has been changed. Look for a missing transaction first — an adjustment should be the last
            resort, not the first.
          </p>
        )}

        {error && <p className="text-[13px] text-negative">{error}</p>}

        <div className="flex gap-2">
          <Button
            variant="secondary"
            block
            onClick={() => void check(false)}
            loading={busy && !result}
            disabled={actualPaise === null}
          >
            Check only
          </Button>
          <Button
            block
            onClick={() => void check(true)}
            disabled={actualPaise === null || difference === 0 || difference === null}
          >
            Create adjustment
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
