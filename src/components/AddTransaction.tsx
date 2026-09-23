import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatPaise } from '@shared/money';
import { parseTransaction, NLP_EXAMPLES, type TransactionDraft } from '@shared/nlp';
import type { TransactionKind } from '@shared/domain';
import { Sheet } from './ui/Sheet';
import { Button } from './ui/Button';
import { AmountPad } from './AmountPad';
import { Avatar, IconBadge, TextInput, Segmented } from './ui/primitives';
import { SplitEditor, DateField, type SplitRow } from './SplitEditor';
import { computeSplit } from '../lib/split';
import { KIND_META, SAVINGS_ACTION } from '../lib/kinds';
import { useLedger, useDefaults } from '../store/ledger';
import { usePrefs } from '../store/prefs';
import { ApiError } from '../lib/api';
import type { CreateTransactionPayload } from '../lib/types';
import { firstExisting, isSelectable } from '../lib/refs';
import { orderPeople, filterPeople, findByExactName } from '../lib/people';
import { cn } from '../lib/cn';
import { SavingsPeek } from './SavingsGuard';
import { savingsWithdrawal } from '../lib/savings';
import { useSavingsAlarm } from '../lib/useSavingsAlarm';

/**
 * The add-transaction flow.
 *
 * Step 1 picks what happened. Step 2 is amount + the one or two details that
 * kind actually needs, with everything else defaulted from what you normally
 * pick. A plain expense is: tap +, tap Expense, type the amount, Save.
 */

type Step = 'pick' | 'entry';

/** The seven things the quick-action sheet offers, in designed order. */
const QUICK_ACTIONS: { id: string; kind: TransactionKind; savings?: boolean }[] = [
  { id: 'expense', kind: 'expense' },
  { id: 'income', kind: 'income' },
  { id: 'transfer', kind: 'transfer' },
  { id: 'lend', kind: 'lend' },
  { id: 'borrow', kind: 'borrow' },
  { id: 'settle_receivable', kind: 'settle_receivable' },
  { id: 'settle_payable', kind: 'settle_payable' },
  { id: 'paid_for_someone', kind: 'paid_for_someone' },
  { id: 'savings', kind: 'transfer', savings: true },
  // How you tell the app what you already had. Booked against opening equity,
  // so it never shows up as income you earned.
  { id: 'opening_balance', kind: 'opening_balance' },
];

export function AddTransaction({
  open,
  onClose,
  /**
   * Opens straight into a filled-in form instead of the picker. Used where the
   * app already knows what you are about to do — settling up from a person's
   * own screen, say — so the action lives next to the thing it acts on.
   */
  initialDraft,
}: {
  open: boolean;
  onClose: () => void;
  initialDraft?: TransactionDraft | null;
}) {
  const [step, setStep] = useState<Step>(initialDraft ? 'entry' : 'pick');
  const [kind, setKind] = useState<TransactionKind>(initialDraft?.kind ?? 'expense');
  const [savingsMode, setSavingsMode] = useState(false);
  const [draft, setDraft] = useState<TransactionDraft | null>(initialDraft ?? null);

  useEffect(() => {
    if (open && initialDraft) {
      setKind(initialDraft.kind);
      setDraft(initialDraft);
      setSavingsMode(false);
      setStep('entry');
    }
    // A new draft object each open is the signal; its identity is the dep.
  }, [open, initialDraft]);

  useEffect(() => {
    if (!open) {
      // Reset only after the exit animation, so the sheet does not visibly
      // change content while it is sliding away.
      const timer = setTimeout(() => {
        setStep(initialDraft ? 'entry' : 'pick');
        setDraft(initialDraft ?? null);
        setSavingsMode(false);
      }, 260);
      return () => clearTimeout(timer);
    }
  }, [open, initialDraft]);

  const start = (next: TransactionKind, savings = false) => {
    setKind(next);
    setSavingsMode(savings);
    setDraft(null);
    setStep('entry');
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      fullHeight
      title={step === 'pick' ? 'What happened?' : savingsMode ? 'Move to savings' : KIND_META[kind].label}
      action={
        step === 'entry' ? (
          <button
            type="button"
            onClick={() => setStep('pick')}
            className="text-[15px] font-medium text-accent press active:scale-[0.97]"
          >
            Change
          </button>
        ) : (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-9 place-items-center rounded-full bg-surface-sunken text-ink-soft press active:scale-[0.94]"
          >
            <X className="size-4" />
          </button>
        )
      }
    >
      {step === 'pick' ? (
        <KindPicker
          onPick={start}
          onDraft={(parsed) => {
            setKind(parsed.kind);
            setDraft(parsed);
            setSavingsMode(false);
            setStep('entry');
          }}
        />
      ) : (
        <EntryForm
          kind={kind}
          savingsMode={savingsMode}
          draft={draft}
          onDone={onClose}
        />
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ *
 * Step 1 — pick a kind, or just type a sentence
 * ------------------------------------------------------------------ */

function KindPicker({
  onPick,
  onDraft,
}: {
  onPick: (kind: TransactionKind, savings?: boolean) => void;
  onDraft: (draft: TransactionDraft) => void;
}) {
  const [text, setText] = useState('');
  const people = useLedger((s) => s.people);
  const categories = useLedger((s) => s.categories);
  const accounts = useLedger((s) => s.accounts);
  const pools = useLedger((s) => s.pools);
  const rankKinds = usePrefs((s) => s.rankKinds);

  const actions = useMemo(() => {
    const order = rankKinds(QUICK_ACTIONS.map((a) => a.kind));
    return [...QUICK_ACTIONS].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  }, [rankKinds]);

  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    return parseTransaction(text, {
      people: (people ?? []).map((p) => ({ id: p.id, name: p.name, netBalance: p.netBalance })),
      categories: categories ?? [],
      accounts: accounts ?? [],
      pools: (pools ?? []).map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
    });
  }, [text, people, categories, accounts, pools]);

  const placeholder = useMemo(
    () => `e.g. ${NLP_EXAMPLES[Math.floor(Math.random() * NLP_EXAMPLES.length)]}`,
    [],
  );

  return (
    <div className="pb-4">
      <div className="stagger space-y-2">
        {actions.map((action) => {
          const meta = action.savings ? SAVINGS_ACTION : KIND_META[action.kind];
          return (
            <button
              key={action.id}
              type="button"
              onClick={() => onPick(action.kind, action.savings)}
              className={cn(
                'flex w-full items-center gap-3.5 rounded-xl px-4 py-3.5 text-left',
                'border border-[color-mix(in_srgb,white_60%,transparent)]',
                'bg-[color-mix(in_srgb,white_74%,transparent)]',
                'transition-[transform,background-color] duration-[140ms] ease-out-strong',
                'active:scale-[0.985] active:bg-[color-mix(in_srgb,white_92%,transparent)]',
              )}
            >
              <IconBadge tone={meta.tone}>{meta.icon}</IconBadge>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-medium text-ink">{meta.label}</span>
                <span className="block text-[13px] text-ink-muted">{meta.description}</span>
              </span>
              <ChevronRight className="size-4 text-ink-faint" aria-hidden />
            </button>
          );
        })}
      </div>

      {/* Smart entry. It never saves on its own — it opens a filled-in form. */}
      <div className="mt-6">
        <p className="mb-2 px-1 text-[13px] text-ink-muted">Or type it in plain words</p>
        <div className="relative">
          <Sparkles
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
            aria-hidden
          />
          <TextInput
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && parsed) onDraft(parsed);
            }}
            placeholder={placeholder}
            className="pl-10"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
          />
        </div>

        {text.trim() && (
          <div className="animate-fade mt-2">
            {parsed ? (
              <button
                type="button"
                onClick={() => onDraft(parsed)}
                className="flex w-full items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-left press active:scale-[0.985]"
              >
                <IconBadge tone={KIND_META[parsed.kind].tone} size="sm">
                  {KIND_META[parsed.kind].icon}
                </IconBadge>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium">
                    {parsed.amount !== null ? formatPaise(parsed.amount) : 'Amount needed'} ·{' '}
                    {KIND_META[parsed.kind].label}
                  </span>
                  <span className="block truncate text-[13px] text-ink-muted">
                    {parsed.missing.length > 0
                      ? `Still needs ${parsed.missing.join(' and ')}`
                      : 'Review and confirm'}
                  </span>
                </span>
                <ChevronRight className="size-4 text-ink-faint" aria-hidden />
              </button>
            ) : (
              <p className="px-1 text-[13px] text-ink-muted">
                Not sure what that means yet — pick an action above.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Step 2 — amount and the details this kind needs
 * ------------------------------------------------------------------ */

interface FormState {
  amount: number;
  accountId: string | null;
  poolId: string | null;
  toAccountId: string | null;
  toPoolId: string | null;
  categoryId: string | null;
  personId: string | null;
  note: string;
  /** When it actually happened. Defaults to now, but a ledger must allow backdating. */
  occurredAt: Date;
  /** paid_for_someone only: who else was on the bill, and for how much. */
  splitWith: SplitRow[];
  /** paid_for_someone only. */
  myShare: number | null;
  /**
   * lend / borrow only. True when no cash moves right now — you are writing
   * down a debt that already existed rather than handing money over.
   */
  withoutCashMovement: boolean;
}

function EntryForm({
  kind,
  savingsMode,
  draft,
  onDone,
}: {
  kind: TransactionKind;
  savingsMode: boolean;
  draft: TransactionDraft | null;
  onDone: () => void;
}) {
  const defaults = useDefaults();
  const accounts = useLedger((s) => s.accounts) ?? [];
  const pools = useLedger((s) => s.pools) ?? [];
  const categories = useLedger((s) => s.categories) ?? [];
  const people = useLedger((s) => s.people) ?? [];
  const addTransaction = useLedger((s) => s.addTransaction);
  const addPerson = useLedger((s) => s.addPerson);
  const prefs = usePrefs();

  const needsPerson = (
    ['lend', 'borrow', 'settle_receivable', 'settle_payable', 'paid_for_someone', 'someone_paid_for_me'] as TransactionKind[]
  ).includes(kind);
  const needsCategory = (['expense', 'income', 'refund', 'paid_for_someone'] as TransactionKind[]).includes(kind);
  const needsDestination = kind === 'transfer';
  const isSplit = kind === 'paid_for_someone';

  const relevantCategoriesForKind = categories.filter((c) =>
    kind === 'income' || kind === 'refund' ? c.direction === 'income' : c.direction === 'expense',
  );

  const [form, setForm] = useState<FormState>(() => ({
    amount: draft?.amount ?? 0,
    accountId: firstExisting(accounts, draft?.accountId, prefs.accountByKind[kind], defaults.accountId),
    poolId: firstExisting(pools, draft?.poolId, prefs.poolByKind[kind], defaults.poolId),
    toAccountId: savingsMode
      ? firstExisting(accounts, defaults.savingsAccountId)
      : kind === 'transfer'
        ? firstExisting(accounts, draft?.toAccountId)
        : firstExisting(accounts, draft?.toAccountId, prefs.accountByKind[kind], defaults.accountId),
    toPoolId: firstExisting(pools, draft?.toPoolId, prefs.poolByKind[kind], defaults.poolId),
    categoryId: firstExisting(relevantCategoriesForKind, draft?.categoryId, prefs.categoryByKind[kind]),
    personId: firstExisting(people, draft?.personId),
    note: '',
    occurredAt: new Date(),
    splitWith: [],
    myShare: null,
    withoutCashMovement: false,
  }));

  const [newPersonName, setNewPersonName] = useState(draft?.unknownPersonName ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (changes: Partial<FormState>) => setForm((prev) => ({ ...prev, ...changes }));

  const relevantCategories = relevantCategoriesForKind;

  const split = computeSplit(form.amount, form.splitWith, form.myShare);
  const { myShare, participants } = split;

  const problems: string[] = [];
  if (form.amount <= 0) problems.push('Enter an amount');
  if (needsPerson && !isSplit && !form.personId && !newPersonName.trim()) problems.push('Choose a person');
  if (needsDestination && !form.toAccountId && !savingsMode) problems.push('Choose where it goes');
  if (needsDestination && form.toAccountId === form.accountId && form.toPoolId === form.poolId) {
    problems.push('Pick two different places');
  }
  if (isSplit && form.splitWith.length === 0) problems.push('Add who you split with');
  if (isSplit && form.splitWith.length > 0 && !split.balanced) {
    problems.push('The shares must add up to the total');
  }

  const canSave = problems.length === 0 && !saving;

  // Is this taking money out of savings? Read off the payload itself, so every
  // kind that spends from an account (expense, transfer, lend, repay, split)
  // is covered by the same rule.
  const withdrawingFrom = savingsWithdrawal(
    buildPayload({ kind, savingsMode, form, personId: form.personId, myShare, participants, defaults }),
    accounts,
  );
  const { ask, alarm } = useSavingsAlarm();

  async function save() {
    if (!canSave) return;
    if (withdrawingFrom && !(await ask(withdrawingFrom, form.amount))) return;
    setSaving(true);
    setError(null);

    try {
      let personId = form.personId;
      if (needsPerson && !personId && newPersonName.trim()) {
        const typed = newPersonName.trim();
        // Typing a name that already exists means that person, not a second
        // one with the same name. Only create when nobody matches.
        const existing = findByExactName(people, typed);
        personId = existing ? existing.id : (await addPerson(typed)).id;
      }

      const payload = buildPayload({ kind, savingsMode, form, personId, myShare, participants, defaults });
      const result = await addTransaction(payload);

      prefs.remember({
        kind,
        accountId: form.accountId,
        poolId: form.poolId,
        categoryId: form.categoryId,
        personIds: personId ? [personId] : participants.map((p) => p.personId),
      });

      if (result.status === 'queued') {
        toast.success('Saved on this device', {
          description: 'It will sync the moment you are back online.',
        });
      } else {
        toast.success(`${formatPaise(form.amount)} recorded`, {
          description: KIND_META[kind].label,
        });
      }
      onDone();
    } catch (err) {
      // Never claim success. Say exactly what happened to their money.
      setError(
        err instanceof ApiError
          ? err.message
          : 'We could not save that transaction. Your money was not changed.',
      );
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col pb-2">
      <AmountPad value={form.amount} onChange={(amount) => patch({ amount })}>
        <div className="space-y-2">
          {needsCategory && relevantCategories.length > 0 && (
            <ChipRow
              items={relevantCategories.map((c) => ({ id: c.id, label: c.name }))}
              value={form.categoryId}
              onChange={(categoryId) => patch({ categoryId })}
              allowNone
            />
          )}

          {needsPerson && (
            <PersonPicker
              people={people}
              value={form.personId}
              newName={newPersonName}
              onSelect={(personId) => {
                patch({ personId });
                setNewPersonName('');
              }}
              onNewName={setNewPersonName}
            />
          )}

          {(kind === 'lend' || kind === 'borrow') && (
            <Segmented
              value={form.withoutCashMovement ? 'record' : 'moved'}
              onChange={(v) => patch({ withoutCashMovement: v === 'record' })}
              options={
                kind === 'lend'
                  ? [
                      { value: 'moved', label: 'I gave it now' },
                      { value: 'record', label: 'Already owed' },
                    ]
                  : [
                      { value: 'moved', label: 'I got it now' },
                      { value: 'record', label: 'Already owed' },
                    ]
              }
            />
          )}

          {isSplit && (
            <SplitEditor
              people={people}
              amount={form.amount}
              myShare={myShare}
              rows={form.splitWith}
              shares={participants}
              onRowsChange={(splitWith: SplitRow[]) => patch({ splitWith })}
              onMyShareChange={(value: number | null) => patch({ myShare: value })}
            />
          )}

          {!form.withoutCashMovement && (
            <ContextRow
              kind={kind}
              savingsMode={savingsMode}
              form={form}
              accounts={accounts}
              pools={pools}
              onPatch={patch}
            />
          )}

          {withdrawingFrom && <SavingsPeek key={withdrawingFrom.id} account={withdrawingFrom} />}

          <TextInput
            value={form.note}
            onChange={(e) => patch({ note: e.target.value })}
            placeholder="Add a note (optional)"
            maxLength={200}
            autoComplete="off"
          />

          <DateField value={form.occurredAt} onChange={(occurredAt) => patch({ occurredAt })} />

          {form.withoutCashMovement && (
            <p className="rounded-md bg-surface-sunken px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-soft">
              {kind === 'lend'
                ? 'No cash moves now. Your balances stay as they are, and this is added to what you are owed.'
                : 'No cash moves now. Your balances stay as they are, and this is added to what you owe.'}
            </p>
          )}
        </div>
      </AmountPad>

      {error && (
        <div
          role="alert"
          className="animate-fade mt-3 rounded-md bg-negative-soft px-4 py-3 text-[14px] text-negative"
        >
          {error}
        </div>
      )}

      <div className="sticky bottom-0 -mx-5 mt-4 bg-gradient-to-t from-white via-white/95 to-transparent px-5 pt-4 pb-2">
        <Button block size="lg" onClick={save} loading={saving} disabled={!canSave}>
          {problems[0] ?? `Save ${formatPaise(form.amount)}`}
        </Button>
      </div>

      {alarm}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Payload construction — the one place the UI meets the accounting model
 * ------------------------------------------------------------------ */

function buildPayload({
  kind,
  savingsMode,
  form,
  personId,
  myShare,
  participants,
  defaults,
}: {
  kind: TransactionKind;
  savingsMode: boolean;
  form: FormState;
  personId: string | null;
  myShare: number;
  participants: { personId: string; shareAmount: number }[];
  defaults: { accountId: string | null; poolId: string | null; savingsAccountId: string | null };
}): CreateTransactionPayload {
  const common = {
    amount: form.amount,
    note: form.note.trim() || null,
    occurredAt: form.occurredAt.toISOString(),
  };

  switch (kind) {
    case 'expense':
      return { ...common, kind, accountId: form.accountId, poolId: form.poolId, categoryId: form.categoryId };

    case 'income':
      return {
        ...common,
        kind,
        toAccountId: form.toAccountId ?? form.accountId ?? defaults.accountId,
        toPoolId: form.toPoolId ?? form.poolId,
        categoryId: form.categoryId,
      };

    case 'transfer':
      return {
        ...common,
        kind,
        accountId: form.accountId,
        poolId: form.poolId,
        // "Save ₹1,000" is a transfer into the savings account, same owner.
        toAccountId: savingsMode ? defaults.savingsAccountId : form.toAccountId,
        toPoolId: savingsMode ? form.poolId : form.toPoolId,
      };

    case 'lend':
      return {
        ...common,
        kind,
        personId: personId as string,
        withoutCashMovement: form.withoutCashMovement,
        // Recording a pre-existing debt moves no cash, so no account is named.
        ...(form.withoutCashMovement ? {} : { accountId: form.accountId, poolId: form.poolId }),
      };

    case 'borrow':
      return {
        ...common,
        kind,
        personId: personId as string,
        withoutCashMovement: form.withoutCashMovement,
        ...(form.withoutCashMovement
          ? {}
          : { toAccountId: form.toAccountId ?? form.accountId, toPoolId: form.toPoolId ?? form.poolId }),
      };

    case 'settle_receivable':
      return {
        ...common,
        kind,
        personId: personId as string,
        toAccountId: form.toAccountId ?? form.accountId,
        toPoolId: form.toPoolId ?? form.poolId,
      };

    case 'settle_payable':
      return { ...common, kind, personId: personId as string, accountId: form.accountId, poolId: form.poolId };

    case 'paid_for_someone':
      return {
        ...common,
        kind,
        accountId: form.accountId,
        poolId: form.poolId,
        categoryId: form.categoryId,
        myShare,
        participants,
      };

    case 'someone_paid_for_me':
      return { ...common, kind, personId: personId as string, categoryId: form.categoryId };

    case 'refund':
      return {
        ...common,
        kind,
        toAccountId: form.toAccountId ?? form.accountId,
        toPoolId: form.toPoolId ?? form.poolId,
        categoryId: form.categoryId,
      };

    case 'opening_balance':
      return {
        ...common,
        kind,
        toAccountId: form.toAccountId ?? form.accountId,
        toPoolId: form.toPoolId ?? form.poolId,
      };

    default:
      return { ...common, kind, accountId: form.accountId, poolId: form.poolId };
  }
}

/* ------------------------------------------------------------------ *
 * Small pickers
 * ------------------------------------------------------------------ */

function ChipRow({
  items,
  value,
  onChange,
  allowNone,
}: {
  items: { id: string; label: string }[];
  value: string | null;
  onChange: (id: string | null) => void;
  allowNone?: boolean;
}) {
  return (
    <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(allowNone && value === item.id ? null : item.id)}
          className={cn(
            'h-9 shrink-0 rounded-full px-3.5 text-[14px] font-medium',
            'border transition-[transform,background-color,border-color] duration-[140ms] ease-out-strong',
            'active:scale-[0.96]',
            value === item.id
              ? 'border-transparent bg-accent text-white'
              : 'border-line-strong bg-surface text-ink-soft',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Choosing a person.
 *
 * Every person is reachable. An earlier version showed only the first ten
 * chips, which meant that once you knew more than ten people the ones at the
 * end of the alphabet simply did not exist as far as the form was concerned —
 * no search, no overflow, no hint that anything was missing.
 *
 * So: the field filters the list as you type, and doubles as the way to add
 * someone new when nobody matches.
 */
function PersonPicker({
  people,
  value,
  newName,
  onSelect,
  onNewName,
}: {
  people: { id: string; name: string; netBalance: number }[];
  value: string | null;
  newName: string;
  onSelect: (id: string | null) => void;
  onNewName: (name: string) => void;
}) {
  const recentIds = usePrefs((s) => s.peopleIds);

  const ordered = useMemo(() => orderPeople(people, recentIds), [people, recentIds]);
  const matches = useMemo(() => filterPeople(ordered, newName), [ordered, newName]);
  const query = newName.trim();
  const exact = findByExactName(people, newName);
  const selected = people.find((p) => p.id === value);

  return (
    <div className="space-y-2">
      {selected ? (
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="flex w-full items-center gap-2.5 rounded-md border border-accent bg-accent-soft px-3 py-2.5 text-left press active:scale-[0.985]"
        >
          <Avatar name={selected.name} size={28} />
          <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-accent">{selected.name}</span>
          <span className="shrink-0 text-[13px] text-accent">Change</span>
        </button>
      ) : (
        <>
          <TextInput
            value={newName}
            onChange={(e) => onNewName(e.target.value)}
            placeholder={people.length > 0 ? 'Search or add someone' : 'Who is this with?'}
            autoComplete="off"
            enterKeyHint="done"
          />

          {matches.length > 0 && (
            <ChipRow
              items={matches.map((p) => ({ id: p.id, label: p.name }))}
              value={value}
              onChange={(id) => {
                onSelect(id);
                onNewName('');
              }}
            />
          )}

          {query && matches.length === 0 && (
            <p className="px-1 text-[13px] text-ink-muted">
              Nobody called “{query}” yet — saving will add them.
            </p>
          )}

          {query && exact && (
            <p className="px-1 text-[13px] text-ink-muted">Tap {exact.name} above to pick them.</p>
          )}
        </>
      )}
    </div>
  );
}

/** The quiet line that says which account and whose money this touches. */
function ContextRow({
  kind,
  savingsMode,
  form,
  accounts,
  pools,
  onPatch,
}: {
  kind: TransactionKind;
  savingsMode: boolean;
  form: FormState;
  accounts: { id: string; name: string; kind: string }[];
  pools: { id: string; name: string }[];
  onPatch: (changes: Partial<FormState>) => void;
}) {
  const incoming = (
    ['income', 'settle_receivable', 'borrow', 'refund', 'opening_balance'] as TransactionKind[]
  ).includes(kind);
  const sourceKey = incoming ? 'toAccountId' : 'accountId';
  const poolKey = incoming ? 'toPoolId' : 'poolId';

  return (
    <div className="space-y-1.5 pt-1">
      <div className="flex gap-2">
        <Select
          label={incoming ? 'Into' : 'From'}
          value={form[sourceKey]}
          options={accounts.map((a) => ({ id: a.id, label: a.name }))}
          onChange={(id) => onPatch({ [sourceKey]: id } as Partial<FormState>)}
        />
        <Select
          label="Whose"
          value={form[poolKey]}
          options={pools.map((p) => ({ id: p.id, label: p.name }))}
          onChange={(id) => onPatch({ [poolKey]: id } as Partial<FormState>)}
        />
      </div>

      {kind === 'transfer' && !savingsMode && (
        <div className="flex gap-2">
          <Select
            label="To"
            value={form.toAccountId}
            options={accounts.map((a) => ({ id: a.id, label: a.name }))}
            onChange={(toAccountId) => onPatch({ toAccountId })}
          />
          <Select
            label="Whose"
            value={form.toPoolId}
            options={pools.map((p) => ({ id: p.id, label: p.name }))}
            onChange={(toPoolId) => onPatch({ toPoolId })}
          />
        </div>
      )}
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
}) {
  return (
    <label className="flex flex-1 items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
      <span className="shrink-0 text-[13px] text-ink-muted">{label}</span>
      <select
        // A <select> whose value matches no option silently renders the first
        // one. For an account picker that means showing "Cash" while holding
        // something else entirely, so an unmatched value is forced back to the
        // placeholder and the user is asked.
        value={isSelectable(options, value) ? (value as string) : ''}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-right text-[14px] font-medium text-ink focus:outline-none"
      >
        {!isSelectable(options, value) && <option value="">Choose…</option>}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
