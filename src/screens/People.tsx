import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Users } from 'lucide-react';
import { toast } from 'sonner';
import { formatPaise } from '@shared/money';
import { useLedger } from '../store/ledger';
import { ScreenHeader } from '../components/AppShell';
import { Avatar, Card, EmptyState, List, Row, SectionLabel, Skeleton, TextInput } from '../components/ui/primitives';
import { Button } from '../components/ui/Button';
import { Sheet } from '../components/ui/Sheet';
import { DebtLabel } from '../components/ui/Money';
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
        subtitle={
          loading || !people?.length
            ? undefined
            : `${formatPaise(totalOwed)} coming back · ${formatPaise(totalOwing)} to settle`
        }
        action={
          <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
            Add
          </Button>
        }
      />

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
                <List>
                  <div className="stagger divide-y divide-line">
                    {group.list.map((person) => (
                      <Row
                        key={person.id}
                        icon={<Avatar name={person.name} />}
                        title={person.name}
                        subtitle={<DebtLabel netBalance={person.netBalance} />}
                        chevron
                        onClick={() => navigate(`/people/${person.id}`)}
                      />
                    ))}
                  </div>
                </List>
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
