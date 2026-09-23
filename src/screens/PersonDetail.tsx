import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Archive, ArrowLeft, HandCoins, MessageCircle, Receipt, Scale } from 'lucide-react';
import { buildReminder, sendReminder } from '../lib/reminder';
import { formatPaise } from '@shared/money';
import type { TransactionView } from '@shared/domain';
import { toast } from 'sonner';
import { api, ApiError } from '../lib/api';
import { useLedger } from '../store/ledger';
import { Avatar, Card, EmptyState, IconBadge, List, Row, SectionLabel, Skeleton } from '../components/ui/primitives';
import { Money } from '../components/ui/Money';
import { TransactionRow } from '../components/TransactionRow';
import { groupByDay } from '../lib/dates';
import { ErrorState } from '../components/ErrorState';
import { Button } from '../components/ui/Button';
import { AddTransaction } from '../components/AddTransaction';
import type { TransactionDraft } from '@shared/nlp';

interface PersonLedger {
  person: {
    id: string;
    name: string;
    relation: string | null;
    note: string | null;
    receivable: number;
    payable: number;
    netBalance: number;
  };
  transactions: TransactionView[];
  nextCursor: string | null;
}

export function PersonDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<PersonLedger | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const version = useLedger((s) => s.version);
  const refresh = useLedger((s) => s.refresh);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      setData(await api.get<PersonLedger>(`/people/${id}/ledger`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not load this person.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, version]);

  useEffect(() => {
    void load();
  }, [load]);

  const net = data?.person.netBalance ?? 0;

  /**
   * Settling is the other half of lending, and it belongs here rather than
   * three taps into a generic sheet. The direction and the amount are both
   * already known, so the form opens with nothing left to decide.
   */
  const settleDraft = useMemo<TransactionDraft | null>(() => {
    if (!data || net === 0) return null;
    return {
      kind: net > 0 ? 'settle_receivable' : 'settle_payable',
      amount: Math.abs(net),
      personId: data.person.id,
      personName: data.person.name,
      unknownPersonName: null,
      categoryId: null,
      accountId: null,
      poolId: null,
      toAccountId: null,
      toPoolId: null,
      note: null,
      confidence: 'high',
      missing: [],
    };
  }, [data, net]);

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

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
        <h1 className="truncate text-[20px] font-semibold tracking-[-0.02em]">
          {data?.person.name ?? ' '}
        </h1>
      </header>

      <Card glass className="flex items-center gap-4 px-5 py-5">
        {data ? <Avatar name={data.person.name} size={52} /> : <Skeleton className="size-[52px] rounded-full" />}
        <div className="min-w-0 flex-1">
          {data ? (
            <>
              <p className="text-[13px] text-ink-soft">
                {data.person.netBalance > 0
                  ? 'Owes you'
                  : data.person.netBalance < 0
                    ? 'You owe'
                    : 'All settled'}
              </p>
              <Money
                paise={Math.abs(data.person.netBalance)}
                size="xl"
                tone={
                  data.person.netBalance > 0 ? 'positive' : data.person.netBalance < 0 ? 'negative' : 'neutral'
                }
                className="mt-0.5"
              />
              {/* Both directions stay visible — netting is a headline, not a rewrite. */}
              {data.person.receivable > 0 && data.person.payable > 0 && (
                <p className="mt-1 text-[12.5px] text-ink-muted">
                  {formatPaise(data.person.receivable)} owed to you · {formatPaise(data.person.payable)} owed
                  by you
                </p>
              )}
            </>
          ) : (
            <div className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-32" />
            </div>
          )}
        </div>
      </Card>

      {data && net !== 0 && (
        <div className="mt-4">
          <Button
            block
            size="lg"
            icon={net > 0 ? <HandCoins className="size-[18px]" /> : <Scale className="size-[18px]" />}
            onClick={() => setSettling(true)}
          >
            {net > 0
              ? `${data.person.name} paid me back`
              : `Pay ${data.person.name} back`}
          </Button>
          {net > 0 && (
            <Button
              block
              size="lg"
              variant="secondary"
              className="mt-2"
              icon={<MessageCircle className="size-[18px]" />}
              onClick={async () => {
                const text = buildReminder(data.person, data.transactions);
                if (!text) return;
                const outcome = await sendReminder(text);
                if (outcome === 'opened') toast('Opened WhatsApp — pick who to send it to.');
              }}
            >
              Remind {data.person.name.split(/\s+/)[0]}
            </Button>
          )}
          <p className="mt-2 text-center text-[12.5px] text-ink-muted">
            {net > 0
              ? 'The reminder opens in WhatsApp for you to edit before it goes anywhere.'
              : `Opens with ${formatPaise(Math.abs(net))} filled in — change it for a part payment.`}
          </p>
        </div>
      )}

      <section className="mt-5">
        <SectionLabel>History</SectionLabel>
        {!data ? (
          <div className="card divide-y divide-line">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <Skeleton className="size-10 rounded-[14px]" />
                <Skeleton className="h-3.5 w-32 flex-1" />
                <Skeleton className="h-4 w-14" />
              </div>
            ))}
          </div>
        ) : data.transactions.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Receipt />}
              title="Nothing between you yet"
              description={`Start tracking your transactions with ${data.person.name}.`}
            />
          </Card>
        ) : (
          <div className="space-y-5">
            {groupByDay(data.transactions).map((group) => (
              <div key={group.label}>
                <SectionLabel>{group.label}</SectionLabel>
                <List>
                  <div className="divide-y divide-line">
                    {group.items.map((tx) => (
                      <TransactionRow key={tx.id} transaction={tx} hidePerson />
                    ))}
                  </div>
                </List>
              </div>
            ))}
          </div>
        )}
      </section>

      {data && (
        <section className="mt-5">
          <List>
            <Row
              icon={<IconBadge tone="neutral" size="sm"><Archive /></IconBadge>}
              title={`Archive ${data.person.name}`}
              subtitle={
                net === 0
                  ? 'Hides them. Their history is kept.'
                  : 'Settle what is outstanding first'
              }
              onClick={async () => {
                try {
                  await api.delete(`/people/${data.person.id}`);
                  await refresh();
                  toast.success(`${data.person.name} archived`, {
                    description: 'Their history is kept. Nothing was deleted.',
                  });
                  navigate('/people');
                } catch (err) {
                  toast.error(
                    err instanceof ApiError ? err.message : 'We could not archive them.',
                  );
                }
              }}
            />
          </List>
        </section>
      )}

      <AddTransaction
        open={settling}
        onClose={() => {
          setSettling(false);
          void load();
        }}
        initialDraft={settleDraft}
      />
    </div>
  );
}

