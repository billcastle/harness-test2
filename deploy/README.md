# Deploying to a server

One small Linux server (a VPS) with Docker and Docker Compose, and a subdomain you control.
The stack: **Caddy** (HTTPS, serves the web app, proxies `/api`) → **app** (the API) → **db** (Postgres), plus a **backup** sidecar.
Only Caddy publishes ports (80 and 443). The app and the database are reachable only on internal Docker networks.

## First time

1. Point a DNS record (`expenses.example.com`) at the server. Open ports 80 and 443 in its firewall.
2. Copy the project to the server, then `cp .env.example .env` and fill in `DOMAIN` and `POSTGRES_PASSWORD` (`openssl rand -hex 24`).
3. `docker compose up -d --build`. Caddy gets the HTTPS certificate on its own; the app creates the tables on start.
4. Set the PIN: `docker compose exec app npm run reset-pin` (hidden prompt). Until you do, logins fail.
5. Open `https://<your domain>`.

## Backups (do this before you put real data in)

Dumps are encrypted on the server (rclone `crypt`) and then uploaded to a **private** bucket you own.

1. Make a private bucket (Backblaze B2, Cloudflare R2, AWS S3 ...) and an access key limited to it.
2. Fill the `RCLONE_CONFIG_*` and `BACKUP_*` lines in `.env`. Obscure the two crypt passphrases first:
   `docker run --rm rclone/rclone obscure 'your long passphrase'` (run it twice, use two different passphrases).
3. **Store the passphrases outside this server** (password manager). Without them the backups cannot be read.
4. Optional but recommended: create a check at [healthchecks.io](https://healthchecks.io) and put its URL in `HEALTHCHECK_URL`. It alerts you when a backup silently stops.
5. `docker compose up -d backup` (runs one backup right away, then every `BACKUP_INTERVAL_HOURS`).
6. Prove it works: `docker compose run --rm --entrypoint /backup.sh backup`, then
   `docker compose run --rm --entrypoint /restore-check.sh backup`. The second command restores the newest dump into a scratch database and prints row counts. Do it once now and then monthly.

The PIN hash is inside the database, so it is inside the backups. That is why they are encrypted before they leave the server.

## Updating

`./deploy/deploy.sh` takes a backup first, then rebuilds and restarts. Schema changes are applied automatically on start.

## Operating

| Need | Command |
|---|---|
| Logs | `docker compose logs -f app` |
| Forgot the PIN / locked out | `docker compose exec app npm run reset-pin` (also clears lockouts and signs out every session) |
| Status | `docker compose ps` |
| Stop everything | `docker compose down` (data stays in the `dbdata` volume; `down -v` deletes it) |

## What has and has not been verified

Checked by `server/test/deploy.test.ts`: only Caddy publishes ports; the database network is internal; proxy trust matches the network; required secrets are enforced; the Caddy security headers and 10 MB limit are present; `.env` is ignored.

**Not yet run on a real Docker host** (it was written on a machine without Docker): the image builds, Caddy certificate issuance, the production `pg` driver against a real Postgres, an actual encrypted backup and restore. Do the "Backups" step 6 on the server before trusting it, and see "Known gaps" in `server/README.md`.
