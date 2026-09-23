import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env, hasStorage } from '../env';
import { serviceUnavailable, badRequest } from '../http/errors';

/**
 * Supabase Storage holds FILES only — receipt photos and backup archives. No
 * transaction, balance or debt ever lives here; Neon Postgres remains the
 * single source of truth.
 *
 * Every object sits under the owner's user id and the bucket is private:
 * files are only ever reached through short-lived signed URLs.
 */

export interface StorageBackend {
  upload(path: string, body: Buffer, contentType: string): Promise<void>;
  signedUrl(path: string, expiresInSeconds: number): Promise<string>;
  remove(path: string): Promise<void>;
}

class SupabaseBackend implements StorageBackend {
  private readonly client: SupabaseClient;
  private readonly bucket: string;

  constructor() {
    this.client = createClient(env.SUPABASE_URL as string, env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.bucket = env.SUPABASE_STORAGE_BUCKET;
  }

  async upload(path: string, body: Buffer, contentType: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).upload(path, body, { contentType, upsert: false });
    if (error) {
      console.error('[storage] upload failed', error.message);
      throw serviceUnavailable('We could not store that file. Nothing was changed.', 'storage_upload_failed');
    }
  }

  async signedUrl(path: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUrl(path, expiresInSeconds);
    if (error || !data) throw serviceUnavailable('We could not open that file.', 'storage_signing_failed');
    return data.signedUrl;
  }

  async remove(path: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).remove([path]);
    if (error) console.warn('[storage] could not delete object', path, error.message);
  }
}

let backend: StorageBackend | null = null;

export function getStorage(): StorageBackend {
  if (backend) return backend;
  if (!hasStorage) {
    throw serviceUnavailable(
      'Receipt storage is not set up yet. Add the Supabase settings to the deployment to turn it on.',
      'storage_unavailable',
    );
  }
  backend = new SupabaseBackend();
  return backend;
}

/** Test-only seam. */
export function __setStorageForTesting(fake: StorageBackend | null): void {
  backend = fake;
}

export const RECEIPT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']);

/**
 * Serverless request bodies are capped at 4.5 MB, and base64 adds a third, so
 * the decoded limit sits comfortably under that. The client downsizes photos
 * long before they get near it.
 */
export const MAX_RECEIPT_BYTES = 3 * 1024 * 1024;

export function objectPath(userId: string, kind: 'receipt' | 'backup', fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'file';
  return `${userId}/${kind}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
}

export function assertOwnedPath(userId: string, path: string): void {
  if (!path.startsWith(`${userId}/`)) throw badRequest('That file is not yours.', 'forbidden_path');
}

export { hasStorage };
