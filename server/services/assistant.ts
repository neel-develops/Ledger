import { randomUUID } from 'node:crypto';
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
 *
 * It runs on Groq. The reasoning model is text-only, so a receipt photo is
 * first read into text by a vision model and handed over as a transcript.
 */

export const ASSISTANT_MODEL = 'openai/gpt-oss-120b';
export const VISION_MODEL = 'qwen/qwen3.8-27b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_TOOL_ROUNDS = 6;
// Vercel gives the function 60 seconds; leave room for the ledger work.
const REQUEST_TIMEOUT_MS = 25_000;

/* ------------------------------------------------------------------ *
 * Client
 * ------------------------------------------------------------------ */

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ChatContent =
  | string
  | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];

export type ChatMessage =
  | { role: 'system' | 'user'; content: ChatContent }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }[];
  reasoning_effort?: 'low' | 'medium' | 'high';
  max_completion_tokens: number;
  temperature?: number;
}

export interface ChatResponse {
  choices: {
    message: { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] };
    finish_reason: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** An HTTP failure from the model provider, kept structured so it maps to a sentence. */
export class ModelError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string | null,
    message: string,
    /** From Retry-After on a 429: how long until the limit resets. */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
  }
}

/** The one call the assistant makes, so tests can supply a fake. */
export interface AssistantClient {
  chat(request: ChatRequest): Promise<ChatResponse>;
}

function groqClient(apiKey: string): AssistantClient {
  return {
    async chat(request) {
      let response: Response;
      try {
        response = await fetch(GROQ_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        throw new ModelError(null, null, error instanceof Error ? error.message : 'network error');
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string; code?: string };
        } | null;
        const retryAfter = Number(response.headers.get('retry-after'));
        throw new ModelError(
          response.status,
          body?.error?.code ?? null,
          body?.error?.message ?? response.statusText,
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
        );
      }
      const result = (await response.json()) as ChatResponse;
      // Token counts only — never content. The free tier is metered per minute.
      console.info(
        `[assistant] ${request.model} in=${result.usage?.prompt_tokens ?? '?'} out=${result.usage?.completion_tokens ?? '?'}`,
      );
      return result;
    },
  };
}

let client: AssistantClient | null = null;

function getClient(): AssistantClient {
  if (client) return client;
  if (!hasAssistant || !env.GROQ_API_KEY) {
    throw serviceUnavailable(
      'The assistant is not set up yet. Add GROQ_API_KEY to the deployment to turn it on.',
      'assistant_unavailable',
    );
  }
  client = groqClient(env.GROQ_API_KEY);
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

const SYSTEM_PROMPT = `You are Chillar, the assistant inside Ledger — a private money app for one person in India. You help them record what happened with their money and check that their books are right. Be warm, brief and plain-spoken; this is a phone screen. Write plain text: no markdown tables, headings or bold. After drafting, do not repeat the drafts' details — they are already on the cards — just say in a sentence what you drafted and anything the user should check.

How the ledger works
- Amounts are rupees. Money sits in ACCOUNTS (where: cash, bank, UPI, savings) and belongs to POOLS (whose: "My money", "Dad money"…). The same cash can be partly Dad's.
- Lending is not an expense and borrowing is not income. Repayments are settlements, not income or spending. Moving money between accounts or pools, including into savings, is a transfer. Paying a shared bill: only the user's own share is an expense; everyone else's share becomes money they owe.
- Spending FROM a pool is still an expense: "used 200 of Dad money for petrol" is an expense of 200 with poolId set to Dad money, not a transfer. A transfer is only for money that moves and is not spent, so a transfer never has a category.

Recording transactions
- You cannot save anything. To record, call propose_transactions. Each draft is checked by the ledger and shown to the user as a card they confirm. Never say something was saved or recorded — say you have drafted it for them to confirm.
- Use the ids from the ledger snapshot. If a person is not in the list, set newPersonName instead of inventing an id.
- If something that matters is genuinely ambiguous — who paid, how a bill was split, whether money was a gift or a loan — ask one short question instead of guessing. Do not ask about things with a sensible default (account defaults to Cash, pool to My money, date to today).
- If a draft is rejected, read the reason, fix it, and propose only the corrected draft again. Drafts already accepted are already on the user's screen.
- For a receipt photo, read the total and what it was for, then propose it; mention anything you could not read.

Checking the books
- To verify, use check_ledger and search_transactions. Look for things a person would care about: likely duplicates (same amount, same day, same description), debts that look forgotten, or an account that seems off. Report what you actually found, and only name checks you actually ran — check_ledger does not look for duplicates; search_transactions is how you find those. If everything checks out, say so plainly.

Privacy
- Accounts marked private are hidden from the user's total so that other people glancing at the phone do not see them. Never state, estimate or hint at a private account's balance, and never add it to totals you mention. You may still record transactions into a private account when asked.`;

/* ------------------------------------------------------------------ *
 * Tools
 * ------------------------------------------------------------------ */

const TOOL_DEFS = [
  {
    name: 'propose_transactions',
    description:
      'Draft one or more transactions for the user to confirm. Nothing is saved until they confirm each card. ' +
      'Returns which drafts were accepted by the ledger and, for any that were not, exactly why.',
    parameters: {
      type: 'object',
      properties: {
        drafts: { type: 'array', items: lenient(DRAFT_JSON_SCHEMA), minItems: 1, maxItems: 12 },
      },
      required: ['drafts'],
    },
  },
  {
    name: 'search_transactions',
    description:
      'Search the user\'s recorded transactions, newest first. Use it to answer questions about history and to ' +
      'look for duplicates or mistakes.',
    parameters: {
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
    parameters: { type: 'object', properties: {} },
  },
];

/**
 * The draft schema without its `required` lists. Groq validates tool calls
 * against the schema itself and rejects a whole call over one missing field,
 * with nothing the model can learn from. Without the lists, a gap reaches the
 * draft validator instead, which answers with a reason the model can fix.
 */
function lenient(schema: unknown): Record<string, unknown> {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (!node || typeof node !== 'object') return node;
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>)
        .filter(([key]) => key !== 'required')
        .map(([key, value]) => [key, strip(value)]),
    );
  };
  return strip(schema) as Record<string, unknown>;
}

const TOOLS: ChatRequest['tools'] =TOOL_DEFS.map((t) => ({
  type: 'function' as const,
  function: { name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown> },
}));

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
  const model = getClient();
  const snapshot = await buildSnapshot(userId);

  const history = request.messages;
  const last = history[history.length - 1];
  if (!last || last.role !== 'user') throw badRequest('The last message must be from you.');

  let said = last.text.trim();
  if (last.image) {
    const transcript = await readReceipt(model, last.image);
    said = `${said || 'Here is a receipt.'}\n\n[Photo attached. What it shows, read by the app:]\n${transcript}`;
  }

  // Prior turns go back as plain text. The live snapshot rides on the newest
  // user turn only, so the earlier conversation stays a stable prefix.
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(0, -1).map(
      (m): ChatMessage =>
        m.role === 'user' ? { role: 'user', content: m.text || '…' } : { role: 'assistant', content: m.text || '…' },
    ),
    { role: 'user', content: `${snapshot.text}\n\nToday is ${request.today}.\n\n${said || '…'}` },
  ];

  const drafts: AssistantDraft[] = [];
  let spoken = '';
  let truncated = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await chatWithRetry(model, {
      model: ASSISTANT_MODEL,
      messages,
      tools: TOOLS,
      // Conversational and latency-sensitive: medium keeps replies quick
      // without losing the judgement the accounting rules need.
      reasoning_effort: 'medium',
      max_completion_tokens: 8000,
      temperature: 0.3,
    });

    const choice = response.choices[0];
    if (!choice) break;
    // The chat shows plain text, so stray emphasis markers would appear literally.
    const text = choice.message.content?.replace(/\*\*(.+?)\*\*/g, '$1').trim();
    if (text) spoken = text;

    if (choice.finish_reason === 'content_filter') {
      return {
        reply: 'I can’t help with that one. I’m happy to record transactions or check your books.',
        drafts,
        truncated: false,
      };
    }
    if (choice.finish_reason === 'length') {
      truncated = true;
      break;
    }

    const calls = choice.message.tool_calls ?? [];
    if (calls.length === 0) break;

    messages.push({ role: 'assistant', content: choice.message.content ?? null, tool_calls: calls });

    // One result per call, in order, each tied to its call id.
    for (const call of calls) {
      let output: string;
      try {
        output = await runTool(userId, call, request, snapshot.people, drafts);
      } catch (error) {
        output = `Error: ${error instanceof Error ? error.message : 'That tool failed.'}`;
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: output });
    }

    if (round === MAX_TOOL_ROUNDS - 1) truncated = true;
  }

  const reply =
    spoken ||
    (drafts.length > 0
      ? `I’ve drafted ${drafts.length === 1 ? 'this' : 'these'} for you to confirm.`
      : 'I’m not sure what to do with that. Could you tell me a little more?');

  return { reply, drafts, truncated };
}

/** Groq meters each model separately, so a busy one can hand over to this. */
const FALLBACK_MODELS: Record<string, string> = { [ASSISTANT_MODEL]: 'openai/gpt-oss-20b' };
const MAX_RATE_LIMIT_WAIT_SECONDS = 8;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One model call, with the failures worth absorbing absorbed:
 * - tool_use_failed is a sampling accident (a malformed tool call), not a bad
 *   request, so it is simply tried again once;
 * - a per-minute rate limit that resets within a few seconds is waited out;
 *   a longer one moves to the fallback model, which has its own allowance.
 */
async function chatWithRetry(model: AssistantClient, request: ChatRequest): Promise<ChatResponse> {
  let current = request;
  let retriedToolCall = false;
  let waited = false;

  for (;;) {
    try {
      return await model.chat(current);
    } catch (error) {
      if (!(error instanceof ModelError)) throw toAppError(error);

      if (error.code === 'tool_use_failed' && !retriedToolCall) {
        retriedToolCall = true;
        continue;
      }
      if (error.status === 429) {
        const wait = error.retryAfterSeconds;
        if (!waited && wait !== null && wait <= MAX_RATE_LIMIT_WAIT_SECONDS) {
          waited = true;
          await sleep(wait * 1000);
          continue;
        }
        const fallback = FALLBACK_MODELS[current.model];
        if (fallback) {
          current = { ...current, model: fallback };
          continue;
        }
      }
      throw toAppError(error);
    }
  }
}

const RECEIPT_PROMPT = `Read this image for a personal finance app. If it is a receipt, bill, invoice or payment screenshot, transcribe: the merchant, the date, each line item with its amount, taxes or tips, the grand total, and how it was paid if shown. Use the amounts exactly as printed. If something is unreadable, say so rather than guessing. If it is not a receipt, describe in one or two sentences what it shows. Plain text only.`;

type AttachedImage = NonNullable<AssistantRequest['messages'][number]['image']>;

async function readReceipt(model: AssistantClient, image: AttachedImage): Promise<string> {
  const response = await chatWithRetry(model, {
    model: VISION_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: RECEIPT_PROMPT },
          { type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.data}` } },
        ],
      },
    ],
    // The free tier caps this model at 1,000 output tokens a minute; a transcript needs far fewer.
    max_completion_tokens: 700,
    temperature: 0,
  });
  const text = (response.choices[0]?.message.content ?? '')
    // Some models think out loud in tags; only the answer is wanted.
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim();
  return text || 'The photo could not be read.';
}

async function runTool(
  userId: string,
  call: ToolCall,
  request: AssistantRequest,
  people: { id: string; name: string }[],
  drafts: AssistantDraft[],
): Promise<string> {
  let input: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(call.function.arguments || '{}');
    input = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return 'Error: the arguments were not valid JSON. Send the call again with valid JSON.';
  }

  switch (call.function.name) {
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
      return `There is no tool called ${call.function.name}.`;
  }
}

/** Map provider failures to sentences. */
function toAppError(error: unknown): Error {
  if (!(error instanceof ModelError)) return error instanceof Error ? error : new Error(String(error));
  if (error.status === 401 || error.status === 403) {
    return serviceUnavailable('The assistant’s API key was rejected. Check GROQ_API_KEY.', 'assistant_misconfigured');
  }
  if (error.status === 429) {
    return tooManyRequests('Chillar needs a breather — the free plan allows only a few questions a minute. Try again shortly.');
  }
  if (error.status === 400 || error.status === 413) {
    console.error('[assistant] request rejected', error.code, error.message);
    return serviceUnavailable('The assistant could not handle that request. Nothing was changed.', 'assistant_failed');
  }
  if (error.status === null) {
    return serviceUnavailable('Could not reach the assistant. Nothing was changed.', 'assistant_failed');
  }
  return serviceUnavailable('The assistant is unavailable right now. Nothing was changed.', 'assistant_failed');
}
