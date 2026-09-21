import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster, toast } from 'sonner';
import { useSession } from './lib/auth-client';
import { useLedger } from './store/ledger';
import { usePrefs } from './store/prefs';
import { startOutboxSync } from './lib/outbox';
import { AppShell } from './components/AppShell';
import { UpdatePrompt } from './components/UpdatePrompt';
import { Spinner } from './components/ui/Button';
import { HomeScreen } from './screens/Home';
import { ActivityScreen } from './screens/Activity';
import { PeopleScreen } from './screens/People';
import { PersonDetailScreen } from './screens/PersonDetail';
import { InsightsScreen } from './screens/Insights';
import { AccountsScreen } from './screens/Accounts';
import { AccountDetailScreen } from './screens/AccountDetail';
import { TransactionDetailScreen } from './screens/TransactionDetail';
import { MoreScreen } from './screens/More';
import { SignInScreen } from './screens/SignIn';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/signin" element={<SignInScreen />} />
        <Route
          path="*"
          element={
            <Protected>
              <AppShell>
                <UpdatePrompt />
                <Routes>
                  <Route index element={<HomeScreen />} />
                  <Route path="/activity" element={<ActivityScreen />} />
                  <Route path="/people" element={<PeopleScreen />} />
                  <Route path="/people/:id" element={<PersonDetailScreen />} />
                  <Route path="/insights" element={<InsightsScreen />} />
                  <Route path="/accounts" element={<AccountsScreen />} />
                  <Route path="/accounts/:id" element={<AccountDetailScreen />} />
                  <Route path="/transaction/:id" element={<TransactionDetailScreen />} />
                  <Route path="/more" element={<MoreScreen />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </AppShell>
            </Protected>
          }
        />
      </Routes>

      <Toaster
        position="top-center"
        offset={12}
        toastOptions={{
          className: 'glass-strong !rounded-[16px] !border-0 !shadow-raised',
          duration: 3200,
        }}
      />
    </BrowserRouter>
  );
}

/**
 * Nothing renders until we know who the user is. Guessing would mean briefly
 * showing someone else's shell, or an empty ledger that looks like data loss.
 */
function Protected({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  const load = useLedger((s) => s.load);
  const refresh = useLedger((s) => s.refresh);
  const location = useLocation();

  // Depend on the id, not the object. `useSession` hands back a fresh object
  // on every render, so depending on it would re-fetch the whole ledger on
  // each one.
  const userId = session?.user?.id;

  const bindUser = usePrefs((s) => s.bindUser);

  useEffect(() => {
    if (!userId) return;
    // Drop another account's remembered ids before anything reads them.
    bindUser(userId);
    void load();
  }, [userId, load, bindUser]);

  // Replay anything the outbox is holding as soon as the network is back.
  useEffect(() => {
    if (!userId) return;
    return startOutboxSync((result) => {
      if (result.sent > 0) {
        toast.success(`${result.sent} transaction${result.sent === 1 ? '' : 's'} synced`);
        void refresh();
      }
      if (result.failed > 0) {
        toast.error(`${result.failed} queued transaction${result.failed === 1 ? '' : 's'} could not be saved`, {
          description: 'They were not recorded. Please add them again.',
        });
      }
    });
  }, [userId, refresh]);

  if (isPending) {
    return (
      <div className="grid min-h-[100svh] place-items-center text-ink-faint">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (!session?.user) {
    return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
