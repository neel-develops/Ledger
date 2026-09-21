# Ledger — a personal money OS

A private, mobile-first ledger for tracking cash, digital money, savings, Dad's
money, what you lent and what you owe — built so that **every rupee stays
mathematically accountable**.

It is not an expense tracker with a debt feature bolted on. Underneath is a
real double-entry ledger; the interface just never makes you look at it.

---

## The accounting model

Everything below follows from three decisions.

**1. Money is an integer number of paise.** ₹150.50 is `15050`, everywhere —
in the keypad, over the wire, in Postgres. No floating point ever touches a
financial value. `shared/money.ts` is the only place money arithmetic happens.

**2. Balances are never stored.** There is no `balance` column anywhere. Every
figure in the app is `SUM(amount)` over `ledger_entries`, so a balance cannot
drift away from the history that produced it.

**3. Location and ownership are different things.** An account says *where*
money is (Cash, Bank, UPI, Savings). A pool says *whose* it is (My money, Dad
money). ₹5,000 of Dad's money can sit partly in Cash and partly in Bank, and
both views stay correct because every asset entry carries both.

### Entries

Each entry belongs to one bucket, and amounts are stored debit-positive so that
**the entries of a transaction always sum to zero**:

| Bucket | `+` means | Requires |
| --- | --- | --- |
| `asset` | money I hold went up | account + pool |
| `receivable` | someone owes me more | person |
| `payable` | I owe *less* (liabilities are credit-normal) | person |
| `expense` | I spent more | category (optional) |
| `income` | — (income is credit-normal, so `-` means earned) | category (optional) |
| `equity` | — opening balances and corrections | |

The global invariant then falls out for free:

```
Net Position = Σ(asset) + Σ(receivable) + Σ(payable)
             = what I hold + what I'm owed − what I owe
```

### What each action does

| You did this | The ledger records | Net position |
| --- | --- | --- |
| Spent ₹500 | cash −500, expense +500 | ↓ 500 |
| Got ₹500 | cash +500, income −500 | ↑ 500 |
| Moved ₹500 Cash → Bank | cash −500, bank +500 | unchanged |
| Moved ₹1,000 Dad → Personal | asset(cash,dad) −1000, asset(cash,personal) +1000 | unchanged |
| Saved ₹1,000 | cash −1000, savings +1000 | unchanged |
| Lent Rahul ₹500 | cash −500, receivable(Rahul) +500 | **unchanged** |
| Borrowed ₹1,000 | cash +1000, payable(Sahil) −1000 | **unchanged** |
| Rahul repaid ₹300 | cash +300, receivable(Rahul) −300 | unchanged |
| Paid Rahul's ₹500 bill directly | cash −500, payable(Rahul) +500 | unchanged |
| ₹1,200 dinner, my share ₹400 | cash −1200, expense +400, receivable(Rahul) +800 | ↓ 400 |
| Rahul paid for my ₹450 meal | expense +450, payable(Rahul) −450 | ↓ 450 |
| Refund ₹300 | cash +300, expense −300 | ↑ 300 |
| Cash count is ₹50 short | cash −50, equity +50 | ↓ 50 |

Lending is not an expense. Borrowing is not income. Savings is not spending.
Transfers cannot create money. All of that is enforced by the engine, tested,
and re-checked by the database.

### Four layers of protection

1. **A pure engine.** `server/domain/ledger.ts` builds entries and refuses to
   return anything unbalanced. No database, no clock, no randomness.
2. **Column constraints.** Amounts non-zero, asset entries must name an account
   *and* an owner, debt entries must name a person.
3. **A deferred constraint trigger.** At `COMMIT`, Postgres re-sums every
   touched transaction and aborts if it is not zero or has fewer than two legs
   (`0001_ledger_balance_guard.sql`). A bug in the application cannot corrupt
   the ledger.
4. **A health screen.** Ten checks that query the real data on demand.

### History is never edited

There is no `DELETE` endpoint for a transaction. A mistake is corrected by a
**reversal** — the exact mirror image, written as its own visible transaction.
A cash count that disagrees with reality produces an **adjustment**, never a
silent edit. You can always see what you believed at the time.

---

## Getting started

```bash
npm install
cp .env.example .env    # then fill in DATABASE_URL and BETTER_AUTH_SECRET
npm run db:migrate
npm run dev
```

Open http://localhost:5173.

### Without a database

`npm run dev:db` starts a throwaway Postgres (PGlite, WebAssembly — nothing to
install) on port 55432. Point `DATABASE_URL` at it and set `DB_POOL_MAX=1`,
since it accepts one connection at a time. For local development only.

### Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon Postgres, **pooled** endpoint. The source of truth. |
| `BETTER_AUTH_SECRET` | yes | ≥32 random chars. `openssl rand -base64 32` |
| `APP_URL` | yes | Public origin; used for cookies, CSP and auth callbacks |
| `DB_POOL_MAX` | no | Pool size per instance |
| `SUPABASE_*` | no | File storage for receipts and backup archives only |

The app refuses to start in production without a database and an auth secret.
Without a database in development it answers `503` and the UI says so — it does
not invent data to fill the gap.

---

## Commands

```bash
npm run dev            # API + web
npm run dev:db         # throwaway local Postgres, no install needed
npm test               # 99 tests, incl. 14 against a real Postgres
npm run typecheck      # client and server
npm run lint
npm run build
npm run db:generate    # new migration from schema changes
npm run db:migrate

npm run android:sync   # build the web app and copy it into the Android project
npm run android:open   # open in Android Studio
npm run android:run    # build and install on a plugged-in phone
```

---

## Architecture

```
shared/          money.ts, domain.ts, nlp.ts  — imported by both sides,
                 so a transaction kind can never mean two things
server/
  domain/        the ledger engine + input schemas (pure, no I/O)
  services/      transactions, balances, people, reconciliation,
                 health, insights, backup  — all the accounting logic
  routes/        thin HTTP handlers; no business logic
  db/            Drizzle schema, migrations, error decoding
src/             React app — one column, mobile first
api/index.ts     Vercel entry; the same Express app as local dev
tests/           integration suite against a real Postgres
```

Route handlers only parse, delegate and serialise. Accounting lives in
`domain` and `services`.

### Testing

`npm test` runs without any setup. The integration suite uses PGlite — real
Postgres in-process — and applies the real migrations, so the constraint
trigger, atomic rollback, idempotent replay, atomic edit-as-replace and
per-user isolation are all genuinely exercised rather than mocked.

The suite walks a full scenario (opening balances → Dad's money → a pool move →
an expense → a loan → a partial repayment → a savings transfer) and
independently recomputes the position after every step.

---

## Offline

The service worker caches the app shell but **never** `/api` — a balance you
read must always be live. Writes are different: each one is minted with an
idempotency key on the device *before* the first attempt. If the network is
down the write parks in an IndexedDB outbox and replays in order on reconnect.
The server recognises a key it has already committed and returns the original
transaction, so a replay can never double-charge the ledger.

You are never told a transaction saved when it did not.

## Security

Session cookies are httpOnly, SameSite=Lax and Secure in production; the client
never holds a token. Identity always comes from the session — a user id in a
body or query string is ignored, and every query is scoped by it. Input is
validated with Zod, queries are parameterised through Drizzle, CSP and security
headers are set, and sign-in, writes and imports are rate limited separately.
Secrets live only in the environment.

---


---

## Android

A Capacitor shell adds the two things a PWA genuinely cannot do: a **native
home-screen widget** and a **daily reminder**. See [android/README.md](android/README.md).

The widget does no arithmetic — it renders figures the app already computed,
passed across as strings of integer paise. So it cannot disagree with the app,
it holds no session, and before its first sync it shows a dash rather than a
zero, because a zero would be a lie about your money.

---

## Deploying

### Vercel

1. Push to GitHub, then import the repo at [vercel.com/new](https://vercel.com/new).
2. Set the environment variables (Project → Settings → Environment Variables):

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | your Neon **pooled** connection string |
   | `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
   | `BETTER_AUTH_URL` | `https://your-app.vercel.app` |
   | `APP_URL` | `https://your-app.vercel.app` |

3. Deploy, then apply the migrations once:
   ```bash
   DATABASE_URL="<your neon url>" npm run db:migrate
   ```

`vercel.json` routes `/api/*` to the serverless Express app and everything else
to the SPA.

### CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs lint, typecheck, the
full test suite and the build on every push. On `main` it also assembles the
Android debug APK and uploads it as an artifact, so you can install the widget
on a phone without opening Android Studio. Set the repository variable
`CAPACITOR_SERVER_URL` to your deployed URL for that job.
