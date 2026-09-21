import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  BellRing,
  Check,
  Download,
  Eye,
  EyeOff,
  HeartPulse,
  LogOut,
  Scale,
  ShieldCheck,
  Tag,
  Upload,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useLedger } from '../store/ledger';
import { usePrefs } from '../store/prefs';
import { useSession, signOut } from '../lib/auth-client';
import { ScreenHeader } from '../components/AppShell';
import { Avatar, Card, IconBadge, List, Row, SectionLabel, Skeleton } from '../components/ui/primitives';
import { Button } from '../components/ui/Button';
import { Sheet } from '../components/ui/Sheet';
import { api, ApiError } from '../lib/api';
import type { LedgerHealthReport, ImportPreview } from '../lib/types';
import { CategoriesSheet, CashCheckHistorySheet, PoolsSheet } from './Manage';
import { ReminderSettingsSheet } from '../components/ReminderSettings';
import { isNative, clearWidget } from '../lib/native';

export function MoreScreen() {
  const navigate = useNavigate();
  const { data: session } = useSession();
  const balancesHidden = usePrefs((s) => s.balancesHidden);
  const toggleBalances = usePrefs((s) => s.toggleBalances);
  const reminderEnabled = usePrefs((s) => s.reminderEnabled);
  const reminderTime = usePrefs((s) => s.reminderTime);
  const [health, setHealth] = useState<'closed' | 'open'>('closed');
  const [backup, setBackup] = useState(false);
  const [categories, setCategories] = useState(false);
  const [pools, setPools] = useState(false);
  const [checks, setChecks] = useState(false);
  const [reminder, setReminder] = useState(false);

  return (
    <div>
      <ScreenHeader title="More" />

      <Card className="mb-5 flex items-center gap-3.5 p-4">
        {session?.user ? (
          <>
            <Avatar name={session.user.name || session.user.email} size={44} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[16px] font-medium">{session.user.name}</p>
              <p className="truncate text-[13.5px] text-ink-muted">{session.user.email}</p>
            </div>
          </>
        ) : (
          <>
            <Skeleton className="size-11 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-40" />
            </div>
          </>
        )}
      </Card>

      <section className="mb-5">
        <SectionLabel>Your money</SectionLabel>
        <List>
          <Row
            icon={<IconBadge tone="neutral" size="sm"><Wallet /></IconBadge>}
            title="Accounts & pools"
            subtitle="Where your money is, and whose it is"
            onClick={() => navigate('/accounts')}
            chevron
          />
          <Row
            icon={<IconBadge tone="neutral" size="sm"><Users /></IconBadge>}
            title="Whose money"
            subtitle="Your money, Dad money, anything you keep separate"
            onClick={() => setPools(true)}
            chevron
          />
          <Row
            icon={<IconBadge tone="neutral" size="sm"><Tag /></IconBadge>}
            title="Categories"
            subtitle="What you sort your spending into"
            onClick={() => setCategories(true)}
            chevron
          />
          <Row
            icon={<IconBadge tone="neutral" size="sm"><Scale /></IconBadge>}
            title="Cash checks"
            subtitle="Every time you counted, and what it found"
            onClick={() => setChecks(true)}
            chevron
          />
          <Row
            icon={<IconBadge tone="neutral" size="sm">{balancesHidden ? <EyeOff /> : <Eye />}</IconBadge>}
            title="Hide balances"
            subtitle="Blur every figure at a glance"
            trailing={<Toggle on={balancesHidden} onChange={toggleBalances} />}
            onClick={toggleBalances}
          />
        </List>
      </section>

      <section className="mb-5">
        <SectionLabel>Data</SectionLabel>
        <List>
          <Row
            icon={<IconBadge tone="neutral" size="sm"><BellRing /></IconBadge>}
            title="Daily reminder"
            subtitle={
              reminderEnabled
                ? `Every day at ${reminderTime}`
                : isNative()
                  ? 'Off'
                  : 'Needs the Android app'
            }
            onClick={() => setReminder(true)}
            chevron
          />
          <Row
            icon={<IconBadge tone="neutral" size="sm"><Download /></IconBadge>}
            title="Backup & export"
            subtitle="JSON or CSV, and safe re-import"
            onClick={() => setBackup(true)}
            chevron
          />
          <Row
            icon={<IconBadge tone="neutral" size="sm"><HeartPulse /></IconBadge>}
            title="Ledger health"
            subtitle="Check that every rupee still adds up"
            onClick={() => setHealth('open')}
            chevron
          />
        </List>
      </section>

      <section className="mb-5">
        <SectionLabel>Account</SectionLabel>
        <List>
          <Row
            icon={<IconBadge tone="neutral" size="sm"><ShieldCheck /></IconBadge>}
            title="Privacy"
            subtitle="Your ledger is yours alone. Nothing is shared."
          />
          <Row
            icon={<IconBadge tone="negative" size="sm"><LogOut /></IconBadge>}
            title="Sign out"
            danger
            onClick={async () => {
              // The widget must not keep showing a signed-out person's money.
              await clearWidget();
              await signOut();
              window.location.href = '/signin';
            }}
          />
        </List>
      </section>

      <p className="pb-4 text-center text-[12px] text-ink-faint">
        Every rupee, accounted for.
      </p>

      <ReminderSettingsSheet open={reminder} onClose={() => setReminder(false)} />
      <PoolsSheet open={pools} onClose={() => setPools(false)} />
      <CategoriesSheet open={categories} onClose={() => setCategories(false)} />
      <CashCheckHistorySheet open={checks} onClose={() => setChecks(false)} />
      <HealthSheet open={health === 'open'} onClose={() => setHealth('closed')} />
      <BackupSheet open={backup} onClose={() => setBackup(false)} />
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <span
      role="switch"
      aria-checked={on}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={`relative inline-flex h-[30px] w-[50px] shrink-0 items-center rounded-full transition-colors duration-200 ease-out ${
        on ? 'bg-accent' : 'bg-line-strong'
      }`}
    >
      <span
        className="absolute left-0.5 size-[26px] rounded-full bg-white shadow-[0_1px_3px_rgb(16_16_26/0.2)] transition-transform duration-[220ms] ease-out-strong"
        style={{ transform: on ? 'translateX(20px)' : 'translateX(0)' }}
      />
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Ledger health
 * ------------------------------------------------------------------ */

function HealthSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [report, setReport] = useState<LedgerHealthReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    setReport(null);
    try {
      setReport(await api.get<LedgerHealthReport>('/ledger/health'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not run the checks.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Ledger health"
      action={
        <button
          type="button"
          onClick={run}
          className="text-[15px] font-medium text-accent press active:scale-[0.97]"
        >
          {report ? 'Run again' : 'Run'}
        </button>
      }
    >
      <div className="space-y-4 pb-2">
        <p className="text-[14px] leading-relaxed text-ink-muted">
          These checks query your real data every time. Nothing here is a placeholder — a tick means the
          database was asked and answered.
        </p>

        {running && <Skeleton className="h-48 w-full rounded-xl" />}

        {error && (
          <p className="rounded-md bg-negative-soft px-4 py-3 text-[14px] text-negative">
            {error}
          </p>
        )}

        {report && (
          <>
            <div
              className={`rounded-lg px-4 py-3.5 text-[15px] font-medium ${
                report.healthy
                  ? 'bg-positive-soft text-positive'
                  : 'bg-negative-soft text-negative'
              }`}
            >
              {report.healthy
                ? 'Everything adds up.'
                : `${report.checks.filter((c) => c.status !== 'pass').length} check(s) need attention.`}
            </div>

            <List>
              {report.checks.map((check) => (
                <Row
                  key={check.id}
                  icon={
                    check.status === 'pass' ? (
                      <Check className="size-[18px] text-positive" />
                    ) : (
                      <X className="size-[18px] text-negative" />
                    )
                  }
                  title={check.label}
                  subtitle={check.detail || undefined}
                />
              ))}
            </List>

            <div className="card px-4 py-3.5 text-[13.5px] text-ink-soft">
              <div className="flex justify-between py-0.5">
                <span>Transactions</span>
                <span className="tnum">{report.totals.transactions.toLocaleString()}</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span>Ledger entries</span>
                <span className="tnum">{report.totals.entries.toLocaleString()}</span>
              </div>
            </div>

            <p className="text-center text-[12px] text-ink-faint">
              Checked {new Date(report.checkedAt).toLocaleTimeString()}
            </p>
          </>
        )}

        {!report && !running && !error && (
          <Button block variant="secondary" icon={<Activity className="size-4" />} onClick={run}>
            Run the checks
          </Button>
        )}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ *
 * Backup
 * ------------------------------------------------------------------ */

function BackupSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const refresh = useLedger((s) => s.refresh);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [file, setFile] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download(format: 'json' | 'csv') {
    try {
      const response = await api.raw(`/backup/export?format=${format}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ledger-${new Date().toISOString().slice(0, 10)}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported as ${format.toUpperCase()}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'We could not build that export.');
    }
  }

  async function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = '';
    if (!selected) return;

    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const parsed = JSON.parse(await selected.text()) as unknown;
      // Validate on the server BEFORE anything is written, and show the user
      // exactly what the file contains.
      const result = await api.post<ImportPreview>('/backup/preview', parsed);
      setFile(parsed);
      setPreview(result);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'That file could not be read as a Ledger backup.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (!file || !preview?.valid) return;
    setBusy(true);
    try {
      const result = await api.post<{ imported: { transactions: number }; skipped: { transactions: number } }>(
        '/backup/import',
        file,
      );
      await refresh();
      toast.success(`${result.imported.transactions} transactions imported`, {
        description: result.skipped.transactions
          ? `${result.skipped.transactions} were already here and were left alone.`
          : undefined,
      });
      setPreview(null);
      setFile(null);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nothing was imported.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Backup & export">
      <div className="space-y-5 pb-2">
        <section>
          <SectionLabel>Export</SectionLabel>
          <div className="flex gap-2">
            <Button variant="secondary" block icon={<Download className="size-4" />} onClick={() => download('json')}>
              JSON
            </Button>
            <Button variant="secondary" block icon={<Download className="size-4" />} onClick={() => download('csv')}>
              CSV
            </Button>
          </div>
          <p className="mt-2 px-1 text-[12.5px] text-ink-muted">
            JSON restores completely. CSV is one row per ledger entry, for a spreadsheet.
          </p>
        </section>

        <section>
          <SectionLabel>Import</SectionLabel>
          <label className="block">
            <input type="file" accept="application/json,.json" onChange={choose} className="sr-only" />
            <span className="flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface text-[15px] font-medium press active:scale-[0.98]">
              <Upload className="size-4" />
              Choose a backup file
            </span>
          </label>

          {busy && !preview && <Skeleton className="mt-3 h-24 w-full rounded-lg" />}

          {preview && (
            <div className="animate-fade mt-3">
              <div className="card divide-y divide-line text-[14px]">
                {(
                  [
                    ['Transactions', preview.counts.transactions],
                    ['Accounts', preview.counts.accounts],
                    ['People', preview.counts.people],
                    ['Categories', preview.counts.categories],
                  ] as const
                ).map(([label, count]) => (
                  <div key={label} className="flex justify-between px-4 py-2.5">
                    <span className="text-ink-soft">{label}</span>
                    <span className="tnum font-medium">{count.toLocaleString()}</span>
                  </div>
                ))}
              </div>

              {!preview.valid && (
                <div className="mt-3 rounded-md bg-negative-soft px-4 py-3 text-[13.5px] text-negative">
                  <p className="font-medium">This backup does not add up, so it cannot be imported.</p>
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                    {preview.problems.slice(0, 4).map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="mt-2 px-1 text-[12.5px] text-ink-muted">
                Importing only adds. Anything already in your ledger is left exactly as it is.
              </p>

              <div className="mt-3 flex gap-2">
                <Button variant="secondary" block onClick={() => { setPreview(null); setFile(null); }}>
                  Cancel
                </Button>
                <Button block onClick={confirmImport} loading={busy} disabled={!preview.valid}>
                  Import
                </Button>
              </div>
            </div>
          )}

          {error && <p className="mt-3 text-[13px] text-negative">{error}</p>}
        </section>
      </div>
    </Sheet>
  );
}
