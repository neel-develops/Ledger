import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { formatPaise } from '@shared/money';
import type { TransactionView } from '@shared/domain';
import { api, ApiError, newIdempotencyKey } from '../lib/api';
import { useLedger } from '../store/ledger';
import { Card, IconBadge, List, Row, SectionLabel, Skeleton } from '../components/ui/primitives';
import { Button } from '../components/ui/Button';
import { Sheet } from '../components/ui/Sheet';
import { Money } from '../components/ui/Money';
import { KIND_META } from '../lib/kinds';
import { ErrorState } from '../components/ErrorState';
import { EditTransaction } from '../components/EditTransaction';

const BUCKET_LABELS: Record<string, string> = {
  asset: 'Account',
  receivable: 'Owed to you',
  payable: 'You owe',
  expense: 'Spending',
  income: 'Income',
  equity: 'Opening / correction',
};

export function TransactionDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const refresh = useLedger((s) => s.refresh);

  const [tx, setTx] = useState<TransactionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      setTx(await api.get<TransactionView>(`/transactions/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not load that transaction.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function reverse() {
    if (!id) return;
    setReversing(true);
    try {
      await api.post(`/transactions/${id}/reverse`, { idempotencyKey: newIdempotencyKey() });
      await refresh();
      toast.success('Reversed', { description: 'The original entry is still in your history.' });
      setConfirming(false);
      navigate(-1);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'We could not reverse that. Your money was not changed.',
      );
      setReversing(false);
    }
  }

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

  const meta = tx ? KIND_META[tx.kind] : null;
  const reversed = Boolean(tx?.reversedByTransactionId);

  return (
    <div>
      <header className="flex items-center gap-2 px-1 pt-3 pb-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="-ml-2 grid size-10 place-items-center rounded-full text-ink-soft press active:scale-[0.92]"
        >
          <ArrowLeft className="size-5" />
        </button>
        <h1 className="text-[20px] font-semibold tracking-[-0.02em]">Transaction</h1>
      </header>

      <Card glass className="px-5 py-6">
        {!tx || !meta ? (
          <div className="space-y-3">
            <Skeleton className="size-12 rounded-[16px]" />
            <Skeleton className="h-9 w-40" />
          </div>
        ) : (
          <>
            <IconBadge tone={meta.tone} size="lg">
              {meta.icon}
            </IconBadge>
            <Money paise={tx.amount} size="xl" className="mt-3 block" />
            <p className="mt-1 text-[14px] text-ink-soft">
              {meta.label}
              {tx.labels.category ? ` · ${tx.labels.category}` : ''}
            </p>
            {reversed && (
              <p className="mt-3 inline-block rounded-full bg-surface-sunken px-3 py-1 text-[12.5px] font-medium text-ink-soft">
                Reversed — kept for the record
              </p>
            )}
          </>
        )}
      </Card>

      {tx && (
        <>
          <section className="mt-5">
            <SectionLabel>Details</SectionLabel>
            <List>
              {tx.labels.account && <Row title="Account" trailing={<span className="text-[15px] text-ink-soft">{tx.labels.account}</span>} />}
              {tx.labels.toAccount && <Row title="To" trailing={<span className="text-[15px] text-ink-soft">{tx.labels.toAccount}</span>} />}
              {tx.labels.pool && <Row title="Whose money" trailing={<span className="text-[15px] text-ink-soft">{tx.labels.pool}</span>} />}
              <Row
                title="Date"
                trailing={
                  <span className="text-[15px] text-ink-soft">
                    {new Date(tx.occurredAt).toLocaleString(undefined, {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                }
              />
              {tx.note && (
                <Row title="Note" subtitle={tx.note} />
              )}
              {tx.labels.people.map((person) => (
                <Row
                  key={person.id}
                  title={person.name}
                  subtitle={person.amount > 0 ? 'Owes you' : 'You owe'}
                  trailing={
                    <span className="tnum text-[15px] text-ink-soft">
                      {formatPaise(Math.abs(person.amount))}
                    </span>
                  }
                  onClick={() => navigate(`/people/${person.id}`)}
                  chevron
                />
              ))}
            </List>
          </section>

          {/*
            The double-entry view. Most people will never open it, and that is
            fine — but the app should never ask to be taken on trust.
          */}
          <section className="mt-5">
            <button
              type="button"
              onClick={() => setShowLedger((v) => !v)}
              className="px-1 pb-2 text-[13px] font-medium text-accent press active:scale-[0.97]"
            >
              {showLedger ? 'Hide' : 'Show'} the ledger entries
            </button>

            {showLedger && (
              <div className="animate-fade">
                <List>
                  {tx.entries.map((entry) => (
                    <Row
                      key={entry.id}
                      title={BUCKET_LABELS[entry.bucket] ?? entry.bucket}
                      subtitle={entry.memo ?? undefined}
                      trailing={<Money paise={entry.amount} size="sm" tone="auto" signed />}
                    />
                  ))}
                </List>
                <p className="mt-2 px-1 text-[12.5px] text-ink-faint">
                  These add up to exactly zero. That is what keeps every rupee accounted for.
                </p>
              </div>
            )}
          </section>

          {!reversed && tx.kind !== 'reversal' && (
            <section className="mt-5">
              <List>
                <Row
                  icon={<IconBadge tone="accent" size="sm"><Pencil /></IconBadge>}
                  title="Edit this transaction"
                  subtitle="Records the correction, and keeps the original"
                  onClick={() => setEditing(true)}
                />
                <Row
                  icon={<IconBadge tone="negative" size="sm"><RotateCcw /></IconBadge>}
                  title="Reverse this transaction"
                  subtitle="Writes the exact opposite. Nothing is deleted."
                  danger
                  onClick={() => setConfirming(true)}
                />
              </List>
            </section>
          )}
        </>
      )}

      {tx && (
        <EditTransaction
          open={editing}
          transaction={tx}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            navigate(-1);
          }}
        />
      )}

      <Sheet open={confirming} onClose={() => setConfirming(false)} title="Reverse this transaction?">
        <div className="space-y-4 pb-2">
          <p className="text-[15px] leading-relaxed text-ink-soft">
            We will record an equal and opposite entry, so your balances go back to where they were. The
            original stays in your history — a ledger should never forget what you believed at the time.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" block onClick={() => setConfirming(false)}>
              Keep it
            </Button>
            <Button variant="danger" block onClick={reverse} loading={reversing}>
              Reverse
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
