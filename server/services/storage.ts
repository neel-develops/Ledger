import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env, hasStorage } from '../env';
import { serviceUnavailable, badRequest } from '../http/errors';

/**
 * Supabase Storage holds FILES only — backup archives and receipt images.
 * No transaction, balance or debt ever lives here; Neon Postgres remains the
 * single source of truth.
 */

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!hasStorage) {
    throw serviceUnavailable('File storage is not configured for this deployment.', 'storage_unavailable');
  }
  if (!client) {
    client = createClient(env.SUPABASE_URL as string, env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
  'application/json',
  'text/csv',
]);

const MAX_BYTES = 10 * 1024 * 1024;

/** Every object is namespaced by user id, so one user's path can never reach another's. */
function objectPath(userId: string, kind: string, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  return `${userId}/${kind}/${Date.now()}-${safeName}`;
}

export async function uploadFile(params: {
  userId: string;
  kind: 'receipt' | 'backup';
  fileName: string;
  contentType: string;
  body: Buffer;
}): Promise<{ path: string; byteSize: number }> {
  if (!ALLOWED_CONTENT_TYPES.has(params.contentType)) {
    throw badRequest('That file type is not supported.', 'unsupported_file_type');
  }
  if (params.body.byteLength > MAX_BYTES) {
    throw badRequest('That file is larger than 10 MB.', 'file_too_large');
  }

  const path = objectPath(params.userId, params.kind, params.fileName);
  const { error } = await getClient()
    .storage.from(env.SUPABASE_STORAGE_BUCKET)
    .upload(path, params.body, { contentType: params.contentType, upsert: false });

  if (error) throw serviceUnavailable('We could not store that file.', 'storage_upload_failed');
  return { path, byteSize: params.body.byteLength };
}

/** Short-lived signed URL. Objects are never public. */
export async function getSignedUrl(userId: string, path: string, expiresInSeconds = 300): Promise<string> {
  if (!path.startsWith(`${userId}/`)) throw badRequest('That file is not yours.', 'forbidden_path');

  const { data, error } = await getClient()
    .storage.from(env.SUPABASE_STORAGE_BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data) throw serviceUnavailable('We could not open that file.', 'storage_signing_failed');
  return data.signedUrl;
}

export { hasStorage };
