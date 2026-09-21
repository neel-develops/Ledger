import { useCallback, useEffect, useState } from 'react';
import { Plus, Scale, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { formatPaise } from '@shared/money';
import type { CategoryView } from '@shared/domain';
import { api, ApiError } from '../lib/api';
import { useLedger } from '../store/ledger';
import { Sheet } from '../components/ui/Sheet';
import { Button } from '../components/ui/Button';
import { Card, EmptyState, Field, List, Row, SectionLabel, Segmented, Skeleton, TextInput } from '../components/ui/primitives';
import { Money } from '../components/ui/Money';

/* ------------------------------------------------------------------ *
 * Categories
 * ------------------------------------------------------------------ */

export function CategoriesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const categories = useLedger((s) => s.categories);
  const refresh = useLedger((s) => s.refresh);

  const [name, setName] = useState('');
  const [direction, setDirection] = useState<'expense' | 'income'>('expense');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = (categories ?? []).filter((c) => c.direction === direction);

  async function add() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.post('/categories', { name: name.trim(), direction });
      await refresh();
      toast.success(`“${name.trim()}” added`);
      setName('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not add that category.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Categories">
      <div className="space-y-4 pb-2">
        <Segmented
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'expense', label: 'Spending' },
            { value: 'income', label: 'Income' },
          ]}
        />

        <div className="flex gap-2">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
            placeholder={direction === 'expense' ? 'e.g. Petrol' : 'e.g. Freelance'}
            autoComplete="off"
          />
          <Button onClick={add} loading={saving} disabled={!name.trim()} icon={<Plus className="size-4" />}>
            Add
          </Button>
        </div>

        {error && <p className="text-[13px] text-negative">{error}</p>}

        {categories === null ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : shown.length === 0 ? (
          <Card>
            <EmptyState icon={<Tag />} title="No categories yet" description="Add one above." />
          </Card>
        ) : (
          <List>
            {shown.map((category: CategoryView) => (
              <Row
                key={category.id}
                title={category.name}
                subtitle={
                  category.usageCount > 0
                    ? `Used ${category.usageCount} time${category.usageCount === 1 ? '' : 's'}`
                    : 'Not used yet'
                }
              />
            ))}
          </List>
        )}

        <p className="px-1 text-[12.5px] leading-relaxed text-ink-muted">
          Categories you use most float to the top of the add screen, so the one you want is usually the
          first one you see.
        </p>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ *
 * Cash-check history
 * ------------------------------------------------------------------ */

interface ReconciliationRow {
  id: string;
  accountName: string;
  expectedAmount: number;
  actualAmount: number;
  differenceAmount: number;
  adjustmentTransactionId: string | null;
  note: string | null;
  createdAt: string;
}

export function CashCheckHistorySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<ReconciliationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await api.get<ReconciliationRow[]>('/reconciliation'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not load your cash checks.');
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return (
    <Sheet open={open} onClose={onClose} title="Cash checks">
      <div className="space-y-3 pb-2">
        <p className="text-[14px] leading-relaxed text-ink-muted">
          Every time you counted, and what the ledger expected. Each one that disagreed produced a visible
          adjustment — nothing was ever changed quietly.
        </p>

        {error && <p className="text-[13px] text-negative">{error}</p>}

        {rows === null ? (
          <Skeleton className="h-32 w-full rounded-xl" />
        ) : rows.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Scale />}
              title="No cash checks yet"
              description="Open an account and tap Cash check to compare it against what is actually there."
            />
          </Card>
        ) : (
          <>
            <SectionLabel>History</SectionLabel>
            <List>
              {rows.map((row) => (
                <Row
                  key={row.id}
                  title={row.accountName}
                  subtitle={`${new Date(row.createdAt).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })} · expected ${formatPaise(row.expectedAmount)}, counted ${formatPaise(row.actualAmount)}`}
                  trailing={<Money paise={row.differenceAmount} size="sm" tone="auto" signed />}
                />
              ))}
            </List>
          </>
        )}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ *
 * Pools
 * ------------------------------------------------------------------ */

export function PoolsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pools = useLedger((s) => s.pools);
  const dashboard = useLedger((s) => s.dashboard);
  const refresh = useLedger((s) => s.refresh);

  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.post('/pools', { name: name.trim(), kind: 'other' });
      await refresh();
      toast.success(`“${name.trim()}” added`);
      setName('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not add that pool.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Whose money">
      <div className="space-y-4 pb-2">
        <p className="text-[14px] leading-relaxed text-ink-muted">
          A pool says who money belongs to, separately from where it sits. The same ₹5,000 in cash can be
          partly yours and partly someone else’s.
        </p>

        <Field label="Add a pool" hint="Mum’s money, shared house fund, anything you keep separate.">
          <div className="flex gap-2">
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void add()}
              placeholder="e.g. Mum money"
              autoComplete="off"
            />
            <Button onClick={add} loading={saving} disabled={!name.trim()} icon={<Plus className="size-4" />}>
              Add
            </Button>
          </div>
        </Field>

        {error && <p className="text-[13px] text-negative">{error}</p>}

        {pools === null ? (
          <Skeleton className="h-28 w-full rounded-xl" />
        ) : (
          <List>
            {pools.map((pool) => (
              <Row
                key={pool.id}
                title={pool.name}
                subtitle={pool.isDefault ? 'Default' : undefined}
                trailing={
                  <Money paise={dashboard?.byPool.find((p) => p.id === pool.id)?.balance} size="md" maskable />
                }
              />
            ))}
          </List>
        )}
      </div>
    </Sheet>
  );
}
