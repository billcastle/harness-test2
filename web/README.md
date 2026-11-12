# Expense tracker web app

React + Vite + TanStack Query + shadcn/ui (Tailwind v4, Radix, `radix-maia` preset; components live in `src/components/ui`, theme variables in `src/index.css`). Talks to `../server` through `/api` (Vite proxies it in development, so the session cookie stays same-origin).

## Run it locally (no Postgres needed)

Two terminals:

```bash
# 1) server on a local file-backed database (PGlite). Dev only. PIN defaults to 1234; set DEV_PIN=4821 to change it.
cd server && npm install && npm run dev:local

# 2) web app
cd web && npm install && npm run dev      # open http://localhost:5173
```

With a real Postgres instead, see `server/README.md` (use `ALLOWED_ORIGIN=http://localhost:5173` and `COOKIE_INSECURE_DEV=1`).

## Scripts

`npm run dev` · `npm test` (jsdom, no server needed) · `npm run typecheck` · `npm run build`

## What exists

PIN screen, session gate (an expired session returns to the PIN screen), global date range in the URL, Transactions page: quick-add (keyboard-first), click-to-edit cells, edit sheet (including transaction type), delete with a 5-second Undo, search, category filter, paging, and a phone layout below 640px.

Not built yet: Dashboard (summary and charts), Categories page, Import. See `docs/designs/expense-tracker.md`.
