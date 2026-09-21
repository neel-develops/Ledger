import { describe, it, expect } from 'vitest';
import { orderPeople, filterPeople, findByExactName } from './people';

/**
 * Regression cover for a bug that reached a real ledger: the picker rendered
 * `people.slice(0, 10)`, so with twelve people the last two by name — Spruha
 * and Tanay — could not be selected at all. They had been added successfully
 * and simply never appeared.
 */

// The exact list that exposed it, in the order the API returns (name ascending).
const PEOPLE = [
  'Adwita',
  'Anushka',
  'Arsalaan',
  'Atharva',
  'Hrishikesh',
  'Kanan',
  'Sahil',
  'Salil',
  'Sanika',
  'Soham',
  'Spruha',
  'Tanay',
].map((name) => ({ id: `p-${name.toLowerCase()}`, name }));

describe('person picker list', () => {
  it('keeps every person, however many there are', () => {
    expect(orderPeople(PEOPLE, [])).toHaveLength(PEOPLE.length);
    expect(filterPeople(PEOPLE, '')).toHaveLength(PEOPLE.length);
  });

  it('reaches the people that used to be cut off past the tenth', () => {
    const shown = orderPeople(PEOPLE, []).map((p) => p.name);
    expect(shown).toContain('Spruha');
    expect(shown).toContain('Tanay');
    expect(shown.indexOf('Tanay')).toBeGreaterThan(9);
  });

  it('finds someone by typing part of their name', () => {
    expect(filterPeople(PEOPLE, 'tan').map((p) => p.name)).toEqual(['Tanay']);
    expect(filterPeople(PEOPLE, 'TANAY').map((p) => p.name)).toEqual(['Tanay']);
    // Matching is a substring, not a prefix — "Arsalaan" contains "sa" too.
    expect(filterPeople(PEOPLE, 'sa').map((p) => p.name)).toEqual([
      'Arsalaan',
      'Sahil',
      'Salil',
      'Sanika',
    ]);
    expect(filterPeople(PEOPLE, 'sah').map((p) => p.name)).toEqual(['Sahil']);
    expect(filterPeople(PEOPLE, '  hrish  ').map((p) => p.name)).toEqual(['Hrishikesh']);
  });

  it('returns nobody for a name that does not exist, so the form offers to add them', () => {
    expect(filterPeople(PEOPLE, 'Priya')).toEqual([]);
  });

  it('puts recently used people first without losing anyone', () => {
    const ordered = orderPeople(PEOPLE, ['p-tanay', 'p-sahil']);
    expect(ordered.slice(0, 2).map((p) => p.name)).toEqual(['Tanay', 'Sahil']);
    expect(ordered).toHaveLength(PEOPLE.length);
    // Everyone else keeps alphabetical order.
    expect(ordered.slice(2).map((p) => p.name)).toEqual([
      'Adwita',
      'Anushka',
      'Arsalaan',
      'Atharva',
      'Hrishikesh',
      'Kanan',
      'Salil',
      'Sanika',
      'Soham',
      'Spruha',
    ]);
  });

  it('resolves a typed name to the existing person instead of a duplicate', () => {
    expect(findByExactName(PEOPLE, 'tanay')?.id).toBe('p-tanay');
    expect(findByExactName(PEOPLE, '  Tanay ')?.id).toBe('p-tanay');
    expect(findByExactName(PEOPLE, 'Tan')).toBeUndefined();
    expect(findByExactName(PEOPLE, '')).toBeUndefined();
  });

  it('never invents or drops a person, whatever the input', () => {
    for (const query of ['', 'a', 'zzz', '  ', 'SAHIL']) {
      const result = filterPeople(PEOPLE, query);
      expect(result.length).toBeLessThanOrEqual(PEOPLE.length);
      for (const person of result) expect(PEOPLE).toContainEqual(person);
    }
  });
});
