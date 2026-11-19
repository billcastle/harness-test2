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
   - `TRUST_PROXY` = `true` (Vercel overwrites `X-Forwarded-For`; this makes the per-IP lockout see the real client)
4. **Domain:** Vercel project, Settings, Domains: add your subdomain and create the CNAME it shows. Certificates are automatic.
5. **Set the PIN once, from your own machine** (migrations run on the first request, so deploy first, load the site once, then):
   ```
   cd server && DATABASE_URL='<neon string>' npm run reset-pin
   ```
   The PIN is typed at a hidden prompt. Run the same command to reset it later.

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
