import { createElement, useEffect, useState } from 'react';
import { Download, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import type { TransactionView } from '@shared/domain';
import { api, ApiError } from '../lib/api';
import { buildStatement } from '../lib/bill';
import { renderBill } from '../lib/billImage';
import { buildReminder } from '../lib/reminder';
import { shareImage } from '../lib/native';
import { Sheet } from './ui/Sheet';
import { Button } from './ui/Button';
import { Skeleton } from './ui/primitives';
import { Mascot } from './Mascot';

/**
 * A picture of what someone owes you, to send them as a reminder.
 *
 * Built from the whole history with them (every page), checked against the
 * ledger's own balance, drawn on the phone, and previewed before anything is
 * shared — the user picks who it goes to. The app never sends it.
 */

interface PersonLedgerPage {
  person: { id: string; name: string; netBalance: number };
  transactions: TransactionView[];
  nextCursor: string | null;
}

/** Enough pages for years of history with one person, without looping forever. */
const MAX_PAGES = 12;

async function fullHistory(personId: string): Promise<PersonLedgerPage> {
  let page = await api.get<PersonLedgerPage>(`/people/${personId}/ledger`);
  const all = [...page.transactions];
  for (let i = 1; page.nextCursor && i < MAX_PAGES; i++) {
    page = await api.get<PersonLedgerPage>(`/people/${personId}/ledger?cursor=${encodeURIComponent(page.nextCursor)}`);
    all.push(...page.transactions);
  }
  return { ...page, transactions: all };
}

async function mascotSvg(): Promise<string | undefined> {
  try {
    const { renderToStaticMarkup } = await import('react-dom/server');
    return renderToStaticMarkup(createElement(Mascot, { size: 190, mood: 'happy' })).replace(
      '<svg',
      '<svg xmlns="http://www.w3.org/2000/svg"',
    );
  } catch {
    return undefined;
  }
}

export function BillSheet({
  open,
  onClose,
  personId,
  fromName,
}: {
  open: boolean;
  onClose: () => void;
  personId: string;
  fromName: string;
}) {
  const [bill, setBill] = useState<{ blob: Blob; url: string; fileName: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let made: string | null = null;
    setBill(null);
    setError(null);

    (async () => {
      try {
        const { person, transactions } = await fullHistory(personId);
        if (person.netBalance <= 0) throw new Error(`${person.name} doesn’t owe you anything right now.`);

        const statement = buildStatement(person, transactions);
        const blob = await renderBill({
          statement,
          personName: person.name,
          fromName,
          theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
          mascotSvg: await mascotSvg(),
        });
        if (cancelled) return;
        made = URL.createObjectURL(blob);
        const slug = person.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bill';
        setBill({
          blob,
          url: made,
          fileName: `ledger-${slug}.png`,
          text: buildReminder(person, transactions) ?? '',
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError || err instanceof Error ? err.message : 'The bill could not be made.');
      }
    })();

    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [open, personId, fromName]);

  async function share() {
    if (!bill) return;
    setSharing(true);
    try {
      const outcome = await shareImage(bill.blob, bill.fileName, bill.text);
      if (outcome === 'downloaded') toast('Bill saved — attach it in WhatsApp.');
      if (outcome === 'shared') onClose();
    } finally {
      setSharing(false);
    }
  }

  function save() {
    if (!bill) return;
    const link = document.createElement('a');
    link.href = bill.url;
    link.download = bill.fileName;
    link.click();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Send a bill">
      <div className="space-y-4 pb-2">
        {error ? (
          <p className="rounded-lg bg-negative-soft px-4 py-3 text-[14px] text-negative">{error}</p>
        ) : bill ? (
          <img
            src={bill.url}
            alt="The bill"
            className="peek-in mx-auto max-h-[56svh] w-auto rounded-[18px] shadow-[0_18px_48px_-18px_rgb(0_0_0/0.55)]"
          />
        ) : (
          <div className="flex flex-col items-center gap-3 py-6">
            <Mascot size={84} mood="thinking" />
            <p className="text-[14px] text-ink-muted">Chillar is writing it up…</p>
            <Skeleton className="h-[320px] w-[220px] rounded-[18px]" />
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="secondary" block icon={<Download className="size-4" />} onClick={save} disabled={!bill}>
            Save image
          </Button>
          <Button block icon={<Share2 className="size-4" />} onClick={share} loading={sharing} disabled={!bill}>
            Share bill
          </Button>
        </div>
        <p className="text-center text-[12.5px] text-ink-muted">
          You choose who it goes to. It comes with a friendly reminder you can edit.
        </p>
      </div>
    </Sheet>
  );
}
