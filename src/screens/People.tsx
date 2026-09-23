import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Plus, Search, UserRoundMinus, UserRoundPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { formatPaise } from '@shared/money';
import { useLedger } from '../store/ledger';
import { ScreenHeader } from '../components/AppShell';
import { Avatar, Card, EmptyState, SectionLabel, Skeleton, TextInput } from '../components/ui/primitives';
import { Mascot } from '../components/Mascot';
import { usePrefs } from '../store/prefs';
import { Button } from '../components/ui/Button';
import { Sheet } from '../components/ui/Sheet';
import { Money } from '../components/ui/Money';
import { ErrorState } from '../components/ErrorState';
import { ApiError } from '../lib/api';

export function PeopleScreen() {
  const navigate = useNavigate();
  const { people, state, error, unavailable, load } = useLedger();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = people ?? [];
    return term ? list.filter((p) => p.name.toLowerCase().includes(term)) : list;
  }, [people, search]);

  const { owesYou, youOwe, settled } = useMemo(() => {
    return {
      owesYou: filtered.filter((p) => p.netBalance > 0).sort((a, b) => b.netBalance - a.netBalance),
      youOwe: filtered.filter((p) => p.netBalance < 0).sort((a, b) => a.netBalance - b.netBalance),
      settled: filtered.filter((p) => p.netBalance === 0),
    };
  }, [filtered]);

  if (state === 'error') {
    return <ErrorState message={error} unavailable={unavailable} onRetry={() => void load()} />;
  }

  const loading = people === null;

  const totalOwed = owesYou.reduce((sum, p) => sum + p.netBalance, 0);
  const totalOwing = youOwe.reduce((sum, p) => sum - p.netBalance, 0);

  return (
    <div>
      <ScreenHeader
        title="People"
        subtitle={loading || !people?.length ? undefined : `${people.length} ${people.length === 1 ? 'person' : 'people'}`}
        action={
          <div className="flex items-center gap-2">
            <Mascot
              size={46}
              mood={loading ? 'thinking' : totalOwing > totalOwed ? 'sad' : totalOwed > 0 ? 'happy' : 'idle'}
            />
            <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
              Add
            </Button>
          </div>
        }
      />

      {!loading && (people?.length ?? 0) > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-3">
          <SummaryTile tone="#2fd3e0" icon={<UserRoundPlus />} label="Coming back" value={totalOwed} index={0} />
          <SummaryTile tone="#ff5d73" icon={<UserRoundMinus />} label="To settle" value={totalOwing} index={1} />
        </div>
      )}

      {(people?.length ?? 0) > 6 && (
        <div className="relative mb-4">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
            aria-hidden
          />
          <TextInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people"
            className="pl-10"
            type="search"
          />
        </div>
      )}

      {loading ? (
        <div className="card divide-y divide-line">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          ))}
        </div>
      ) : !people?.length ? (
        <Card>
          <EmptyState
            icon={<Users />}
            title="No people yet"
            description="Add the people you lend to, borrow from, or split bills with. Every rupee between you stays tracked."
            action={<Button onClick={() => setAdding(true)}>Add a person</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {[
            { label: 'Owes you', list: owesYou },
            { label: 'You owe', list: youOwe },
            { label: 'Settled', list: settled },
          ]
            .filter((group) => group.list.length > 0)
            .map((group) => (
              <section key={group.label}>
                <SectionLabel>{group.label}</SectionLabel>
                <div className="stagger space-y-2">
                  {group.list.map((person, i) => (
                    <PersonCard
                      key={person.id}
                      name={person.name}
                      netBalance={person.netBalance}
                      index={i}
                      onClick={() => navigate(`/people/${person.id}`)}
                    />
                  ))}
                </div>
              </section>
            ))}

          {filtered.length === 0 && (
            <Card>
              <EmptyState title="Nobody matched" description={`No one called “${search}”.`} />
            </Card>
          )}
        </div>
      )}

      <AddPersonSheet open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

const hueFor = (net: number) => (net > 0 ? '#2fd3e0' : net < 0 ? '#ff5d73' : '#8e8e98');

function SummaryTile({
  tone,
  icon,
  label,
  value,
  index,
}: {
  tone: string;
  icon: React.ReactNode;
  label: string;
  value: number;
  index: number;
}) {
  return (
    <div
      style={{ '--tone': tone, '--shine-delay': `${150 + index * 90}ms` } as React.CSSProperties}
      className="kind-tile flex flex-col gap-2.5 rounded-xl p-4"
    >
      <span aria-hidden className="kind-glow" />
      <span className="kind-icon grid size-9 place-items-center rounded-[12px] [&>svg]:size-[17px]">{icon}</span>
      <div className="relative">
        <p className="text-[13px] text-ink-muted">{label}</p>
        <Money paise={value} size="lg" maskable className="mt-0.5" />
      </div>
    </div>
  );
}

/** One person as a glowing card: cyan when they owe you, red when you owe them, grey when square. */
function PersonCard({
  name,
  netBalance,
  index,
  onClick,
}: {
  name: string;
  netBalance: number;
  index: number;
  onClick: () => void;
}) {
  const hidden = usePrefs((s) => s.balancesHidden);
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ '--tone': hueFor(netBalance), '--shine-delay': `${220 + index * 70}ms` } as React.CSSProperties}
      className="kind-tile group flex w-full items-center gap-3.5 rounded-xl px-4 py-3 text-left"
    >
      <span aria-hidden className="kind-glow" />
      <span className="person-ring relative rounded-full p-[2.5px]">
        <Avatar name={name} />
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="block truncate text-[16px] font-semibold tracking-[-0.01em] text-ink">{name}</span>
        <span className="block truncate text-[13px]">
          {/* The amount is on the right already; this line only says which way. */}
          <span className={netBalance > 0 ? 'text-positive' : netBalance < 0 ? 'text-negative' : 'text-ink-muted'}>
            {netBalance > 0 ? 'Owes you' : netBalance < 0 ? 'You owe' : 'Settled'}
          </span>
        </span>
      </span>
      {netBalance !== 0 && (
        <span className="tnum relative text-[16px] font-bold" style={{ color: 'var(--tone)' }}>
          {hidden ? '••••' : formatPaise(Math.abs(netBalance))}
        </span>
      )}
      <ChevronRight
        className="relative size-4 text-ink-faint transition-transform duration-200 ease-out-strong group-active:translate-x-1"
        aria-hidden
      />
    </button>
  );
}

function AddPersonSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const addPerson = useLedger((s) => s.addPerson);
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await addPerson(name.trim(), relation.trim() || null);
      toast.success(`${name.trim()} added`);
      setName('');
      setRelation('');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not add that person.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add a person">
      <div className="space-y-3 pb-2">
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          autoComplete="off"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
        <TextInput
          value={relation}
          onChange={(e) => setRelation(e.target.value)}
          placeholder="Family, roommate, colleague… (optional)"
          autoComplete="off"
        />
        {error && <p className="text-[13px] text-negative">{error}</p>}
        <Button block size="lg" onClick={save} loading={saving} disabled={!name.trim()}>
          Add person
        </Button>
      </div>
    </Sheet>
  );
}
