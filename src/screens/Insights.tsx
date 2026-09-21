import { useCallback, useEffect, useState } from 'react';
import { ChartPie } from 'lucide-react';
import { formatPaise } from '@shared/money';
import { api, ApiError } from '../lib/api';
import { useLedger } from '../store/ledger';
import type { InsightsReport } from '../lib/types';
import { ScreenHeader } from '../components/AppShell';
import { Card, EmptyState, SectionLabel, Segmented, Skeleton } from '../components/ui/primitives';
import { Money } from '../components/ui/Money';
import { ErrorState } from '../components/ErrorState';

type Range = 'week' | 'month' | 'year';

/**
 * Insights are drawn from real entries only. When a window has no data there
 * is no chart — an empty donut is more honest than a decorative one.
 */
export function InsightsScreen() {
  const [range, setRange] = useState<Range>('week');
  const [report, setReport] = useState<InsightsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const version = useLedger((s) => s.version);

  const load = useCallback(async () => {
    setReport(null);
    setError(null);
    try {
      setReport(await api.get<InsightsReport>(`/insights?range=${range}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not load your insights.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, version]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

  return (
    <div className="space-y-5">
      <ScreenHeader title="Insights" />

      <Segmented
        value={range}
        onChange={setRange}
        options={[
          { value: 'week', label: 'This week' },
          { value: 'month', label: 'This month' },
          { value: 'year', label: 'This year' },
        ]}
      />

      {!report ? (
        <>
          <Skeleton className="h-[220px] w-full rounded-xl" />
          <Skeleton className="h-[160px] w-full rounded-xl" />
        </>
      ) : !report.hasData ? (
        <Card>
          <EmptyState
            icon={<ChartPie />}
            title="Nothing to chart yet"
            description="Once you record a few transactions, your spending patterns will show up here."
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-4">
              <p className="text-[13px] text-ink-muted">Spent</p>
              <Money paise={report.totalSpent} size="lg" className="mt-0.5" />
            </Card>
            <Card className="p-4">
              <p className="text-[13px] text-ink-muted">Received</p>
              <Money paise={report.totalReceived} size="lg" tone="positive" className="mt-0.5" />
            </Card>
          </div>

          {report.byCategory.length > 0 && (
            <section>
              <SectionLabel>Spending by category</SectionLabel>
              <Card className="p-5">
                <CategoryBreakdown items={report.byCategory} total={report.totalSpent} />
              </Card>
            </section>
          )}

          {report.dailyFlow.length > 1 && (
            <section>
              <SectionLabel>Money flow</SectionLabel>
              <Card className="p-5">
                <FlowChart data={report.dailyFlow} />
              </Card>
            </section>
          )}

          <section>
            <SectionLabel>Where it sits</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <Card className="p-4">
                <p className="text-[13px] text-ink-muted">Cash vs digital</p>
                <div className="mt-2 flex items-center gap-2">
                  <SplitBar
                    left={report.cashVsDigital.cash}
                    right={report.cashVsDigital.digital}
                  />
                </div>
                <p className="mt-2 text-[12.5px] text-ink-muted">
                  {formatPaise(report.cashVsDigital.cash)} cash ·{' '}
                  {formatPaise(report.cashVsDigital.digital)} digital
                </p>
              </Card>
              <Card className="p-4">
                <p className="text-[13px] text-ink-muted">Savings</p>
                <Money paise={report.savingsBalance} size="lg" className="mt-0.5" />
                <p className="mt-2 text-[12.5px] text-ink-muted">Set aside, not spendable</p>
              </Card>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/** Horizontal bars, not a pie. Lengths are far easier to compare than angles. */
function CategoryBreakdown({
  items,
  total,
}: {
  items: { id: string | null; name: string; amount: number }[];
  total: number;
}) {
  const max = Math.max(...items.map((i) => i.amount), 1);

  return (
    <div className="space-y-3">
      {items.slice(0, 8).map((item, index) => (
        <div key={item.id ?? item.name}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="truncate text-[14px] font-medium text-ink">{item.name}</span>
            <span className="tnum shrink-0 text-[14px] text-ink-soft">
              {formatPaise(item.amount)}
              {total > 0 && (
                <span className="ml-1.5 text-[12px] text-ink-faint">
                  {Math.round((item.amount / total) * 100)}%
                </span>
              )}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
            <div
              className="h-full rounded-full transition-[width] duration-[600ms] ease-out-strong"
              style={{
                width: `${(item.amount / max) * 100}%`,
                background: `oklch(${0.68 - index * 0.03} 0.13 ${272 + index * 16})`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function FlowChart({ data }: { data: { date: string; spent: number; received: number }[] }) {
  const max = Math.max(...data.flatMap((d) => [d.spent, d.received]), 1);
  const width = 100;
  const height = 44;

  const line = (key: 'spent' | 'received') =>
    data
      .map((d, i) => {
        const x = (i / Math.max(data.length - 1, 1)) * width;
        const y = height - (d[key] / max) * height;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-24 w-full"
        role="img"
        aria-label="Daily spending and income"
      >
        <path d={line('spent')} fill="none" stroke="var(--color-accent)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <path d={line('received')} fill="none" stroke="var(--color-positive)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeDasharray="3 3" />
      </svg>
      <div className="mt-2 flex justify-between text-[11.5px] text-ink-faint">
        <span>{shortDate(data[0]?.date)}</span>
        <span className="flex gap-3">
          <span className="text-accent">Spent</span>
          <span className="text-positive">Received</span>
        </span>
        <span>{shortDate(data[data.length - 1]?.date)}</span>
      </div>
    </div>
  );
}

function SplitBar({ left, right }: { left: number; right: number }) {
  const total = Math.max(left + right, 1);
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
      <div style={{ width: `${(left / total) * 100}%` }} className="bg-accent" />
      <div style={{ width: `${(right / total) * 100}%` }} className="bg-[oklch(0.72_0.1_215)]" />
    </div>
  );
}

function shortDate(iso: string | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
