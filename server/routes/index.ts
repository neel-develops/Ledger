import { Router } from 'express';
import { z } from 'zod';
import {
  handler,
  requireAuth,
  userIdOf,
  validate,
  validatedQuery,
  writeLimiter,
  importLimiter,
} from '../http/middleware';
import {
  createTransactionSchema,
  listTransactionsSchema,
  reverseTransactionSchema,
  createAccountSchema,
  updateAccountSchema,
  createPoolSchema,
  createPersonSchema,
  updatePersonSchema,
  createCategorySchema,
  reconciliationSchema,
} from '../domain/inputs';
import {
  createTransaction,
  listTransactions,
  getTransaction,
  reverseTransaction,
  replaceTransaction,
} from '../services/transactions';
import { getDashboard, getAccountBalances, getPeopleBalances, getPoolBalances } from '../services/balances';
import {
  createAccount,
  updateAccount,
  archiveAccount,
  createPool,
  createPerson,
  updatePerson,
  archivePerson,
  listCategories,
  createCategory,
} from '../services/reference';
import { getPersonLedger } from '../services/people';
import { reconcile, listReconciliations } from '../services/reconciliation';
import { getLedgerHealth } from '../services/health';
import { getInsights, type InsightRange } from '../services/insights';
import { exportBackup, toCsv, validateBackup, importBackup } from '../services/backup';
import { notFound } from '../http/errors';
import { hasDatabase, hasStorage } from '../env';

export function createApiRouter(): Router {
  const api = Router();

  /* ------------------------------ status ------------------------------ */

  api.get('/status', (_req, res) => {
    res.json({
      ok: true,
      database: hasDatabase ? 'connected' : 'not_configured',
      storage: hasStorage ? 'connected' : 'not_configured',
      time: new Date().toISOString(),
    });
  });

  // Everything below this line requires a real session.
  api.use(requireAuth);

  /* ---------------------------- dashboard ----------------------------- */

  api.get(
    '/dashboard',
    handler(async (req, res) => {
      const userId = userIdOf(req);
      const [summary, recent] = await Promise.all([
        getDashboard(userId),
        listTransactions(userId, { limit: 5 }),
      ]);
      res.json({ ...summary, recentTransactions: recent.items });
    }),
  );

  /* --------------------------- transactions --------------------------- */

  api.get(
    '/transactions',
    validate(listTransactionsSchema, 'query'),
    handler(async (req, res) => {
      const filters = validatedQuery<z.infer<typeof listTransactionsSchema>>(req);
      res.json(await listTransactions(userIdOf(req), filters));
    }),
  );

  api.post(
    '/transactions',
    writeLimiter,
    validate(createTransactionSchema),
    handler(async (req, res) => {
      const result = await createTransaction(userIdOf(req), req.body);
      // A replayed idempotency key is a success, not a new resource.
      res.status(result.deduplicated ? 200 : 201).json(result);
    }),
  );

  api.get(
    '/transactions/:id',
    handler(async (req, res) => {
      const view = await getTransaction(userIdOf(req), req.params.id as string);
      if (!view) throw notFound('That transaction');
      res.json(view);
    }),
  );

  /**
   * There is no DELETE. Money that happened cannot un-happen; it can only be
   * reversed, and the reversal is itself a visible transaction.
   */
  api.post(
    '/transactions/:id/reverse',
    writeLimiter,
    validate(reverseTransactionSchema),
    handler(async (req, res) => {
      res.status(201).json(await reverseTransaction(userIdOf(req), req.params.id as string, req.body));
    }),
  );

  /**
   * Editing is replacement: the original is reversed and the corrected version
   * written, atomically. Both stay visible in your history.
   */
  api.put(
    '/transactions/:id',
    writeLimiter,
    validate(createTransactionSchema),
    handler(async (req, res) => {
      res.json(await replaceTransaction(userIdOf(req), req.params.id as string, req.body));
    }),
  );

  /* ------------------------------ accounts ---------------------------- */

  api.get(
    '/accounts',
    handler(async (req, res) => {
      res.json(await getAccountBalances(userIdOf(req)));
    }),
  );

  api.post(
    '/accounts',
    writeLimiter,
    validate(createAccountSchema),
    handler(async (req, res) => {
      res.status(201).json(await createAccount(userIdOf(req), req.body));
    }),
  );

  api.patch(
    '/accounts/:id',
    writeLimiter,
    validate(updateAccountSchema),
    handler(async (req, res) => {
      res.json(await updateAccount(userIdOf(req), req.params.id as string, req.body));
    }),
  );

  api.delete(
    '/accounts/:id',
    writeLimiter,
    handler(async (req, res) => {
      res.json(await archiveAccount(userIdOf(req), req.params.id as string));
    }),
  );

  /* -------------------------------- pools ----------------------------- */

  api.get(
    '/pools',
    handler(async (req, res) => {
      res.json(await getPoolBalances(userIdOf(req)));
    }),
  );

  api.post(
    '/pools',
    writeLimiter,
    validate(createPoolSchema),
    handler(async (req, res) => {
      res.status(201).json(await createPool(userIdOf(req), req.body));
    }),
  );

  /* ------------------------------- people ----------------------------- */

  api.get(
    '/people',
    handler(async (req, res) => {
      res.json(await getPeopleBalances(userIdOf(req), { includeArchived: req.query.archived === 'true' }));
    }),
  );

  api.post(
    '/people',
    writeLimiter,
    validate(createPersonSchema),
    handler(async (req, res) => {
      res.status(201).json(await createPerson(userIdOf(req), req.body));
    }),
  );

  api.patch(
    '/people/:id',
    writeLimiter,
    validate(updatePersonSchema),
    handler(async (req, res) => {
      res.json(await updatePerson(userIdOf(req), req.params.id as string, req.body));
    }),
  );

  api.delete(
    '/people/:id',
    writeLimiter,
    handler(async (req, res) => {
      res.json(await archivePerson(userIdOf(req), req.params.id as string));
    }),
  );

  api.get(
    '/people/:id/ledger',
    handler(async (req, res) => {
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      res.json(await getPersonLedger(userIdOf(req), req.params.id as string, { cursor }));
    }),
  );

  /* ----------------------------- categories --------------------------- */

  api.get(
    '/categories',
    handler(async (req, res) => {
      res.json(await listCategories(userIdOf(req)));
    }),
  );

  api.post(
    '/categories',
    writeLimiter,
    validate(createCategorySchema),
    handler(async (req, res) => {
      res.status(201).json(await createCategory(userIdOf(req), req.body));
    }),
  );

  /* ---------------------------- reconciliation ------------------------ */

  api.get(
    '/reconciliation',
    handler(async (req, res) => {
      res.json(await listReconciliations(userIdOf(req)));
    }),
  );

  api.post(
    '/reconciliation',
    writeLimiter,
    validate(reconciliationSchema),
    handler(async (req, res) => {
      res.json(await reconcile(userIdOf(req), req.body));
    }),
  );

  /* ------------------------------ insights ---------------------------- */

  api.get(
    '/insights',
    handler(async (req, res) => {
      const range = (['week', 'month', 'year'] as const).includes(req.query.range as InsightRange)
        ? (req.query.range as InsightRange)
        : 'week';
      res.json(await getInsights(userIdOf(req), range));
    }),
  );

  /* ---------------------------- ledger health ------------------------- */

  api.get(
    '/ledger/health',
    handler(async (req, res) => {
      res.json(await getLedgerHealth(userIdOf(req)));
    }),
  );

  /* ------------------------------- backup ----------------------------- */

  api.get(
    '/backup/export',
    handler(async (req, res) => {
      const userId = userIdOf(req);
      const backup = await exportBackup(userId);
      const stamp = new Date().toISOString().slice(0, 10);

      if (req.query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="ledger-${stamp}.csv"`);
        res.send(toCsv(backup));
        return;
      }

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="ledger-${stamp}.json"`);
      res.send(JSON.stringify(backup, null, 2));
    }),
  );

  /** Dry run. Tells you exactly what a file contains before anything changes. */
  api.post(
    '/backup/preview',
    importLimiter,
    handler(async (req, res) => {
      res.json(validateBackup(req.body).preview);
    }),
  );

  api.post(
    '/backup/import',
    importLimiter,
    handler(async (req, res) => {
      res.json(await importBackup(userIdOf(req), req.body));
    }),
  );

  api.use((_req, _res, next) => next(notFound('That endpoint')));

  return api;
}
