/**
 * Natural language -> transaction DRAFT.
 *
 * This parser never saves anything. It produces a draft that the user must
 * look at and confirm, because guessing wrong about money is worse than
 * asking. Anything it is unsure about is left null and surfaced as a gap in
 * the review sheet.
 */

import { parseRupeesToPaise, type Paise } from './money';
import type { TransactionKind } from './domain';

export interface ParseContext {
  /** `netBalance` > 0 means they owe me; it disambiguates "X gave me 500". */
  people: { id: string; name: string; netBalance?: number }[];
  categories: { id: string; name: string; direction: 'expense' | 'income' }[];
  accounts: { id: string; name: string }[];
  pools: { id: string; name: string; kind: string }[];
}

export interface TransactionDraft {
  kind: TransactionKind;
  amount: Paise | null;
  personId: string | null;
  personName: string | null;
  /** A name the sentence mentioned that does not match anyone yet. */
  unknownPersonName: string | null;
  categoryId: string | null;
  accountId: string | null;
  poolId: string | null;
  toAccountId: string | null;
  toPoolId: string | null;
  note: string | null;
  /** 'high' when the phrasing was unambiguous; the UI leans on this. */
  confidence: 'high' | 'low';
  /** What still has to be filled in before this can be saved. */
  missing: string[];
}

interface Rule {
  kind: TransactionKind;
  /** Patterns are tried in order; the first match wins. */
  patterns: RegExp[];
  confidence?: 'high' | 'low';
}

const AMOUNT = String.raw`(?:₹\s*)?(\d[\d,]*(?:\.\d{1,2})?)`;
const NAME = String.raw`([a-z][a-z' ]{0,30}?)`;

/**
 * Order matters. More specific phrasings ("paid 250 for Aayush") must be tried
 * before looser ones ("spent 250").
 */
const RULES: Rule[] = [
  {
    kind: 'transfer',
    patterns: [
      new RegExp(String.raw`^(?:moved?|transfer(?:red)?)\s+${AMOUNT}\s+from\s+${NAME}\s+to\s+${NAME}$`, 'i'),
    ],
  },
  {
    kind: 'transfer',
    patterns: [new RegExp(String.raw`^(?:saved?|save)\s+${AMOUNT}$`, 'i')],
  },
  {
    kind: 'borrow',
    patterns: [
      new RegExp(String.raw`^borrow(?:ed)?\s+${AMOUNT}\s+from\s+${NAME}$`, 'i'),
      new RegExp(String.raw`^${NAME}\s+lent\s+me\s+${AMOUNT}$`, 'i'),
      new RegExp(String.raw`^i\s+owe\s+${NAME}\s+${AMOUNT}$`, 'i'),
    ],
  },
  {
    kind: 'lend',
    patterns: [
      new RegExp(String.raw`^${NAME}\s+owes?\s+me\s+${AMOUNT}$`, 'i'),
      new RegExp(String.raw`^lent\s+${NAME}\s+${AMOUNT}$`, 'i'),
      new RegExp(String.raw`^(?:gave|lent)\s+${NAME}\s+${AMOUNT}$`, 'i'),
      new RegExp(String.raw`^(?:gave|lent)\s+${AMOUNT}\s+to\s+${NAME}$`, 'i'),
    ],
  },
  {
    kind: 'settle_receivable',
    patterns: [
      new RegExp(String.raw`^${NAME}\s+(?:paid|returned|repaid)\s+(?:me\s+)?(?:back\s+)?${AMOUNT}$`, 'i'),
      new RegExp(String.raw`^got\s+${AMOUNT}\s+back\s+from\s+${NAME}$`, 'i'),
    ],
  },
  {
    kind: 'settle_payable',
    patterns: [
      new RegExp(String.raw`^(?:paid|repaid|returned)\s+${NAME}\s+back\s+${AMOUNT}$`, 'i'),
      new RegExp(String.raw`^settled\s+${AMOUNT}\s+with\s+${NAME}$`, 'i'),
    ],
  },
  {
    kind: 'paid_for_someone',
    patterns: [
      new RegExp(String.raw`^paid\s+${AMOUNT}\s+for\s+${NAME}$`, 'i'),
      new RegExp(String.raw`^paid\s+for\s+${NAME}\s+${AMOUNT}$`, 'i'),
    ],
  },
  {
    kind: 'income',
    patterns: [
      new RegExp(String.raw`^${NAME}\s+gave\s+me\s+${AMOUNT}$`, 'i'),
      new RegExp(String.raw`^(?:got|received|earned)\s+${AMOUNT}(?:\s+from\s+${NAME})?$`, 'i'),
    ],
  },
  {
    kind: 'expense',
    patterns: [
      new RegExp(String.raw`^(?:spent|spend|paid)\s+${AMOUNT}\s+(?:on|for)\s+(.+)$`, 'i'),
      new RegExp(String.raw`^(?:spent|spend|paid)\s+${AMOUNT}$`, 'i'),
      new RegExp(String.raw`^${AMOUNT}\s+(?:on|for)\s+(.+)$`, 'i'),
    ],
  },
];

function normalize(input: string): string {
  return input.trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, '');
}

function findByName<T extends { name: string }>(items: T[], needle: string | null): T | null {
  if (!needle) return null;
  const target = needle.trim().toLowerCase();
  if (!target) return null;
  return (
    items.find((i) => i.name.toLowerCase() === target) ??
    items.find((i) => i.name.toLowerCase().startsWith(target)) ??
    items.find((i) => target.startsWith(i.name.toLowerCase())) ??
    null
  );
}

function emptyDraft(kind: TransactionKind): TransactionDraft {
  return {
    kind,
    amount: null,
    personId: null,
    personName: null,
    unknownPersonName: null,
    categoryId: null,
    accountId: null,
    poolId: null,
    toAccountId: null,
    toPoolId: null,
    note: null,
    confidence: 'low',
    missing: [],
  };
}

/**
 * Returns null when the text is not recognisable as a transaction at all,
 * rather than inventing a plausible one.
 */
export function parseTransaction(input: string, context: ParseContext): TransactionDraft | null {
  const text = normalize(input);
  if (!text) return null;

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const match = pattern.exec(text);
      if (!match) continue;
      const draft = applyRule(rule, match, text, context);
      if (draft) return finalize(draft, context);
    }
  }

  // Last resort: a bare number is treated as an expense, but flagged low
  // confidence so the review sheet asks for the rest.
  const bare = new RegExp(String.raw`^${AMOUNT}$`).exec(text);
  if (bare) {
    const draft = emptyDraft('expense');
    draft.amount = parseRupeesToPaise(bare[1] ?? '');
    draft.confidence = 'low';
    return finalize(draft, context);
  }

  return null;
}

function applyRule(
  rule: Rule,
  match: RegExpExecArray,
  text: string,
  context: ParseContext,
): TransactionDraft | null {
  const draft = emptyDraft(rule.kind);
  draft.confidence = rule.confidence ?? 'high';
  draft.note = text;

  const groups = match.slice(1).map((g) => (g === undefined ? null : g.trim()));
  const amountGroup = groups.find((g) => g !== null && /^\d[\d,]*(\.\d{1,2})?$/.test(g));
  draft.amount = parseRupeesToPaise(amountGroup ?? null);
  if (draft.amount === null || draft.amount <= 0) return null;

  const words = groups.filter((g): g is string => g !== null && g !== amountGroup);

  switch (rule.kind) {
    case 'transfer': {
      if (/^saved?|^save/i.test(text)) {
        // "saved 1000" — from the default spendable account into savings.
        draft.toAccountId = findByName(context.accounts, 'savings')?.id ?? null;
        if (!draft.toAccountId) draft.missing.push('a savings account');
        break;
      }
      const [fromWord, toWord] = words;
      const fromPool = findByName(context.pools, fromWord ?? null);
      const toPool = findByName(context.pools, toWord ?? null);
      const fromAccount = findByName(context.accounts, fromWord ?? null);
      const toAccount = findByName(context.accounts, toWord ?? null);

      draft.poolId = fromPool?.id ?? null;
      draft.toPoolId = toPool?.id ?? null;
      draft.accountId = fromAccount?.id ?? null;
      draft.toAccountId = toAccount?.id ?? null;

      if (!fromPool && !fromAccount) draft.missing.push(`where “${fromWord ?? '?'}” is`);
      if (!toPool && !toAccount) draft.missing.push(`where “${toWord ?? '?'}” is`);
      break;
    }

    case 'expense': {
      const subject = words[0] ?? null;
      const category = findByName(
        context.categories.filter((c) => c.direction === 'expense'),
        subject,
      );
      draft.categoryId = category?.id ?? null;
      if (subject && !category) draft.confidence = 'low';
      break;
    }

    case 'income': {
      const source = words[0] ?? null;
      // "dad gave me 2000" names an ownership pool, not a person.
      const pool = findByName(context.pools, source);
      if (pool) {
        draft.toPoolId = pool.id;
      } else if (source) {
        const person = findByName(context.people, source);
        draft.personId = person?.id ?? null;
        draft.personName = person?.name ?? null;
        if (!person) {
          draft.unknownPersonName = titleCase(source);
        } else if ((person.netBalance ?? 0) > 0) {
          // They already owe me, so money coming back is almost certainly a
          // repayment rather than a gift. The review sheet still asks.
          draft.kind = 'settle_receivable';
          draft.confidence = 'low';
        }
      }
      break;
    }

    default: {
      // Every remaining kind is about a person.
      const who = words[0] ?? null;
      const person = findByName(context.people, who);
      if (person) {
        draft.personId = person.id;
        draft.personName = person.name;
      } else if (who) {
        draft.unknownPersonName = titleCase(who);
        draft.confidence = 'low';
        draft.missing.push(`who “${titleCase(who)}” is`);
      } else {
        draft.missing.push('a person');
      }
      break;
    }
  }

  return draft;
}

function finalize(draft: TransactionDraft, context: ParseContext): TransactionDraft {
  if (draft.amount === null) draft.missing.push('an amount');

  const needsPerson: TransactionKind[] = [
    'lend',
    'borrow',
    'settle_receivable',
    'settle_payable',
    'paid_for_someone',
    'someone_paid_for_me',
  ];
  if (needsPerson.includes(draft.kind) && !draft.personId && !draft.unknownPersonName) {
    draft.missing.push('a person');
  }

  if (draft.kind === 'transfer' && !draft.toAccountId && !draft.toPoolId) {
    draft.missing.push('a destination');
  }

  // The parser never picks an account when the sentence did not name one —
  // the form falls back to the user's default and shows it.
  if (draft.accountId && !context.accounts.some((a) => a.id === draft.accountId)) draft.accountId = null;

  draft.missing = [...new Set(draft.missing)];
  if (draft.missing.length > 0) draft.confidence = 'low';
  return draft;
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Example phrasings shown under the smart-entry field. */
export const NLP_EXAMPLES = [
  'spent 150 on food',
  'dad gave me 2000',
  'gave Rahul 500',
  'Rahul owes me 300',
  'paid 250 for Aayush',
  'borrowed 1000 from Sahil',
  'moved 500 from dad to personal',
  'saved 1000',
] as const;
