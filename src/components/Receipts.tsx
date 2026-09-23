import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, FileText, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '../lib/api';
import { prepareImage, ImageError } from '../lib/image';
import { Sheet } from './ui/Sheet';
import { Button } from './ui/Button';
import { SectionLabel, Skeleton } from './ui/primitives';

/**
 * Receipts on a transaction.
 *
 * A receipt is evidence about a transaction, not part of it: adding or
 * removing one never changes a balance. Photos are downsized and stripped of
 * location data on the phone before they are sent, and the files are private —
 * the links here expire after ten minutes.
 */

interface Attachment {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  createdAt: string;
  url: string;
}

const MAX_PDF_BYTES = 3 * 1024 * 1024;

export function Receipts({ transactionId }: { transactionId: string }) {
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const [removing, setRemoving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api.get<Attachment[]>(`/transactions/${transactionId}/attachments`));
      setUnavailable(null);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'storage_unavailable') {
        setUnavailable(error.message);
        setItems([]);
      } else {
        setItems([]);
      }
    }
  }, [transactionId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      let body: { fileName: string; contentType: string; data: string };

      if (file.type === 'application/pdf') {
        if (file.size > MAX_PDF_BYTES) throw new ImageError('That PDF is larger than 3 MB.');
        const buffer = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        for (let i = 0; i < buffer.length; i += 0x8000) {
          binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
        }
        body = { fileName: file.name, contentType: 'application/pdf', data: btoa(binary) };
      } else {
        const image = await prepareImage(file);
        body = {
          fileName: file.name.replace(/\.[^.]+$/, '') + '.jpg',
          contentType: image.mediaType,
          data: image.data,
        };
      }

      const added = await api.post<Attachment>(`/transactions/${transactionId}/attachments`, body);
      setItems((prev) => [...(prev ?? []), added]);
      toast.success('Receipt attached');
    } catch (error) {
      toast.error(
        error instanceof ImageError || error instanceof ApiError
          ? error.message
          : 'That receipt could not be attached.',
      );
    } finally {
      setUploading(false);
    }
  }

  async function remove(item: Attachment) {
    setRemoving(true);
    try {
      await api.delete(`/attachments/${item.id}`);
      setItems((prev) => (prev ?? []).filter((a) => a.id !== item.id));
      setViewing(null);
      toast.success('Receipt removed', { description: 'The transaction itself is unchanged.' });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'That receipt could not be removed.');
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section className="mt-5">
      <SectionLabel>Receipts</SectionLabel>

      {unavailable ? (
        <p className="rounded-lg bg-surface-sunken px-4 py-3 text-[13.5px] leading-relaxed text-ink-soft">
          {unavailable}
        </p>
      ) : items === null ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setViewing(item)}
              className="aspect-square overflow-hidden rounded-lg border border-line bg-surface-sunken transition-transform duration-[140ms] ease-out-strong active:scale-[0.97]"
            >
              {item.contentType.startsWith('image/') ? (
                <img src={item.url} alt="Receipt" loading="lazy" className="size-full object-cover" />
              ) : (
                <span className="flex size-full flex-col items-center justify-center gap-1 text-ink-muted">
                  <FileText className="size-6" />
                  <span className="text-[11px]">PDF</span>
                </span>
              )}
            </button>
          ))}

          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={uploading}
            className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong text-ink-muted transition-transform duration-[140ms] ease-out-strong active:scale-[0.97] disabled:opacity-60"
          >
            {uploading ? (
              <span className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <Camera className="size-5" />
            )}
            <span className="text-[12px] font-medium">{uploading ? 'Adding…' : 'Add receipt'}</span>
          </button>
        </div>
      )}

      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        className="sr-only"
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      <Sheet open={viewing !== null} onClose={() => setViewing(null)} title="Receipt">
        {viewing && (
          <div className="space-y-3 pb-2">
            {viewing.contentType.startsWith('image/') ? (
              <img src={viewing.url} alt="Receipt" className="w-full rounded-lg border border-line" />
            ) : (
              <a
                href={viewing.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg border border-line px-4 py-3 text-[15px] font-medium text-accent"
              >
                <FileText className="size-4" /> Open {viewing.fileName}
              </a>
            )}
            <Button
              variant="danger"
              block
              icon={<Trash2 className="size-4" />}
              loading={removing}
              onClick={() => void remove(viewing)}
            >
              Remove receipt
            </Button>
          </div>
        )}
      </Sheet>
    </section>
  );
}
