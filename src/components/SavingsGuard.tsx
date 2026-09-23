import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatPaise } from '@shared/money';
import { Mascot } from './Mascot';
import { Button } from './ui/Button';
import type { AccountLike } from '../lib/savings';

/**
 * Chillar guards the savings.
 *
 * Taking money OUT of a savings account — spending from it, moving it to cash,
 * lending from it — gets a furious Chillar: a small one on the form the moment
 * savings is picked as the source, and a full-screen "don't do it" before it
 * is saved. It is a speed bump, not a wall: "Withdraw anyway" always works.
 * Moving money INTO savings, or between two savings accounts, is left alone.
 */

const SCOLDINGS = [
  'Oye! Hands off the savings!',
  'Nahi! That’s future-you’s money!',
  'Put it back. Slowly.',
  'Savings are for saving, not spending!',
];

/** The little one that pops up on the form while savings is the source. */
export function SavingsPeek({ account }: { account: AccountLike }) {
  // One line per appearance, not a new one every render.
  const [line] = useState(() => SCOLDINGS[Math.floor(Math.random() * SCOLDINGS.length)]!);

  return (
    <div
      role="status"
      className="peek-in flex items-center gap-3 rounded-lg border border-[color-mix(in_srgb,#f5533d_35%,transparent)] bg-[color-mix(in_srgb,#f5533d_10%,transparent)] px-3 py-2.5"
    >
      <Mascot size={46} mood="angry" className="shrink-0" />
      <div className="min-w-0">
        <p className="text-[14px] font-semibold text-[#d2402c]">{line}</p>
        <p className="text-[12.5px] leading-snug text-ink-soft">
          This takes money out of {account.name}.
        </p>
      </div>
    </div>
  );
}

export function SavingsAlarm({
  accountName,
  amount,
  onKeep,
  onProceed,
}: {
  accountName: string;
  amount: number;
  onKeep: () => void;
  onProceed: () => void;
}) {
  const keep = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    keep.current?.focus();
    // A buzz on phones that have one. Harmless where they do not.
    navigator.vibrate?.([70, 50, 70]);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onKeep();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKeep]);

  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="savings-alarm-title"
      aria-describedby="savings-alarm-body"
      className="animate-fade fixed inset-0 z-[70] flex items-center justify-center bg-[rgb(40_6_4/0.55)] px-6 backdrop-blur-md"
    >
      <div className="alarm-pop card w-full max-w-[360px] overflow-hidden px-6 pt-6 pb-5 text-center">
        <div className="-mt-1 flex justify-center">
          <Mascot size={150} mood="angry" label="Chillar, furious" />
        </div>

        <h2 id="savings-alarm-title" className="mt-2 text-[24px] leading-tight font-bold tracking-[-0.02em] text-[#d2402c]">
          Don’t remove money!
        </h2>
        <p id="savings-alarm-body" className="mt-2 text-[15px] leading-relaxed text-ink-soft">
          You’re about to take <span className="tnum font-semibold text-ink">{formatPaise(amount)}</span> out of{' '}
          <span className="font-semibold text-ink">{accountName}</span>. That’s money future-you was counting on.
        </p>

        <div className="mt-5 space-y-2">
          <Button ref={keep} block size="lg" onClick={onKeep}>
            Keep it saved
          </Button>
          <Button block variant="ghost" onClick={onProceed}>
            Withdraw anyway
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
