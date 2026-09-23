import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { formatPaise } from '@shared/money';
import { env, hasAssistant } from '../env';
import { AppError, badRequest, serviceUnavailable, tooManyRequests } from '../http/errors';
import { convertDraft, DraftError, DRAFT_JSON_SCHEMA } from '../domain/drafts';
import { getDashboard, getPeopleBalances } from './balances';
import { listCategories, listPools } from './reference';
import { listTransactions, previewTransaction } from './transactions';
import { getLedgerHealth } from './health';

/**
 * The in-app assistant.
 *
 * It can READ the ledger (a snapshot, a search, the health checks) and it can
 * PROPOSE transactions. It cannot write. Every proposal goes through the same
 * validation and the same ledger engine as the form, and comes back to the
 * user as a card they confirm or skip. The worst a confused model can do is
 * suggest something wrong that a person then declines.
 */

export const ASSISTANT_MODEL = 'claude-opus-5';
const MAX_TOOL_ROUNDS = 6;

/* ------------------------------------------------------------------ *
 * Client
 * ------------------------------------------------------------------ */

/** The slice of the SDK the assistant uses, so tests can supply a fake. */
export interface AssistantClient {
  beta: {
    messages: {
      create(params: Anthropic.Beta.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.BetaMessage>;
    };
  };
}

let client: AssistantClient | null = null;

function getClient(): AssistantClient {
  if (client) return client;
  if (!hasAssistant) {
    throw serviceUnavailable(
      'The assistant is not set up yet. Add ANTHROPIC_API_KEY to the deployment to turn it on.',
      'assistant_unavailable',
    );
  }
  client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) as unknown as AssistantClient;
  return client;
}

/** Test-only seam. */
export function __setAssistantClientForTesting(fake: AssistantClient | null): void {
  client = fake;
}

/* ------------------------------------------------------------------ *
 * Request shape
 * ------------------------------------------------------------------ */

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const assistantRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().max(4000),
        image: z
          .object({
            mediaType: z.enum(IMAGE_TYPES),
            // ~3 MB of image once decoded; the client downsizes well below this.
            data: z.string().max(4_200_000),
          })
          .nullish(),
      }),
    )
    .min(1)
    .max(40),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeZoneOffsetMinutes: z.number().int().min(-720).max(840),
});

export type AssistantRequest = z.infer<typeof assistantRequestSchema>;

export interface AssistantDraft {
  id: string;
  summary: string;
  kind: string;
  amount: number;
  /** POST this to /api/transactions once placeholders in `newPeople` are replaced. */
  payload: Record<string, unknown>;
  newPeople: Record<string, string>;
}

export interface AssistantReply {
  reply: string;
  drafts: AssistantDraft[];
  /** True when the answer was cut short and the user may want to ask again. */
  truncated: boolean;
}

/* ------------------------------------------------------------------ *
 * Prompt
 * ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `You are Chillar, the assistant inside Ledger — a private money app for one person in India. You help them record what happened with their money and check that their books are right. Be warm, brief and plain-spoken; this is a phone screen.

How the ledger works
- Amounts are rupees. Money sits in ACCOUNTS (where: cash, bank, UPI, savings) and belongs to POOLS (whose: "My money", "Dad money"…). The same cash can be partly Dad's.
- Lending is not an expense and borrowing is not income. Repayments are settlements, not income or spending. Moving money between accounts or pools, including into savings, is a transfer. Paying a shared bill: only the user's own share is an expense; everyone else's share becomes money they owe.

Recording transactions
- You cannot save anything. To record, call propose_transactions. Each draft is checked by the ledger and shown to the user as a card they confirm. Never say something was saved or recorded — say you have drafted it for them to confirm.
- Use the ids from the ledger snapshot. If a person is not in the list, set newPersonName instead of inventing an id.
- If something that matters is genuinely ambiguous — who paid, how a bill was split, whether money was a gift or a loan — ask one short question instead of guessing. Do not ask about things with a sensible default (account defaults to Cash, pool to My money, date to today).
- If a draft is rejected, read the reason, fix it, and propose only the corrected draft again. Drafts already accepted are already on the user's screen.
- For a receipt photo, read the total and what it was for, then propose it; mention anything you could not read.

Checking the books
- To verify, use check_ledger and search_transactions. Look for things a person would care about: likely duplicates (same amount, same day, same description), debts that look forgotten, or an account that seems off. Report what you actually found. If everything checks out, say so plainly.

Privacy
- Accounts marked private are hidden from the user's total so that other people glancing at the phone do not see them. Never state, estimate or hint at a private account's balance, and never add it to totals you mention. You may still record transactions into a private account when asked.`;

/* ------------------------------------------------------------------ *
 * Tools
 * ------------------------------------------------------------------ */

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'propose_transactions',
    description:
      'Draft one or more transactions for the user to confirm. Nothing is saved until they confirm each card. ' +
      'Returns which drafts were accepted by the ledger and, for any that were not, exactly why.',
    input_schema: {
      type: 'object',
      properties: {
        drafts: { type: 'array', items: DRAFT_JSON_SCHEMA as unknown as Record<string, unknown>, minItems: 1, maxItems: 12 },
      },
      required: ['drafts'],
    },
  },
  {
    name: 'search_transactions',
    description:
      'Search the user\'s recorded transactions, newest first. Use it to answer questions about history and to ' +
      'look for duplicates or mistakes.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Matches notes, people and categories.' },
        personId: { type: 'string' },
        accountId: { type: 'string' },
        from: { type: 'string', description: 'YYYY-MM-DD, inclusive.' },
        to: { type: 'string', description: 'YYYY-MM-DD, inclusive.' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: 'check_ledger',
    description:
      'Run the ledger\'s integrity checks: every transaction balances, no orphaned or broken entries, debts ' +
      'and accounts consistent. Returns each check and what it found.',
    input_schema: { type: 'object', properties: {} },
  },
];

/* ------------------------------------------------------------------ *
 * Ledger snapshot
 * ------------------------------------------------------------------ */

async function buildSnapshot(userId: string): Promise<{ text: string; people: { id: string; name: string }[] }> {
  const [dashboard, people, categories, pools] = await Promise.all([
    getDashboard(userId),
    getPeopleBalances(userId),
    listCategories(userId),
    listPools(userId),
  ]);

  const accounts = dashboard.accounts
    .filter((a) => !a.archivedAt)
    .map((a) =>
      a.isPrivate
        ? { id: a.id, name: a.name, kind: a.kind, private: true }
        : { id: a.id, name: a.name, kind: a.kind, balance: formatPaise(a.balance), default: a.isDefault || undefined },
    );

  const snapshot = {
    totals: {
      totalMoneyShown: formatPaise(dashboard.ownedMoney),
      othersOweMe: formatPaise(dashboard.owedToMe),
      iOweOthers: formatPaise(dashboard.iOwe),
    },
    accounts,
    pools: pools.map((p) => ({ id: p.id, name: p.name, kind: p.kind, default: p.isDefault || undefined })),
    people: people.map((p) => ({
      id: p.id,
      name: p.name,
      position:
        p.netBalance > 0
          ? `owes the user ${formatPaise(p.netBalance)}`
          : p.netBalance < 0
            ? `the user owes ${formatPaise(-p.netBalance)}`
            : 'settled',
    })),
    categories: categories.map((c) => ({ id: c.id, name: c.name, for: c.direction })),
  };

  return {
    text: `Current ledger (live, for reference — use these ids):\n${JSON.stringify(snapshot)}`,
    people: people.map((p) => ({ id: p.id, name: p.name })),
  };
}

/* ------------------------------------------------------------------ *
 * The loop
 * ------------------------------------------------------------------ */

export async function runAssistant(userId: string, request: AssistantRequest): Promise<AssistantReply> {
  const anthropic = getClient();
  const snapshot = await buildSnapshot(userId);

  const history = request.messages;
  const last = history[history.length - 1];
  if (!last || last.role !== 'user') throw badRequest('The last message must be from you.');

  // Prior turns go back as plain text. The live snapshot rides on the newest
  // user turn only, so the earlier conversation stays a stable prefix.
  const messages: Anthropic.Beta.BetaMessageParam[] = history.slice(0, -1).map((m) => ({
    role: m.role,
    content: m.text || '…',
  }));

  const latest: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (last.image) {
    latest.push({
      type: 'image',
      source: { type: 'base64', media_type: last.image.mediaType, data: last.image.data },
    });
  }
  latest.push({ type: 'text', text: `${snapshot.text}\n\nToday is ${request.today}.` });
  latest.push({ type: 'text', text: last.text || (last.image ? 'Here is a receipt.' : '…') });
  messages.push({ role: 'user', content: latest });

  const drafts: AssistantDraft[] = [];
  const spoken: string[] = [];
  let truncated = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await anthropic.beta.messages.create({
        model: ASSISTANT_MODEL,
        max_tokens: 16000,
        // If a safety classifier declines, the API re-runs the request on a
        // recommended fallback model instead of returning a refusal.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        // Conversational and latency-sensitive: medium keeps replies quick
        // without losing the judgement the accounting rules need.
        output_config: { effort: 'medium' },
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: TOOLS,
        messages,
      });
    } catch (error) {
      throw toAppError(error);
    }

    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) spoken.push(block.text.trim());
    }

    if (response.stop_reason === 'refusal') {
      return {
        reply: 'I can’t help with that one. I’m happy to record transactions or check your books.',
        drafts,
        truncated: false,
      };
    }

    if (response.stop_reason === 'max_tokens') {
      truncated = true;
      break;
    }

    // Thinking and tool-use blocks must go back exactly as they came.
    messages.push({ role: 'assistant', content: response.content as Anthropic.Beta.BetaContentBlockParam[] });

    if (response.stop_reason === 'pause_turn') continue;
    if (response.stop_reason !== 'tool_use') break;

    const calls = response.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
    );

    // Every tool_result for this turn goes back in a single user message.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(
      calls.map(async (call) => {
        try {
          const output = await runTool(userId, call, request, snapshot.people, drafts);
          return { type: 'tool_result' as const, tool_use_id: call.id, content: output };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'That tool failed.';
          return { type: 'tool_result' as const, tool_use_id: call.id, content: message, is_error: true };
        }
      }),
    );
    messages.push({ role: 'user', content: results });

    if (round === MAX_TOOL_ROUNDS - 1) truncated = true;
  }

  const reply =
    spoken.length > 0
      ? spoken[spoken.length - 1]!
      : drafts.length > 0
        ? `I’ve drafted ${drafts.length === 1 ? 'this' : 'these'} for you to confirm.`
        : 'I’m not sure what to do with that. Could you tell me a little more?';

  return { reply, drafts, truncated };
}

async function runTool(
  userId: string,
  call: Anthropic.Beta.BetaToolUseBlock,
  request: AssistantRequest,
  people: { id: string; name: string }[],
  drafts: AssistantDraft[],
): Promise<string> {
  const input = (call.input ?? {}) as Record<string, unknown>;

  switch (call.name) {
    case 'propose_transactions': {
      const raw = Array.isArray(input.drafts) ? input.drafts : [];
      if (raw.length === 0) return 'No drafts were given.';

      const accepted: { index: number; summary: string }[] = [];
      const rejected: { index: number; reason: string }[] = [];

      for (const [index, candidate] of raw.entries()) {
        try {
          const converted = convertDraft(candidate, {
            people,
            today: request.today,
            timeZoneOffsetMinutes: request.timeZoneOffsetMinutes,
          });
          // The real ledger engine, read-only. If this passes, saving will too.
          const preview = await previewTransaction(userId, converted.input, {
            extraPersonIds: Object.keys(converted.newPeople),
          });
          drafts.push({
            id: randomUUID(),
            summary: converted.summary,
            kind: converted.input.kind,
            amount: preview.amount,
            payload: converted.payload,
            newPeople: converted.newPeople,
          });
          accepted.push({ index, summary: converted.summary });
        } catch (error) {
          const reason =
            error instanceof DraftError || error instanceof AppError
              ? error.message
              : 'The ledger could not check this draft.';
          rejected.push({ index, reason });
        }
      }

      return JSON.stringify({
        accepted,
        rejected,
        note: 'Accepted drafts are now shown to the user as cards to confirm. Nothing has been saved.',
      });
    }

    case 'search_transactions': {
      const limit = typeof input.limit === 'number' ? Math.min(Math.max(input.limit, 1), 50) : 20;
      const day = (value: unknown, end: boolean) =>
        typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
          ? new Date(`${value}T${end ? '23:59:59' : '00:00:00'}Z`).toISOString()
          : undefined;

      const { items } = await listTransactions(userId, {
        limit,
        search: typeof input.search === 'string' ? input.search.slice(0, 100) : undefined,
        personId: typeof input.personId === 'string' ? input.personId : undefined,
        accountId: typeof input.accountId === 'string' ? input.accountId : undefined,
        from: day(input.from, false),
        to: day(input.to, true),
      });

      return JSON.stringify(
        items.map((t) => ({
          id: t.id,
          date: t.occurredAt.slice(0, 10),
          kind: t.kind,
          amount: formatPaise(t.amount),
          note: t.note,
          account: t.labels.account,
          toAccount: t.labels.toAccount,
          category: t.labels.category,
          people: t.labels.people.map((p) => p.name),
          reversed: Boolean(t.reversedByTransactionId) || undefined,
        })),
      );
    }

    case 'check_ledger': {
      const report = await getLedgerHealth(userId);
      return JSON.stringify({
        healthy: report.healthy,
        transactions: report.totals.transactions,
        checks: report.checks.map((c) => ({ check: c.label, ok: c.status === 'pass', detail: c.detail || undefined })),
      });
    }

    default:
      return `There is no tool called ${call.name}.`;
  }
}

/** Map SDK failures to sentences, most specific first. */
function toAppError(error: unknown): Error {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return serviceUnavailable('The assistant’s API key was rejected. Check ANTHROPIC_API_KEY.', 'assistant_misconfigured');
  }
  if (error instanceof Anthropic.RateLimitError) {
    return tooManyRequests('The assistant is getting a lot of requests. Try again in a minute.');
  }
  if (error instanceof Anthropic.BadRequestError) {
    console.error('[assistant] request rejected', error.message);
    return serviceUnavailable('The assistant could not handle that request. Nothing was changed.', 'assistant_failed');
  }
  // Connection errors are a subclass of APIError, so they are checked first.
  if (error instanceof Anthropic.APIConnectionError) {
    return serviceUnavailable('Could not reach the assistant. Nothing was changed.', 'assistant_failed');
  }
  if (error instanceof Anthropic.APIError) {
    return serviceUnavailable('The assistant is unavailable right now. Nothing was changed.', 'assistant_failed');
  }
  return error instanceof Error ? error : new Error(String(error));
}
