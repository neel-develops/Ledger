import { useNavigate } from 'react-router-dom';
import { formatPaise } from '@shared/money';
import type { TransactionView } from '@shared/domain';
import { KIND_HUES, KIND_META } from '../lib/kinds';
import { usePrefs } from '../store/prefs';
import { cn } from '../lib/cn';

/**
 * One line in the timeline.
 *
 * The amount carries a sign only when direction is meaningful. A transfer has
 * no sign, because nothing was gained or lost — that restraint is the whole
 * point of the accounting model showing through.
 */
export function TransactionRow({
  transaction,
  hidePerson,
}: {
  transaction: TransactionView;
  hidePerson?: boolean;
}) {
  const navigate = useNavigate();
  const hidden = usePrefs((s) => s.balancesHidden);
  const meta = KIND_META[transaction.kind];
  const reversed = Boolean(transaction.reversedByTransactionId);

  const { title, subtitle } = describe(transaction, hidePerson);

  const sign = meta.direction === 'out' ? '−' : meta.direction === 'in' ? '+' : '';
  const amountTone =
    meta.direction === 'in' ? 'text-positive' : meta.direction === 'out' ? 'text-ink' : 'text-ink-soft';

  return (
    <button
      type="button"
      onClick={() => navigate(`/transaction/${transaction.id}`)}
      className={cn(
        'hoverable flex w-full items-center gap-3 bg-surface px-4 py-3.5 text-left',
        'transition-[background-color,transform] duration-[140ms] ease-out-strong',
        'active:scale-[0.985] active:bg-surface-sunken',
        reversed && 'opacity-55',
      )}
    >
      <span
        style={{ '--tone': KIND_HUES[transaction.kind] } as React.CSSProperties}
        className="tone-icon grid size-10 shrink-0 place-items-center rounded-[14px] [&>svg]:size-[19px]"
      >
        {meta.icon}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-[15px] font-medium text-ink',
            reversed && 'line-through decoration-ink-faint',
          )}
        >
          {title}
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-ink-muted">
          {reversed ? 'Reversed' : subtitle || meta.label}
        </span>
      </span>

      <span className="shrink-0 text-right">
        <span className={cn('tnum block text-[15px] font-semibold', amountTone, meta.direction === 'in' && 'glow-positive')}>
          {hidden ? '••••' : `${sign}${formatPaise(transaction.amount)}`}
        </span>
        {transaction.labels.people.length > 1 && !hidePerson && (
          <span className="mt-0.5 block text-[12px] text-ink-muted">
            {transaction.labels.people.length} people
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * The two lines of a row, decided together.
 *
 * The subtitle exists to say what the title left out — so a pool move that is
 * titled "Dad money → My money" is subtitled with the account it sat in, not
 * with the pool it already named.
 */
function describe(
  transaction: TransactionView,
  hidePerson?: boolean,
): { title: string; subtitle: string } {
  const { kind, labels, note } = transaction;
  const person = labels.people[0]?.name;
  const place = [labels.account, labels.pool].filter(Boolean).join(' · ');

  const row = (title: string, subtitle = place) => ({ title, subtitle });

  switch (kind) {
    case 'expense':
    case 'refund':
      return row(labels.category ?? note ?? KIND_META[kind].label);
    case 'income':
      return row(labels.category ?? note ?? 'Received');
    case 'transfer': {
      // Moving Dad's money into your own leaves the cash exactly where it is,
      // so naming the accounts would read "Cash → Cash". Name what changed,
      // and let the subtitle carry the rest.
      if (labels.toAccount && labels.account !== labels.toAccount) {
        return row(`${labels.account} → ${labels.toAccount}`, labels.pool ?? '');
      }
      if (labels.toPool && labels.pool !== labels.toPool) {
        return row(`${labels.pool} → ${labels.toPool}`, labels.account ?? '');
      }
      return row('Transfer');
    }
    case 'paid_for_someone':
      return row(hidePerson || !person ? 'Paid a shared bill' : `Paid for ${person}`);
    case 'lend':
      return row(hidePerson || !person ? 'Lent money' : `Lent to ${person}`);
    case 'borrow':
      return row(hidePerson || !person ? 'Borrowed money' : `Borrowed from ${person}`);
    case 'settle_receivable':
      return row(hidePerson || !person ? 'Repaid to me' : `${person} paid you back`);
    case 'settle_payable':
      return row(hidePerson || !person ? 'Debt settled' : `Paid ${person} back`);
    case 'someone_paid_for_me':
      return row(hidePerson || !person ? 'Someone paid for me' : `${person} paid for you`);
    default:
      return row(note ?? KIND_META[kind].label);
  }
}
