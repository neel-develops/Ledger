import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../server/db/client';
import { createTestDatabase } from './helpers/testDatabase';
import { users, accounts, transactions, attachments } from '../server/db/schema';
import { bootstrapUser } from '../server/services/bootstrap';
import { createTransaction } from '../server/services/transactions';
import { createPerson, updateAccount } from '../server/services/reference';
import {
  runAssistant,
  __setAssistantClientForTesting,
  ASSISTANT_MODEL,
  type AssistantClient,
} from '../server/services/assistant';
import {
  addAttachment,
  listAttachments,
  removeAttachment,
} from '../server/services/attachments';
import { __setStorageForTesting, type StorageBackend } from '../server/services/storage';

/**
 * The assistant and receipts, against a real Postgres.
 *
 * The model is scripted, so these tests cost nothing and never flake — what
 * they pin down is everything around the model: that its proposals go through
 * the real ledger, that nothing is ever written on its say-so, that a bad
 * proposal comes back to it with a reason, and that private balances never
 * leave the server in its context.
 */

const USER = 'assistant-test-user';
const OTHER = 'assistant-other-user';

function message(content: unknown[], stop_reason: string): Anthropic.Beta.BetaMessage {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`,
    type: 'message',
    role: 'assistant',
    model: ASSISTANT_MODEL,
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  } as unknown as Anthropic.Beta.BetaMessage;
}

/** Replays a fixed script and records every request it was sent. */
function scriptedClient(script: Anthropic.Beta.BetaMessage[]) {
  const requests: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const client: AssistantClient = {
    beta: {
      messages: {
        async create(params) {
          requests.push(structuredClone(params));
          const next = script.shift();
          if (!next) throw new Error('script exhausted');
          return next;
        },
      },
    },
  };
  return { client, requests };
}

const request = (text: string) => ({
  messages: [{ role: 'user' as const, text }],
  today: new Date().toISOString().slice(0, 10),
  timeZoneOffsetMinutes: 330,
});

async function countTransactions(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(eq(transactions.userId, userId));
  return row?.n ?? 0;
}

describe('assistant and receipts', () => {
  let close: () => Promise<void>;
  let cash: string;
  let savings: string;
  let rahul: string;

  beforeAll(async () => {
    ({ close } = await createTestDatabase());
    const db = getDb();
    for (const id of [USER, OTHER]) {
      await db.insert(users).values({ id, name: id, email: `${id}@example.invalid`, emailVerified: true });
      await bootstrapUser(id);
    }
    const rows = await db.select().from(accounts).where(eq(accounts.userId, USER));
    cash = rows.find((a) => a.kind === 'cash')!.id;
    savings = rows.find((a) => a.kind === 'savings')!.id;
    rahul = (await createPerson(USER, { name: 'Rahul', relation: null, note: null }))!.id;

    // A private account with a distinctive balance, to check it never leaks.
    await createTransaction(USER, {
      kind: 'opening_balance',
      amount: 1_234_567,
      toAccountId: savings,
      occurredAt: new Date(),
      note: null,
      idempotencyKey: null,
    });
    await updateAccount(USER, savings, { isPrivate: true });
  });

  afterEach(() => {
    __setAssistantClientForTesting(null);
    __setStorageForTesting(null);
  });

  afterAll(async () => {
    await close();
  });

  it('drafts through the real ledger, rejects what does not add up, and writes nothing', async () => {
    const before = await countTransactions(USER);

    const { client, requests } = scriptedClient([
      message(
        [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'propose_transactions',
            input: {
              drafts: [
                { kind: 'expense', amount: '240', summary: 'Lunch, ₹240', accountId: cash },
                {
                  kind: 'paid_for_someone',
                  amount: '1200',
                  summary: 'Dinner split',
                  myShare: '400',
                  participants: [{ personId: rahul, share: '700' }],
                },
              ],
            },
          },
        ],
        'tool_use',
      ),
      message([{ type: 'text', text: 'Drafted lunch for you to confirm. The dinner split did not add up.' }], 'end_turn'),
    ]);
    __setAssistantClientForTesting(client);

    const result = await runAssistant(USER, request('lunch 240, and dinner 1200 with rahul'));

    // One good draft, checked by the ledger, with its amount in paise.
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.amount).toBe(24000);
    expect(result.drafts[0]?.payload.accountId).toBe(cash);
    expect(result.reply).toMatch(/confirm/);

    // The bad one went back to the model with a reason it can act on.
    const followUp = requests[1]!.messages.at(-1)!;
    const toolResult = JSON.stringify(followUp.content);
    expect(toolResult).toContain('rejected');
    expect(toolResult).toMatch(/do not add up/);

    // And nothing at all was written.
    expect(await countTransactions(USER)).toBe(before);
  });

  it('asks the API for the right model, with refusal fallbacks on', async () => {
    const { client, requests } = scriptedClient([message([{ type: 'text', text: 'Hi!' }], 'end_turn')]);
    __setAssistantClientForTesting(client);

    await runAssistant(USER, request('hello'));

    const sent = requests[0]!;
    expect(sent.model).toBe('claude-opus-5');
    expect(sent.fallbacks).toBe('default');
    expect(sent.betas).toContain('server-side-fallback-2026-07-01');
    expect(sent.thinking).toEqual({ type: 'adaptive' });
  });

  it('never puts a private account balance in the model’s context', async () => {
    const { client, requests } = scriptedClient([message([{ type: 'text', text: 'ok' }], 'end_turn')]);
    __setAssistantClientForTesting(client);

    await runAssistant(USER, request('how much money do I have?'));

    const context = JSON.stringify(requests[0]!.messages);
    // 1,234,567 paise is ₹12,345.67 — it must appear nowhere.
    expect(context).not.toContain('12,345.67');
    expect(context).not.toContain('1234567');
    // The account is still named, so it can be recorded into — just without a balance.
    // (The snapshot is JSON inside a text block, so its quotes arrive escaped.)
    expect(context).toContain('\\"private\\":true');
  });

  it('drafts a debt to someone new without creating them until confirmed', async () => {
    const { client } = scriptedClient([
      message(
        [
          {
            type: 'tool_use',
            id: 'toolu_2',
            name: 'propose_transactions',
            input: { drafts: [{ kind: 'lend', amount: '300', summary: 'Lent Priya ₹300', newPersonName: 'Priya' }] },
          },
        ],
        'tool_use',
      ),
      message([{ type: 'text', text: 'Drafted.' }], 'end_turn'),
    ]);
    __setAssistantClientForTesting(client);

    const result = await runAssistant(USER, request('gave priya 300'));
    const draft = result.drafts[0]!;
    expect(Object.values(draft.newPeople)).toEqual(['Priya']);
    expect(Object.keys(draft.newPeople)).toContain(draft.payload.personId);
  });

  it('turns a refusal into a polite answer instead of an error', async () => {
    const { client } = scriptedClient([message([], 'refusal')]);
    __setAssistantClientForTesting(client);

    const result = await runAssistant(USER, request('something off-topic'));
    expect(result.drafts).toEqual([]);
    expect(result.reply).toMatch(/can’t help/);
  });

  /* ------------------------------ receipts ----------------------------- */

  function memoryStorage(options: { failUpload?: boolean } = {}) {
    const objects = new Map<string, Buffer>();
    const removed: string[] = [];
    const backend: StorageBackend = {
      async upload(path, body) {
        if (options.failUpload) throw new Error('upload failed');
        objects.set(path, body);
      },
      async signedUrl(path) {
        return `https://storage.test/${path}?sig=1`;
      },
      async remove(path) {
        removed.push(path);
        objects.delete(path);
      },
    };
    return { backend, objects, removed };
  }

  const tinyJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString('base64');

  async function aTransaction(userId: string): Promise<string> {
    const { transaction } = await createTransaction(userId, {
      kind: 'expense',
      amount: 1000,
      occurredAt: new Date(),
      note: 'Receipt test',
      idempotencyKey: null,
    });
    return transaction.id;
  }

  it('stores a receipt under the owner and lists it with a short-lived link', async () => {
    const storage = memoryStorage();
    __setStorageForTesting(storage.backend);
    const txId = await aTransaction(USER);

    const added = await addAttachment(USER, txId, { fileName: 'bill.jpg', contentType: 'image/jpeg', data: tinyJpeg });
    expect(added.url).toContain(`${USER}/receipt/`);
    expect([...storage.objects.keys()][0]).toMatch(new RegExp(`^${USER}/receipt/`));

    const listed = await listAttachments(USER, txId);
    expect(listed.map((a) => a.id)).toEqual([added.id]);
  });

  it('refuses to attach to, or list, another person’s transaction', async () => {
    __setStorageForTesting(memoryStorage().backend);
    const theirs = await aTransaction(OTHER);

    await expect(
      addAttachment(USER, theirs, { fileName: 'x.jpg', contentType: 'image/jpeg', data: tinyJpeg }),
    ).rejects.toThrow(/could not be found/);
    await expect(listAttachments(USER, theirs)).rejects.toThrow(/could not be found/);
  });

  it('refuses the wrong type, corrupt data and oversized files', async () => {
    __setStorageForTesting(memoryStorage().backend);
    const txId = await aTransaction(USER);

    await expect(
      addAttachment(USER, txId, { fileName: 'x.exe', contentType: 'application/x-msdownload', data: tinyJpeg }),
    ).rejects.toThrow(/JPEG, PNG/);
    await expect(
      addAttachment(USER, txId, { fileName: 'x.jpg', contentType: 'image/jpeg', data: 'not base64!!' }),
    ).rejects.toThrow(/could not be read/);

    const big = Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64');
    await expect(
      addAttachment(USER, txId, { fileName: 'x.jpg', contentType: 'image/jpeg', data: big }),
    ).rejects.toThrow(/larger than 3 MB/);
  });

  it('records nothing when the upload fails', async () => {
    __setStorageForTesting(memoryStorage({ failUpload: true }).backend);
    const txId = await aTransaction(USER);

    await expect(
      addAttachment(USER, txId, { fileName: 'x.jpg', contentType: 'image/jpeg', data: tinyJpeg }),
    ).rejects.toThrow();

    const rows = await getDb().select().from(attachments).where(eq(attachments.transactionId, txId));
    expect(rows).toHaveLength(0);
  });

  it('removes a receipt and its file, leaving the transaction untouched', async () => {
    const storage = memoryStorage();
    __setStorageForTesting(storage.backend);
    const txId = await aTransaction(USER);
    const added = await addAttachment(USER, txId, { fileName: 'b.jpg', contentType: 'image/jpeg', data: tinyJpeg });

    await removeAttachment(USER, added.id);

    expect(await listAttachments(USER, txId)).toEqual([]);
    expect(storage.removed).toHaveLength(1);
    const [tx] = await getDb().select().from(transactions).where(eq(transactions.id, txId));
    expect(tx?.amount).toBe(1000);
  });
});
