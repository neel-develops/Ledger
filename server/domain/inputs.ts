import { z } from 'zod';
import { MAX_PAISE } from '@shared/money';
import { ACCOUNT_KINDS, POOL_KINDS } from '@shared/domain';

/**
 * Every byte that reaches the ledger passes through one of these schemas.
 * `accountId` / `poolId` are optional everywhere: the service fills in the
 * user's defaults so a normal expense is amount + nothing else.
 */

const paise = z
  .number()
  .int('Amount must be a whole number of paise')
  .positive('Amount must be greater than zero')
  .max(MAX_PAISE, 'That amount is too large');

const uuid = z.string().uuid('Invalid reference');
const optionalUuid = uuid.nullish();

/** Notes are stored as plain text; anything that looks like markup is stripped. */
const note = z
  .string()
  .max(500, 'Notes are limited to 500 characters')
  .transform((s) => s.replace(/<[^>]*>/g, '').trim())
  .nullish();

const occurredAt = z
  .string()
  .datetime({ offset: true })
  .nullish()
  .transform((v) => (v ? new Date(v) : new Date()));

const base = {
  amount: paise,
  occurredAt,
  note,
  idempotencyKey: z.string().min(8).max(128).nullish(),
};

const fromPosition = { accountId: optionalUuid, poolId: optionalUuid };
const toPosition = { toAccountId: optionalUuid, toPoolId: optionalUuid };

export const createTransactionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('expense'), ...base, ...fromPosition, categoryId: optionalUuid }),
  z.object({ kind: z.literal('income'), ...base, ...toPosition, categoryId: optionalUuid }),
  z.object({ kind: z.literal('transfer'), ...base, ...fromPosition, ...toPosition }),
  z.object({
    kind: z.literal('lend'),
    ...base,
    ...fromPosition,
    personId: uuid,
    /** true = recording a debt that predates the app; no cash moves. */
    withoutCashMovement: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('borrow'),
    ...base,
    ...toPosition,
    personId: uuid,
    withoutCashMovement: z.boolean().default(false),
  }),
  z.object({ kind: z.literal('settle_receivable'), ...base, ...toPosition, personId: uuid }),
  z.object({ kind: z.literal('settle_payable'), ...base, ...fromPosition, personId: uuid }),
  z.object({
    kind: z.literal('paid_for_someone'),
    ...base,
    ...fromPosition,
    categoryId: optionalUuid,
    myShare: z.number().int().min(0).max(MAX_PAISE),
    participants: z
      .array(z.object({ personId: uuid, shareAmount: paise }))
      .min(1, 'Add at least one person')
      .max(20, 'Too many people on one bill'),
  }),
  z.object({
    kind: z.literal('someone_paid_for_me'),
    ...base,
    personId: uuid,
    categoryId: optionalUuid,
  }),
  z.object({ kind: z.literal('refund'), ...base, ...toPosition, categoryId: optionalUuid }),
  z.object({ kind: z.literal('opening_balance'), ...base, ...toPosition }),
  z.object({
    kind: z.literal('adjustment'),
    ...base,
    ...fromPosition,
    direction: z.enum(['increase', 'decrease']),
  }),
]);

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

export const reverseTransactionSchema = z.object({
  idempotencyKey: z.string().min(8).max(128).nullish(),
  note: note,
});

export const listTransactionsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().datetime({ offset: true }).optional(),
  kind: z.string().optional(),
  personId: uuid.optional(),
  accountId: uuid.optional(),
  poolId: uuid.optional(),
  categoryId: uuid.optional(),
  search: z.string().max(100).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

/* ------------------------------------------------------------------ *
 * Reference data
 * ------------------------------------------------------------------ */

const name = z
  .string()
  .trim()
  .min(1, 'A name is required')
  .max(60, 'That name is too long')
  .transform((s) => s.replace(/<[^>]*>/g, '').trim());

export const createAccountSchema = z.object({
  name,
  kind: z.enum(ACCOUNT_KINDS),
});

export const updateAccountSchema = z.object({
  name: name.optional(),
  isDefault: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export const createPoolSchema = z.object({
  name,
  kind: z.enum(POOL_KINDS),
});

export const createPersonSchema = z.object({
  name,
  relation: z.string().trim().max(40).nullish(),
  note: note,
});

export const updatePersonSchema = createPersonSchema.partial().extend({
  archived: z.boolean().optional(),
});

export const createCategorySchema = z.object({
  name,
  icon: z.string().max(40).nullish(),
  direction: z.enum(['expense', 'income']).default('expense'),
});

export const reconciliationSchema = z.object({
  accountId: uuid,
  poolId: optionalUuid,
  actualAmount: z.number().int().min(0).max(MAX_PAISE),
  /** When false we only report the difference and change nothing. */
  createAdjustment: z.boolean().default(false),
  note: note,
});
