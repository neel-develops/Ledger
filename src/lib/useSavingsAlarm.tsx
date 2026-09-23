import { useCallback, useState } from 'react';
import { SavingsAlarm } from '../components/SavingsGuard';
import type { AccountLike } from './savings';

interface AlarmRequest {
  account: AccountLike;
  amount: number;
  resolve: (proceed: boolean) => void;
}

/**
 * `ask(account, amount)` shows the furious-Chillar alarm and resolves true for
 * "Withdraw anyway", false for "Keep it saved". Render `alarm` once, anywhere.
 */
export function useSavingsAlarm() {
  const [request, setRequest] = useState<AlarmRequest | null>(null);

  const ask = useCallback(
    (account: AccountLike, amount: number) =>
      new Promise<boolean>((resolve) => setRequest({ account, amount, resolve })),
    [],
  );

  const answer = (proceed: boolean) => {
    request?.resolve(proceed);
    setRequest(null);
  };

  const alarm = request ? (
    <SavingsAlarm
      accountName={request.account.name}
      amount={request.amount}
      onKeep={() => answer(false)}
      onProceed={() => answer(true)}
    />
  ) : null;

  return { ask, alarm };
}
