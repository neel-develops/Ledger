import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parseRupeesToPaise, formatPaise } from '@shared/money';
import { createTransactionSchema, type CreateTransactionInput } from './inputs';

/**
 * Turning what the assistant proposes into something the ledger will accept.
 *
 * The assistant never writes. It describes transactions in the terms a person
 * uses — rupees as text, dates as days, people by name — and this module turns
 * each one into the exact payload a human would have submitted through the
 * form. From there it goes through the same Zod schema and the same ledger
 * engine as everything else, and only then is it shown to the user, who
 * decides whether it is saved.
 *
 * Nothing in here is trusted merely because a model produced it.
 */

export const DRAFT_KINDS = [
  'expense',
  'income',
  'transfer',
  'lend',
  'borrow',
  'settle_receivable',
  'settle_payable',
  'paid_for_someone',
  'someone_paid_for_me',
  'refund',
  'opening_balance',
] as const;

/** Kinds where money arrives, so the account is the DESTINATION. */
const INCOMING_KINDS = new Set(['income', 'borrow', 'settle_receivable', 'refund', 'opening_balance']);

const nullableId = z.string().max(64).nullish();
const rupees = z.string().max(24);

export const draftInputSchema = z.object({
  kind: z.enum(DRAFT_KINDS),
  amount: rupees,
  summary: z.string().max(140),
  accountId: nullableId,
  poolId: nullableId,
  toAccountId: nullableId,
  toPoolId: nullableId,
  personId: nullableId,
  newPersonName: z.string().max(60).nullish(),
  categoryId: nullableId,
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  note: z.string().max(200).nullish(),
  myShare: rupees.nullish(),
  participants: z
    .array(
      z.object({
        personId: nullableId,
        newPersonName: z.string().max(60).nullish(),
        share: rupees,
      }),
    )
    .max(20)
    .nullish(),
  withoutCashMovement: z.boolean().nullish(),
});

export type DraftInput = z.infer<typeof draftInputSchema>;

/** JSON Schema for the tool definition — kept in step with `draftInputSchema`. */
export const DRAFT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: [...DRAFT_KINDS],
      description:
        'expense: money spent. income: money received and kept (salary, a gift, Dad giving money). ' +
        'transfer: moving between accounts or between whose-money pools, including into savings. ' +
        'lend: the user gave someone money they expect back (NOT an expense). ' +
        'borrow: someone gave the user money to be returned (NOT income). ' +
        'settle_receivable: someone repaid the user. settle_payable: the user repaid someone. ' +
        'paid_for_someone: the user paid a shared bill; only their own share is an expense. ' +
        'someone_paid_for_me: someone else paid for the user. refund: money back from a merchant. ' +
        'opening_balance: money the user already had before using the app.',
    },
    amount: { type: 'string', description: 'Rupees as plain digits, e.g. "150" or "150.50". No symbols.' },
    summary: {
      type: 'string',
      description: 'One short line the user will read on the confirmation card, e.g. "Lunch at Tanay\'s, ₹240".',
    },
    accountId: { type: ['string', 'null'], description: 'Account the money LEAVES. Null for the default.' },
    poolId: { type: ['string', 'null'], description: 'Whose money leaves. Null for the default (My money).' },
    toAccountId: { type: ['string', 'null'], description: 'Account the money ARRIVES in (income, transfer, repayments).' },
    toPoolId: { type: ['string', 'null'], description: 'Whose money it becomes when it arrives.' },
    personId: { type: ['string', 'null'], description: 'Existing person id for debts and repayments.' },
    newPersonName: {
      type: ['string', 'null'],
      description: 'Only when the person is NOT in the list yet. They are created when the user confirms.',
    },
    categoryId: { type: ['string', 'null'], description: 'Existing category id, if one fits.' },
    date: { type: ['string', 'null'], description: 'YYYY-MM-DD. Null for today. Never in the future.' },
    note: { type: ['string', 'null'] },
    myShare: {
      type: ['string', 'null'],
      description: 'paid_for_someone only: the user\'s own share in rupees. Shares must add up to amount exactly.',
    },
    participants: {
      type: ['array', 'null'],
      description: 'paid_for_someone only: everyone else on the bill and what they owe.',
      items: {
        type: 'object',
        properties: {
          personId: { type: ['string', 'null'] },
          newPersonName: { type: ['string', 'null'] },
          share: { type: 'string', description: 'What this person owes, in rupees. Always give it.' },
        },
        required: ['share'],
      },
    },
    withoutCashMovement: {
      type: ['boolean', 'null'],
      description:
        'lend/borrow only. True when recording a debt that ALREADY existed and no cash moves now.',
    },
  },
  required: ['kind', 'amount', 'summary'],
} as const;

export interface DraftContext {
  people: { id: string; name: string }[];
  /** e.g. "2026-09-23", in the user's own time zone. */
  today: string;
  /** Minutes east of UTC, e.g. 330 for India. */
  timeZoneOffsetMinutes: number;
  now?: Date;
}

export interface ConvertedDraft {
  /** Exactly what the form would have POSTed. `occurredAt` is an ISO string. */
  payload: Record<string, unknown>;
  /** Parsed for the ledger preview. */
  input: CreateTransactionInput;
  /** Placeholder person id → name, for people created on confirm. */
  newPeople: Record<string, string>;
  summary: string;
}

export class DraftError extends Error {}

function paiseOf(text: string | null | undefined, label: string): number {
  const paise = parseRupeesToPaise(text ?? null);
  if (paise === null) throw new DraftError(`${label} "${text ?? ''}" is not an amount in rupees.`);
  return paise;
}

function offsetSuffix(minutes: number): string {
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/**
 * Convert one draft. Throws `DraftError` with a sentence the MODEL can act on —
 * these messages go back to it as tool results so it can correct itself.
 */
export function convertDraft(raw: unknown, context: DraftContext): ConvertedDraft {
  const parsed = draftInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DraftError(
      `The draft is malformed: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  const draft = parsed.data;
  const newPeople: Record<string, string> = {};

  // A name that is already in the list means that person, never a duplicate.
  const resolvePerson = (personId?: string | null, newName?: string | null): string | null => {
    if (personId) return personId;
    const name = newName?.trim();
    if (!name) return null;
    const existing = context.people.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
    const already = Object.entries(newPeople).find(([, n]) => n.toLowerCase() === name.toLowerCase());
    if (already) return already[0];
    const placeholder = randomUUID();
    newPeople[placeholder] = name;
    return placeholder;
  };

  const amount = paiseOf(draft.amount, 'The amount');
  if (amount <= 0) throw new DraftError('The amount must be more than zero.');

  // When it happened. Today means now, so ordering within the day stays right.
  const now = context.now ?? new Date();
  let occurredAt: string;
  if (!draft.date || draft.date === context.today) {
    occurredAt = now.toISOString();
  } else {
    if (draft.date > context.today) throw new DraftError('That date is in the future.');
    occurredAt = new Date(`${draft.date}T12:00:00${offsetSuffix(context.timeZoneOffsetMinutes)}`).toISOString();
  }

  // Models sometimes name the account as the source when it is the destination.
  // For money arriving, an account given only as `accountId` is where it lands.
  const incoming = INCOMING_KINDS.has(draft.kind);
  const toAccountId = draft.toAccountId ?? (incoming ? draft.accountId : null) ?? null;
  const toPoolId = draft.toPoolId ?? (incoming ? draft.poolId : null) ?? null;

  const payload: Record<string, unknown> = {
    kind: draft.kind,
    amount,
    occurredAt,
    note: draft.note?.trim() || null,
    accountId: incoming ? null : (draft.accountId ?? null),
    poolId: incoming ? null : (draft.poolId ?? null),
    toAccountId,
    toPoolId,
    categoryId: draft.categoryId ?? null,
  };

  const personId = resolvePerson(draft.personId, draft.newPersonName);
  if (personId) payload.personId = personId;

  if (draft.kind === 'lend' || draft.kind === 'borrow') {
    payload.withoutCashMovement = Boolean(draft.withoutCashMovement);
  }

  if (draft.kind === 'paid_for_someone') {
    const participants = (draft.participants ?? []).map((p, i) => {
      const id = resolvePerson(p.personId, p.newPersonName);
      if (!id) throw new DraftError(`Person ${i + 1} on the bill has no id and no name.`);
      return { personId: id, shareAmount: paiseOf(p.share, `Share ${i + 1}`) };
    });
    if (participants.length === 0) throw new DraftError('A shared bill needs at least one other person.');

    const named = participants.reduce((sum, p) => sum + p.shareAmount, 0);
    const myShare = draft.myShare != null ? paiseOf(draft.myShare, 'Your share') : amount - named;
    if (myShare < 0 || myShare + named !== amount) {
      throw new DraftError(
        `The shares (${formatPaise(named)} for others + ${formatPaise(Math.max(myShare, 0))} yours) ` +
          `do not add up to ${formatPaise(amount)}.`,
      );
    }
    payload.myShare = myShare;
    payload.participants = participants;
  }

  const validated = createTransactionSchema.safeParse(payload);
  if (!validated.success) {
    throw new DraftError(validated.error.issues.map((i) => i.message).join('; '));
  }

  return { payload, input: validated.data, newPeople, summary: draft.summary.trim() };
}
