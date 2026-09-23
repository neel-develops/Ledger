import { useState } from 'react';
import { DatePicker } from './ui/DatePicker';
import { X } from 'lucide-react';
import { formatPaise } from '@shared/money';
import { TextInput } from './ui/primitives';
import { filterPeople } from '../lib/people';
import { cn } from '../lib/cn';

export interface SplitRow {
  personId: string;
  /** null means "take an even share of whatever is left". */
  shareAmount: number | null;
}

/**
 * Splitting a bill between any number of people.
 *
 * Shares divide to the paisa and the remainder always lands somewhere, so the
 * parts can never quietly fail to add up to the bill. Override your own share
 * and the others re-divide; override someone else's and the running total
 * says exactly how far off you are. The form refuses to save until it
 * reconciles — a split that does not add up is a rupee that stops being
 * accounted for.
 */
export function SplitEditor({
  people,
  amount,
  myShare,
  rows,
  shares,
  onRowsChange,
  onMyShareChange,
}: {
  people: { id: string; name: string }[];
  amount: number;
  myShare: number;
  rows: SplitRow[];
  shares: { personId: string; shareAmount: number }[];
  onRowsChange: (rows: SplitRow[]) => void;
  onMyShareChange: (value: number | null) => void;
}) {
  const [query, setQuery] = useState('');

  const chosen = new Set(rows.map((r) => r.personId));
  const available = filterPeople(
    people.filter((p) => !chosen.has(p.id)),
    query,
  );

  const named = shares.reduce((sum, p) => sum + p.shareAmount, 0);
  const unassigned = amount - myShare - named;

  const rupees = (paise: number) => (paise / 100).toFixed(2);
  const toPaise = (text: string) => {
    const n = Number(text);
    return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : 0;
  };

  const add = (id: string) => {
    // A new person joins with no fixed share, so everything re-divides evenly.
    onRowsChange([...rows, { personId: id, shareAmount: null }]);
    onMyShareChange(null);
    setQuery('');
  };

  return (
    <div className="space-y-2.5 rounded-lg border border-line bg-surface p-3">
      <p className="text-[13px] font-medium text-ink-soft">Split between</p>

      <div className="flex items-center gap-2">
        <span className="size-7 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium">You</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={rupees(myShare)}
          onChange={(e) => onMyShareChange(toPaise(e.target.value))}
          className="tnum w-24 rounded-[10px] border border-line-strong px-2.5 py-1.5 text-right text-[15px] focus:border-accent focus:outline-none"
          aria-label="Your share in rupees"
        />
      </div>

      {rows.map((row, index) => {
        const person = people.find((p) => p.id === row.personId);
        return (
          <div key={row.personId} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onRowsChange(rows.filter((r) => r.personId !== row.personId))}
              aria-label={`Remove ${person?.name ?? 'person'} from the split`}
              className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-sunken text-ink-muted press active:scale-[0.9]"
            >
              <X className="size-3.5" />
            </button>
            <span className="min-w-0 flex-1 truncate text-[15px]">{person?.name ?? 'Unknown'}</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={rupees(shares[index]?.shareAmount ?? 0)}
              onChange={(e) =>
                onRowsChange(
                  rows.map((r) =>
                    r.personId === row.personId ? { ...r, shareAmount: toPaise(e.target.value) } : r,
                  ),
                )
              }
              className="tnum w-24 rounded-[10px] border border-line-strong px-2.5 py-1.5 text-right text-[15px] focus:border-accent focus:outline-none"
              aria-label={`${person?.name ?? 'Person'} share in rupees`}
            />
          </div>
        );
      })}

      {amount > 0 && rows.length > 0 && (
        <p className={cn('text-[12.5px]', unassigned === 0 ? 'text-ink-muted' : 'text-negative')}>
          {unassigned === 0
            ? `Adds up to ${formatPaise(amount)}`
            : unassigned > 0
              ? `${formatPaise(unassigned)} still unassigned`
              : `${formatPaise(-unassigned)} over the total`}
        </p>
      )}

      <TextInput
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={rows.length === 0 ? 'Who did you split with?' : 'Add someone else'}
        autoComplete="off"
        className="h-10 text-[15px]"
      />

      {available.length > 0 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {available.slice(0, 20).map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => add(person.id)}
              className="h-9 shrink-0 rounded-full border border-line-strong bg-surface px-3.5 text-[14px] font-medium text-ink-soft transition-transform duration-[140ms] ease-out-strong active:scale-[0.96]"
            >
              {person.name}
            </button>
          ))}
        </div>
      )}

      {query.trim() && available.length === 0 && (
        <p className="text-[13px] text-ink-muted">
          Nobody called “{query.trim()}”. Add them from the People tab first.
        </p>
      )}
    </div>
  );
}

/**
 * When it happened.
 *
 * Defaults to now and stays out of the way, but a ledger you cannot backdate
 * is one you stop trusting the first time you record something a day late.
 * Future dates are refused — you cannot have spent money you have not spent.
 */
export function DateField({ value, onChange }: { value: Date; onChange: (value: Date) => void }) {
  return <DatePicker value={value} onChange={onChange} />;
}
