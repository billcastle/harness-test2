# Expense tracker server

Fastify + Postgres API. Design: `../docs/designs/expense-tracker.md`.

## Run locally

You need a Postgres database (not included here). Then:

```bash
cd server
npm install
export DATABASE_URL=postgres://user:pass@localhost:5432/expenses
export ALLOWED_ORIGIN=http://localhost:5173      # exact browser origin(s), comma-separated
export COOKIE_INSECURE_DEV=1                      # local http only; production keeps Secure cookies
npm run reset-pin                                 # sets the 4-digit PIN (hidden prompt)
npm start                                         # migrations run on start; listens on 127.0.0.1:3000
```

`npm test` needs no database: tests run against PGlite (real Postgres compiled to WASM) with the same migration files.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `ALLOWED_ORIGIN` | yes | Exact origin(s) allowed to make changes (CSRF check). Requests without a matching `Origin` header are rejected |
| `COOKIE_INSECURE_DEV` | no | `1` = plain `session` cookie without `Secure` (local http only) |
| `TRUST_PROXY` | no | `true` (Vercel) or comma-separated proxy address/CIDR whose `X-Forwarded-For` is trusted (the Caddy hop). Unset = use the socket address |
| `RATE_LIMIT_PER_MINUTE` | no | Requests per IP per minute, default 600 |
| `HOST`, `PORT` | no | Default `127.0.0.1:3000` |

## Authentication

- Every route requires a session unless it is marked `config: { public: true }` (only `POST /api/login` and `GET /api/health`). New routes are protected by default; `test/auth.test.ts` enforces this for every registered route.
- PIN: exactly 4 digits, argon2id (Node built-in). The hash is stored in the `auth_settings` table so `reset-pin` can change it, which means it is present in database backups (backups are encrypted before leaving the host). A 4-digit hash can be brute-forced offline, so the online lockout is the real protection.
- Lockout (Postgres-backed, decided before the PIN is compared): per IP, 5 failures then blocks of 1, 5, 15, 60 minutes (cap). Globally, at most 30 failed attempts per rolling hour across all IPs; while that cap is active even the correct PIN is refused, and refused attempts are not recorded.
- Sessions: 30-day sliding expiry (written at most once an hour), httpOnly + SameSite=Strict + `__Host-` cookie, token stored only as a hash.
- Recovery: `npm run reset-pin` (in Docker: `docker compose exec app npm run reset-pin`) sets a new PIN, clears every lockout and signs out every session.

## Statement import

`POST /api/import/parse` takes the PDF as the raw body (`Content-Type: application/pdf`, optional `?bank=gcash|bpi|maribank`) and returns a preview (nothing is saved). `POST /api/import/confirm` saves a batch idempotently by `batchId`. `GET /api/import/batches` and `DELETE /api/import/batches/:id` list and undo imports. Parsers are in `src/import/parsers`, classification rules in `src/import/rules.json`.

Tests use synthetic statements (`test/fixtures`). `test/real-statements.test.ts` also runs the real parsers on `../statements/*.pdf` when those private files exist, and is skipped otherwise.

## Known gaps (tracked in the design doc)

- `createPgDb` and the parallel-guess lockout were run once by hand against Postgres 17 (see `../deploy/VERCEL.md`); the automated tests still use PGlite.
- The deployment (`../compose.yaml`, `../deploy/`) has only been checked statically (`test/deploy.test.ts`); it has not been run on a Docker host. See `../deploy/README.md`.
