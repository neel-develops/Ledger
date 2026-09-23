import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Camera, Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatPaise } from '@shared/money';
import type { TransactionKind } from '@shared/domain';
import { Sheet } from './ui/Sheet';
import { Button } from './ui/Button';
import { IconBadge } from './ui/primitives';
import { Mascot, type MascotMood } from './Mascot';
import { KIND_META } from '../lib/kinds';
import { api, ApiError } from '../lib/api';
import { prepareImage, ImageError, type PreparedImage } from '../lib/image';
import { findByExactName } from '../lib/people';
import { useLedger } from '../store/ledger';
import type { CreateTransactionPayload } from '../lib/types';
import { cn } from '../lib/cn';
import { savingsWithdrawal } from '../lib/savings';
import { useSavingsAlarm } from '../lib/useSavingsAlarm';

/**
 * Chillar — talk to your ledger.
 *
 * Tell it what happened ("chai 40, auto 60, and I paid 900 for dinner with
 * Rahul and Sahil") or show it a receipt, and it drafts the transactions. It
 * cannot save anything: each draft is a card, already checked by the ledger,
 * that you confirm or skip. Ask it to check your books and it runs the real
 * integrity checks and looks through your history.
 *
 * The conversation is kept only in memory, never stored.
 */

interface AssistantDraft {
  id: string;
  summary: string;
  kind: TransactionKind;
  amount: number;
  payload: Record<string, unknown>;
  newPeople: Record<string, string>;
}

type DraftStatus = 'pending' | 'saving' | 'saved' | 'skipped' | 'failed';

interface DraftState extends AssistantDraft {
  status: DraftStatus;
  error?: string;
}

interface ChatItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  image?: PreparedImage;
  drafts?: DraftState[];
  failed?: boolean;
}

const SUGGESTIONS = [
  'Spent 120 on chai and 60 on auto',
  'Paid 900 for dinner with Rahul and Sahil, split 3 ways',
  'Check my books for anything off',
];

export function AssistantSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<PreparedImage | null>(null);
  const [thinking, setThinking] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const people = useLedger((s) => s.people) ?? [];
  const accounts = useLedger((s) => s.accounts) ?? [];
  const addPerson = useLedger((s) => s.addPerson);
  const addTransaction = useLedger((s) => s.addTransaction);
  const { ask: askAboutSavings, alarm } = useSavingsAlarm();

  // Keep the newest message in view.
  useEffect(() => {
    const el = scroller.current?.closest('.overflow-y-auto');
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [items, thinking]);

  const lastFailed = items.at(-1)?.failed;
  const mood: MascotMood = thinking ? 'thinking' : celebrate ? 'happy' : unavailable || lastFailed ? 'sad' : 'idle';

  function cheer() {
    setCelebrate(true);
    window.setTimeout(() => setCelebrate(false), 1400);
  }

  async function send(message: string, image: PreparedImage | null = photo) {
    const trimmed = message.trim();
    if ((!trimmed && !image) || thinking) return;

    const userItem: ChatItem = {
      id: crypto.randomUUID(),
      role: 'user',
      text: trimmed || 'Here’s a receipt.',
      ...(image ? { image } : {}),
    };
    const history = [...items, userItem];
    setItems(history);
    setText('');
    setPhoto(null);
    setThinking(true);

    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);

    try {
      const response = await api.post<{ reply: string; drafts: AssistantDraft[]; truncated: boolean }>(
        '/assistant',
        {
          messages: history.map((item, index) => ({
            role: item.role,
            text: describeForModel(item),
            // Only the newest photo is sent; earlier ones are already described in the chat.
            image:
              index === history.length - 1 && item.image
                ? { mediaType: item.image.mediaType, data: item.image.data }
                : null,
          })),
          today: local.toISOString().slice(0, 10),
          timeZoneOffsetMinutes: -now.getTimezoneOffset(),
        },
      );

      setItems((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: response.truncated ? `${response.reply}\n\n(I ran out of room — ask me to carry on.)` : response.reply,
          drafts: response.drafts.map((d) => ({ ...d, status: 'pending' })),
        },
      ]);
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      if (apiError && ['assistant_unavailable', 'assistant_misconfigured'].includes(apiError.code)) {
        setUnavailable(apiError.message);
      }
      setItems((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: apiError?.message ?? 'I couldn’t reach my brain just now. Nothing was changed — try again?',
          failed: true,
        },
      ]);
    } finally {
      setThinking(false);
    }
  }

  function updateDraft(itemId: string, draftId: string, patch: Partial<DraftState>) {
    setItems((prev) =>
      prev.map((item) =>
        item.id !== itemId
          ? item
          : { ...item, drafts: item.drafts?.map((d) => (d.id === draftId ? { ...d, ...patch } : d)) },
      ),
    );
  }

  async function confirm(itemId: string, draft: DraftState): Promise<boolean> {
    if (draft.status === 'saving' || draft.status === 'saved') return draft.status === 'saved';

    // A drafted withdrawal from savings gets the same furious Chillar as the form.
    const fromSavings = savingsWithdrawal(draft.payload, accounts);
    if (fromSavings && !(await askAboutSavings(fromSavings, draft.amount))) return false;

    updateDraft(itemId, draft.id, { status: 'saving', error: undefined });

    try {
      // Create anyone new first, then swap their placeholder ids for real ones.
      const ids: Record<string, string> = {};
      for (const [placeholder, name] of Object.entries(draft.newPeople)) {
        const existing = findByExactName(people, name);
        ids[placeholder] = existing ? existing.id : (await addPerson(name)).id;
      }
      const swap = (id: unknown) => (typeof id === 'string' && ids[id] ? ids[id] : id);

      const payload = {
        ...draft.payload,
        personId: swap(draft.payload.personId),
        participants: Array.isArray(draft.payload.participants)
          ? (draft.payload.participants as { personId: string; shareAmount: number }[]).map((p) => ({
              ...p,
              personId: swap(p.personId) as string,
            }))
          : undefined,
        // Stable per draft: confirming twice, or retrying after a dropped
        // connection, can only ever save it once.
        idempotencyKey: `assistant-${draft.id}`,
      } as unknown as CreateTransactionPayload;

      const result = await addTransaction(payload);
      updateDraft(itemId, draft.id, { status: 'saved' });
      if (result.status === 'queued') toast('Saved on this phone — it will sync when you are back online.');
      return true;
    } catch (error) {
      updateDraft(itemId, draft.id, {
        status: 'failed',
        error: error instanceof ApiError ? error.message : 'That could not be saved. Nothing was changed.',
      });
      return false;
    }
  }

  async function confirmAll(item: ChatItem) {
    const pending = item.drafts?.filter((d) => d.status === 'pending' || d.status === 'failed') ?? [];
    let saved = 0;
    for (const draft of pending) if (await confirm(item.id, draft)) saved += 1;
    if (saved > 0) {
      cheer();
      toast.success(`${saved} transaction${saved === 1 ? '' : 's'} recorded`);
    }
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    try {
      setPhoto(await prepareImage(file, 1568));
    } catch (error) {
      toast.error(error instanceof ImageError ? error.message : 'That photo could not be used.');
    }
  }

  const empty = items.length === 0;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      fullHeight
      title={empty ? undefined : 'Chillar'}
      action={
        !empty ? (
          <button
            type="button"
            onClick={() => {
              setItems([]);
              setUnavailable(null);
            }}
            className="text-[15px] font-medium text-accent press active:scale-[0.97]"
          >
            New chat
          </button>
        ) : undefined
      }
    >
      <div ref={scroller} className="flex min-h-full flex-col">
        {empty ? (
          <div className="flex flex-1 flex-col items-center justify-center px-2 pt-2 pb-6 text-center">
            <Mascot size={132} mood={mood} trackPointer label="Chillar, your money assistant" />
            <h2 className="mt-3 text-[24px] font-semibold tracking-[-0.025em]">Hi, I’m Chillar</h2>
            <p className="mt-1.5 max-w-[30ch] text-[14.5px] leading-relaxed text-ink-muted">
              {unavailable ??
                'Tell me what you spent, lent or got back — or show me a receipt. I’ll draft it, you confirm it.'}
            </p>

            {!unavailable && (
              <div className="mt-6 flex w-full flex-col gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void send(suggestion, null)}
                    className="rounded-lg border border-line bg-surface px-4 py-3 text-left text-[14.5px] text-ink-soft transition-transform duration-[140ms] ease-out-strong active:scale-[0.985]"
                  >
                    {suggestion}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="flex items-center gap-2 rounded-lg border border-dashed border-line-strong px-4 py-3 text-left text-[14.5px] text-ink-soft transition-transform duration-[140ms] ease-out-strong active:scale-[0.985]"
                >
                  <Camera className="size-4" /> Scan a receipt
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 space-y-4 pb-4">
            {items.map((item) =>
              item.role === 'user' ? (
                <div key={item.id} className="animate-rise flex flex-col items-end gap-1.5">
                  {item.image && (
                    <img src={item.image.dataUrl} alt="" className="max-h-44 rounded-lg border border-line object-cover" />
                  )}
                  <p className="max-w-[85%] rounded-[18px] rounded-br-md bg-accent px-3.5 py-2.5 text-[15px] leading-snug whitespace-pre-wrap text-white">
                    {item.text}
                  </p>
                </div>
              ) : (
                <div key={item.id} className="animate-rise flex gap-2.5">
                  <Mascot size={30} mood={item.failed ? 'sad' : 'idle'} className="mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="rounded-[18px] rounded-tl-md bg-surface-sunken px-3.5 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-ink">
                      {item.text}
                    </p>

                    {item.drafts && item.drafts.length > 0 && (
                      <div className="space-y-2">
                        {item.drafts.map((draft) => (
                          <DraftCard
                            key={draft.id}
                            draft={draft}
                            accounts={accounts}
                            people={people}
                            onConfirm={async () => {
                              if (await confirm(item.id, draft)) {
                                cheer();
                                toast.success(`${formatPaise(draft.amount)} recorded`);
                              }
                            }}
                            onSkip={() => updateDraft(item.id, draft.id, { status: 'skipped' })}
                          />
                        ))}
                        {item.drafts.filter((d) => d.status === 'pending').length > 1 && (
                          <Button block onClick={() => void confirmAll(item)} icon={<Check className="size-4" />}>
                            Confirm all {item.drafts.filter((d) => d.status === 'pending').length}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ),
            )}

            {thinking && (
              <div className="animate-fade flex items-center gap-2.5">
                <Mascot size={30} mood="thinking" className="shrink-0" />
                <span className="text-[14px] text-ink-muted">Thinking…</span>
              </div>
            )}
          </div>
        )}

        {/* Composer */}
        <div className="sticky bottom-0 -mx-5 mt-auto bg-gradient-to-t from-[var(--glass-bg-strong)] via-[var(--glass-bg-strong)] to-transparent px-5 pt-3 pb-1">
          {photo && (
            <div className="relative mb-2 inline-block">
              <img src={photo.dataUrl} alt="Receipt to send" className="h-20 rounded-md border border-line object-cover" />
              <button
                type="button"
                onClick={() => setPhoto(null)}
                aria-label="Remove photo"
                className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-ink text-canvas"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}

          <div className="flex items-end gap-2 rounded-[22px] border border-line-strong bg-surface p-1.5 pl-2">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              aria-label="Add a receipt photo"
              className="grid size-9 shrink-0 place-items-center rounded-full text-ink-muted press active:scale-[0.92]"
            >
              <Camera className="size-[19px]" />
            </button>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(text);
                }
              }}
              rows={1}
              placeholder={thinking ? 'Chillar is thinking…' : 'What happened with your money?'}
              disabled={Boolean(unavailable)}
              className="max-h-28 min-h-9 flex-1 resize-none bg-transparent py-2 text-[16px] leading-snug text-ink placeholder:text-ink-faint focus:outline-none"
              style={{ fieldSizing: 'content' } as React.CSSProperties}
            />
            <button
              type="button"
              onClick={() => void send(text)}
              disabled={thinking || (!text.trim() && !photo) || Boolean(unavailable)}
              aria-label="Send"
              className={cn(
                'grid size-9 shrink-0 place-items-center rounded-full bg-accent text-white',
                'transition-[transform,opacity] duration-[140ms] ease-out-strong active:scale-[0.92] disabled:opacity-35',
              )}
            >
              {thinking ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-[18px]" />}
            </button>
          </div>
          <p className="mt-1.5 text-center text-[11.5px] text-ink-faint">
            Chillar drafts; you confirm. Nothing is saved without you.
          </p>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => {
            void pickPhoto(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      {alarm}
    </Sheet>
  );
}

/** What the model hears about past turns — including what became of its drafts. */
function describeForModel(item: ChatItem): string {
  if (item.role === 'user' || !item.drafts?.length) return item.text;
  const outcome = item.drafts
    .map((d) => {
      const verb =
        d.status === 'saved'
          ? 'confirmed and saved'
          : d.status === 'skipped'
            ? 'skipped by the user'
            : d.status === 'failed'
              ? `failed to save (${d.error ?? 'unknown error'})`
              : 'not yet confirmed';
      return `- ${d.summary}: ${verb}`;
    })
    .join('\n');
  return `${item.text}\n\n[Drafts from this turn]\n${outcome}`;
}

function DraftCard({
  draft,
  accounts,
  people,
  onConfirm,
  onSkip,
}: {
  draft: DraftState;
  accounts: { id: string; name: string }[];
  people: { id: string; name: string }[];
  onConfirm: () => void;
  onSkip: () => void;
}) {
  const meta = KIND_META[draft.kind];

  const details = useMemo(() => {
    const out: string[] = [];
    const p = draft.payload;
    const accountName = (id: unknown) => accounts.find((a) => a.id === id)?.name;
    const personName = (id: unknown) =>
      people.find((x) => x.id === id)?.name ?? (typeof id === 'string' ? draft.newPeople[id] : undefined);

    const from = accountName(p.accountId);
    const to = accountName(p.toAccountId);
    if (from && to) out.push(`${from} → ${to}`);
    else if (from || to) out.push((from ?? to) as string);

    const person = personName(p.personId);
    if (person) out.push(person);
    if (Array.isArray(p.participants)) {
      out.push(
        (p.participants as { personId: string; shareAmount: number }[])
          .map((x) => `${personName(x.personId) ?? 'someone'} ${formatPaise(x.shareAmount)}`)
          .join(', '),
      );
    }
    if (p.withoutCashMovement) out.push('no cash moves');

    const newNames = Object.values(draft.newPeople);
    if (newNames.length) out.push(`adds ${newNames.join(', ')}`);

    if (typeof p.occurredAt === 'string') {
      const when = new Date(p.occurredAt);
      if (when.toDateString() !== new Date().toDateString()) {
        out.push(when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));
      }
    }
    return out;
  }, [draft, accounts, people]);

  const done = draft.status === 'saved' || draft.status === 'skipped';

  return (
    <div
      className={cn(
        'rounded-lg border bg-surface p-3 transition-opacity duration-200',
        draft.status === 'saved' ? 'border-positive/40' : 'border-line',
        draft.status === 'skipped' && 'opacity-50',
      )}
    >
      <div className="flex items-start gap-3">
        <IconBadge tone={meta.tone} size="sm">
          {meta.icon}
        </IconBadge>
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-medium leading-snug text-ink">{draft.summary}</p>
          <p className="mt-0.5 text-[12.5px] text-ink-muted">
            {meta.label}
            {details.length ? ` · ${details.join(' · ')}` : ''}
          </p>
        </div>
        <span className="tnum shrink-0 text-[15px] font-semibold">{formatPaise(draft.amount)}</span>
      </div>

      {draft.error && <p className="mt-2 text-[12.5px] text-negative">{draft.error}</p>}

      {!done ? (
        <div className="mt-2.5 flex gap-2">
          <Button size="sm" variant="secondary" block onClick={onSkip} disabled={draft.status === 'saving'}>
            Skip
          </Button>
          <Button size="sm" block onClick={onConfirm} loading={draft.status === 'saving'}>
            {draft.status === 'failed' ? 'Try again' : 'Confirm'}
          </Button>
        </div>
      ) : (
        <p
          className={cn(
            'mt-2 flex items-center gap-1.5 text-[12.5px] font-medium',
            draft.status === 'saved' ? 'text-positive' : 'text-ink-muted',
          )}
        >
          {draft.status === 'saved' ? (
            <>
              <Check className="size-3.5" /> Recorded
            </>
          ) : (
            'Skipped'
          )}
        </p>
      )}
    </div>
  );
}
