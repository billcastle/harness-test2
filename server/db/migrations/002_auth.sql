-- Authentication: one PIN, server-side sessions, persistent lockout counters.
-- All of this lives in Postgres so a restart or crash can never reset a lockout.

-- Single row. The hash is a secret: it is in DB backups, which is why backups are encrypted before leaving the host.
create table auth_settings (
  id          int primary key check (id = 1),
  pin_hash    text not null,
  updated_at  timestamptz not null default now()
);

-- Only a hash of the cookie token is stored; the token itself exists only in the browser.
create table sessions (
  token_hash    text primary key,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null
);
create index sessions_expires_idx on sessions (expires_at);

-- Per-client-IP failure counter with the escalating block ladder (see src/auth/lockout.ts).
create table login_attempts (
  ip             text primary key,
  failures       int not null default 0,
  blocked_until  timestamptz,
  updated_at     timestamptz not null default now()
);

-- One row per login attempt that was allowed to compare a PIN; removed again when the PIN was correct.
-- Rows older than an hour no longer count. This is the global rolling-hour cap across all IPs.
create table login_failures (
  id  bigserial primary key,
  ip  text not null,
  at  timestamptz not null
);
create index login_failures_at_idx on login_failures (at);
