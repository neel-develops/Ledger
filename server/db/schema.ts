import {
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
  bigint,
  integer,
  jsonb,
  index,
  uniqueIndex,
  check,
  pgEnum,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { ACCOUNT_KINDS, POOL_KINDS, ENTRY_BUCKETS, TRANSACTION_KINDS } from '@shared/domain';

/* ------------------------------------------------------------------ *
 * Better Auth tables
 * ------------------------------------------------------------------ */

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const accountsAuth = pgTable(
  'auth_accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    idToken: text('id_token'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('auth_accounts_user_idx').on(t.userId)],
);

export const verifications = pgTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

/* ------------------------------------------------------------------ *
 * Enums
 * ------------------------------------------------------------------ */

export const accountKindEnum = pgEnum('account_kind', ACCOUNT_KINDS);
export const poolKindEnum = pgEnum('pool_kind', POOL_KINDS);
export const entryBucketEnum = pgEnum('entry_bucket', ENTRY_BUCKETS);
export const transactionKindEnum = pgEnum('transaction_kind', TRANSACTION_KINDS);
export const categoryDirectionEnum = pgEnum('category_direction', ['expense', 'income']);

/* ------------------------------------------------------------------ *
 * Ledger tables
 * ------------------------------------------------------------------ */

const userId = () =>
  text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

/** Where money physically sits. */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userId(),
    name: text('name').notNull(),
    kind: accountKindEnum('kind').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    /**
     * Excluded from "Total money" and from the home-screen widget.
     *
     * Presentation only. The ledger still counts every paisa of it: the
     * balance is real, backups include it, reconciliation checks it, and the
     * health checks verify it. What changes is only what is added up in front
     * of whoever is looking over your shoulder.
     */
    isPrivate: boolean('is_private').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('accounts_user_name_idx').on(t.userId, t.name),
    index('accounts_user_idx').on(t.userId),
    check('accounts_name_not_blank', sql`length(btrim(${t.name})) > 0`),
  ],
);

/** Who the money belongs to. Orthogonal to `accounts`. */
export const ownershipPools = pgTable(
  'ownership_pools',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userId(),
    name: text('name').notNull(),
    kind: poolKindEnum('kind').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('pools_user_name_idx').on(t.userId, t.name),
    index('pools_user_idx').on(t.userId),
    check('pools_name_not_blank', sql`length(btrim(${t.name})) > 0`),
  ],
);

export const people = pgTable(
  'people',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userId(),
    name: text('name').notNull(),
    note: text('note'),
    /** Free-form label shown under the name: "Family", "Roommate". */
    relation: text('relation'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('people_user_name_idx').on(t.userId, sql`lower(${t.name})`),
    index('people_user_idx').on(t.userId),
    check('people_name_not_blank', sql`length(btrim(${t.name})) > 0`),
  ],
);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userId(),
    name: text('name').notNull(),
    icon: text('icon'),
    direction: categoryDirectionEnum('direction').notNull().default('expense'),
    /** Bumped on every use so the UI can default to what you actually pick. */
    usageCount: integer('usage_count').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('categories_user_name_idx').on(t.userId, sql`lower(${t.name})`, t.direction),
    index('categories_user_idx').on(t.userId),
  ],
);

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userId(),
    kind: transactionKindEnum('kind').notNull(),
    /** Headline amount, always > 0. The entries carry the real signs. */
    amount: bigint('amount', { mode: 'number' }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    note: text('note'),
    /** Client-supplied dedup key. Makes offline replay safe. */
    idempotencyKey: text('idempotency_key'),
    reversesTransactionId: uuid('reverses_transaction_id').references(
      (): AnyPgColumn => transactions.id,
      { onDelete: 'set null' },
    ),
    reversedByTransactionId: uuid('reversed_by_transaction_id').references(
      (): AnyPgColumn => transactions.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('transactions_idempotency_idx')
      .on(t.userId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    index('transactions_user_occurred_idx').on(t.userId, t.occurredAt.desc()),
    check('transactions_amount_positive', sql`${t.amount} > 0`),
  ],
);

/**
 * The source of truth. Balances are never stored; they are always
 * SUM(amount) over these rows.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userId(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    bucket: entryBucketEnum('bucket').notNull(),
    /** Signed paise, debit-positive. All entries of a transaction sum to 0. */
    amount: bigint('amount', { mode: 'number' }).notNull(),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'restrict' }),
    poolId: uuid('pool_id').references(() => ownershipPools.id, { onDelete: 'restrict' }),
    personId: uuid('person_id').references(() => people.id, { onDelete: 'restrict' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    memo: text('memo'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('entries_tx_idx').on(t.transactionId),
    index('entries_user_bucket_idx').on(t.userId, t.bucket),
    index('entries_account_idx').on(t.userId, t.accountId),
    index('entries_pool_idx').on(t.userId, t.poolId),
    index('entries_person_idx').on(t.userId, t.personId),
    check('entries_amount_nonzero', sql`${t.amount} <> 0`),
    // Structural guarantees, enforced by the database and not only by code.
    check(
      'entries_asset_requires_account_and_pool',
      sql`${t.bucket} <> 'asset' or (${t.accountId} is not null and ${t.poolId} is not null)`,
    ),
    check(
      'entries_debt_requires_person',
      sql`${t.bucket} not in ('receivable', 'payable') or ${t.personId} is not null`,
    ),
    check(
      'entries_category_only_on_flows',
      sql`${t.categoryId} is null or ${t.bucket} in ('expense', 'income')`,
    ),
  ],
);

/**
 * Who a shared bill was split with, and for how much. Kept alongside the
 * entries so "₹1,200 dinner, Rahul owed ₹800" survives as an intention,
 * not just as two numbers.
 */
export const transactionParticipants = pgTable(
  'transaction_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userId(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'restrict' }),
    /** Their share of the bill in paise, always > 0. */
    shareAmount: bigint('share_amount', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('participants_tx_person_idx').on(t.transactionId, t.personId),
    index('participants_person_idx').on(t.userId, t.personId),
    check('participants_share_positive', sql`${t.shareAmount} > 0`),
  ],
);

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userId(),
    transactionId: uuid('transaction_id').references(() => transactions.id, { onDelete: 'cascade' }),
    /** Supabase Storage object path. The bytes never live in Postgres. */
    storagePath: text('storage_path').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    kind: text('kind').notNull().default('receipt'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('attachments_tx_idx').on(t.transactionId), index('attachments_user_idx').on(t.userId)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userId(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_user_created_idx').on(t.userId, t.createdAt.desc())],
);

/** A point-in-time cash count. Never edits history; it produces an adjustment. */
export const reconciliations = pgTable(
  'reconciliations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: userId(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    expectedAmount: bigint('expected_amount', { mode: 'number' }).notNull(),
    actualAmount: bigint('actual_amount', { mode: 'number' }).notNull(),
    differenceAmount: bigint('difference_amount', { mode: 'number' }).notNull(),
    adjustmentTransactionId: uuid('adjustment_transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('reconciliations_user_idx').on(t.userId, t.createdAt.desc())],
);

/* ------------------------------------------------------------------ *
 * Relations
 * ------------------------------------------------------------------ */

export const transactionsRelations = relations(transactions, ({ many }) => ({
  entries: many(ledgerEntries),
  participants: many(transactionParticipants),
  attachments: many(attachments),
}));

export const ledgerEntriesRelations = relations(ledgerEntries, ({ one }) => ({
  transaction: one(transactions, {
    fields: [ledgerEntries.transactionId],
    references: [transactions.id],
  }),
  account: one(accounts, { fields: [ledgerEntries.accountId], references: [accounts.id] }),
  pool: one(ownershipPools, { fields: [ledgerEntries.poolId], references: [ownershipPools.id] }),
  person: one(people, { fields: [ledgerEntries.personId], references: [people.id] }),
  category: one(categories, { fields: [ledgerEntries.categoryId], references: [categories.id] }),
}));

export const participantsRelations = relations(transactionParticipants, ({ one }) => ({
  transaction: one(transactions, {
    fields: [transactionParticipants.transactionId],
    references: [transactions.id],
  }),
  person: one(people, { fields: [transactionParticipants.personId], references: [people.id] }),
}));

export type DbTransaction = typeof transactions.$inferSelect;
export type DbLedgerEntry = typeof ledgerEntries.$inferSelect;
export type NewLedgerEntry = typeof ledgerEntries.$inferInsert;
export type DbAccount = typeof accounts.$inferSelect;
export type DbPool = typeof ownershipPools.$inferSelect;
export type DbPerson = typeof people.$inferSelect;
export type DbCategory = typeof categories.$inferSelect;
