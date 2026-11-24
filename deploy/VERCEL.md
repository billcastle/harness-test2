# Deploy on Vercel + Neon (free tiers, no Docker)

The web app is served as static files and `/api` runs as one Node function (`server/src/vercel.ts`).
The database is a Neon Postgres. `deploy/build-vercel.mjs` assembles `.vercel/output` (Build Output API v3);
`vercel.json` tells Vercel to run it. The Docker files in this folder are an alternative for a VPS.

## One-time setup

1. **Neon:** create a project at neon.com. Copy the **pooled** connection string (host contains `-pooler`).
2. **GitHub:** push this repo to a private GitHub repository (it has no remote yet; `statements/` and `.env` are git-ignored).
3. **Vercel:** import the repo. Framework preset "Other"; the build settings come from `vercel.json`. Add these environment variables (Production):
   - `DATABASE_URL` = the Neon pooled string
   - `ALLOWED_ORIGIN` = `https://expenses.yourdomain.com` (exact origin, https, no trailing slash)
   - `CRON_SECRET` = a long random string (`openssl rand -hex 32`). Vercel sends it to the monthly cleanup job; without it the job refuses to run
   - `TRUST_PROXY` = `true` (Vercel overwrites `X-Forwarded-For`; this makes the per-IP lockout see the real client)
4. **Domain:** Vercel project, Settings, Domains: add your subdomain and create the CNAME it shows. Certificates are automatic.
5. **Set the PIN once, from your own machine** (migrations run on the first request, so deploy first, load the site once, then):
   ```
   cd server && DATABASE_URL='<neon string>' npm run reset-pin
   ```
   The PIN is typed at a hidden prompt. Run the same command to reset it later.

## Monthly cleanup (Vercel Cron)

`deploy/build-vercel.mjs` registers a cron that calls `GET /api/cron/monthly` at 00:00 UTC on the 1st (8am Manila).
It is checked against `CRON_SECRET`, not the PIN. Each run is safe to repeat and only touches what it is sure about:

1. Tidies stray spaces in descriptions.
2. Gives Uncategorized transactions a category: your remembered merchants first, then a keyword guess (Grab is Transport, Shopee is Shopping, Spotify is Subscriptions ...) among the categories you already have. Unsure ones stay Uncategorized.
3. Finds charges that repeat (same merchant and amount once a month for 3+ months in a row, still going; or yearly) and adds them to Recurring if they are not there yet. Those transactions leave the list (soft-deleted, so the total is counted once, by the recurring entry). Re-importing an old statement will bring them back; leave them out of the import.
4. Remembers merchants that have always gone to one category (3+ times), so the next import pre-fills them.
5. Purges deleted transactions past the undo window, expired sessions and old login counters.

The result is in the function log ("monthly maintenance: ..."). To run it by hand:
`curl -H "Authorization: Bearer $CRON_SECRET" https://expenses.yourdomain.com/api/cron/monthly`

## Backups

Neon's free plan keeps a short point-in-time history only. For your own copy, run when you like:
```
pg_dump "<neon string>" | gzip > expenses-$(date +%F).sql.gz
```
Store it somewhere encrypted. (`brew install postgresql@17` provides `pg_dump`.)

## Verified locally, not yet on Vercel

Checked: the bundle serves requests on Node against a real Postgres 17; migrations are idempotent; login, cookies, the
parallel-guess lockout and the PDF import (bundled worker + pdfjs) work, and the three real statements reconcile.

Not checked until the first deploy: Vercel's request URL handling for the `/api` route, the Node runtime version string
(`nodejs22.x` in `build-vercel.mjs`), the 10 s default function timeout (the config asks for 30 s; Hobby may cap it lower) and
Neon's cold-start delay on the first request after idle. If `/api` returns 404 on Vercel, check the route in `.vercel/output/config.json`.
