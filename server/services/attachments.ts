import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { attachments, transactions, auditLogs } from '../db/schema';
import { badRequest, notFound } from '../http/errors';
import {
  getStorage,
  objectPath,
  assertOwnedPath,
  RECEIPT_TYPES,
  MAX_RECEIPT_BYTES,
} from './storage';

/**
 * Receipts attached to transactions.
 *
 * The photo lives in object storage; this table only records that it exists
 * and whose it is. Attaching or removing a receipt never touches the ledger —
 * a receipt is evidence about a transaction, not part of it.
 */

export const uploadAttachmentSchema = z.object({
  fileName: z.string().min(1).max(120),
  contentType: z.string().max(60),
  /** Base64, no data: prefix. */
  data: z.string().min(1).max(4_400_000),
});

export interface AttachmentView {
  id: string;
  transactionId: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  createdAt: string;
  /** Short-lived. Fetch a fresh one rather than storing it. */
  url: string;
}

const URL_LIFETIME_SECONDS = 10 * 60;

async function requireOwnedTransaction(userId: string, transactionId: string): Promise<void> {
  const [row] = await getDb()
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)));
  if (!row) throw notFound('That transaction');
}

export async function addAttachment(
  userId: string,
  transactionId: string,
  input: z.infer<typeof uploadAttachmentSchema>,
): Promise<AttachmentView> {
  await requireOwnedTransaction(userId, transactionId);

  if (!RECEIPT_TYPES.has(input.contentType)) {
    throw badRequest('Receipts can be JPEG, PNG, WebP, HEIC or PDF.', 'unsupported_file_type');
  }

  // Strict base64 only — anything else is either corrupt or not what it claims.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.data)) {
    throw badRequest('That file could not be read.', 'invalid_file');
  }
  const body = Buffer.from(input.data, 'base64');
  if (body.byteLength === 0) throw badRequest('That file is empty.', 'invalid_file');
  if (body.byteLength > MAX_RECEIPT_BYTES) throw badRequest('That file is larger than 3 MB.', 'file_too_large');

  const storage = getStorage();
  const path = objectPath(userId, 'receipt', input.fileName);
  await storage.upload(path, body, input.contentType);

  let row: typeof attachments.$inferSelect | undefined;
  try {
    [row] = await getDb()
      .insert(attachments)
      .values({
        userId,
        transactionId,
        storagePath: path,
        fileName: input.fileName,
        contentType: input.contentType,
        byteSize: body.byteLength,
        kind: 'receipt',
      })
      .returning();
  } catch (error) {
    // Do not leave an unreferenced object behind if the record failed.
    await storage.remove(path);
    throw error;
  }
  if (!row) throw new Error('attachment insert returned no row');

  await getDb().insert(auditLogs).values({
    userId,
    action: 'attachment.add',
    entityType: 'transaction',
    entityId: transactionId,
    metadata: { attachmentId: row.id, byteSize: body.byteLength },
  });

  return {
    id: row.id,
    transactionId,
    fileName: row.fileName,
    contentType: row.contentType,
    byteSize: row.byteSize,
    createdAt: row.createdAt.toISOString(),
    url: await storage.signedUrl(path, URL_LIFETIME_SECONDS),
  };
}

export async function listAttachments(userId: string, transactionId: string): Promise<AttachmentView[]> {
  await requireOwnedTransaction(userId, transactionId);

  const rows = await getDb()
    .select()
    .from(attachments)
    .where(and(eq(attachments.userId, userId), eq(attachments.transactionId, transactionId)))
    .orderBy(asc(attachments.createdAt));

  if (rows.length === 0) return [];
  const storage = getStorage();

  return Promise.all(
    rows.map(async (row) => {
      assertOwnedPath(userId, row.storagePath);
      return {
        id: row.id,
        transactionId,
        fileName: row.fileName,
        contentType: row.contentType,
        byteSize: row.byteSize,
        createdAt: row.createdAt.toISOString(),
        url: await storage.signedUrl(row.storagePath, URL_LIFETIME_SECONDS),
      };
    }),
  );
}

/**
 * The record goes first, then the file. If the file deletion then fails, what
 * remains is an unreachable private object — harmless. The other order could
 * leave a record pointing at nothing.
 */
export async function removeAttachment(userId: string, attachmentId: string): Promise<void> {
  const [row] = await getDb()
    .delete(attachments)
    .where(and(eq(attachments.id, attachmentId), eq(attachments.userId, userId)))
    .returning();
  if (!row) throw notFound('That receipt');

  assertOwnedPath(userId, row.storagePath);
  await getStorage().remove(row.storagePath);

  await getDb().insert(auditLogs).values({
    userId,
    action: 'attachment.remove',
    entityType: 'transaction',
    entityId: row.transactionId,
    metadata: { attachmentId },
  });
}
