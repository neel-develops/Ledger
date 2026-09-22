import { CloudOff, DatabaseZap } from 'lucide-react';
import { Card, EmptyState } from './ui/primitives';
import { Button } from './ui/Button';

/**
 * What the user sees when we cannot reach the ledger.
 *
 * It says what we know, promises nothing about their money, and offers the
 * one action that might help. It never shows a status code.
 */
export function ErrorState({
  message,
  unavailable,
  onRetry,
}: {
  message: string | null;
  unavailable?: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="pt-16">
      <Card>
        <EmptyState
          icon={unavailable ? <DatabaseZap /> : <CloudOff />}
          title={unavailable ? 'Your ledger is not connected' : 'We could not load your ledger'}
          description={
            // When the server named the problem, show that rather than a
            // generic line — it usually says exactly which variable is unset.
            message ??
            (unavailable
              ? 'This deployment is not configured yet, so there is nothing to show. No data has been lost.'
              : 'Check your connection and try again. Nothing was changed.')
          }
          action={
            <Button variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          }
        />
      </Card>
    </div>
  );
}
