-- Schema for the personal expense tracker (step 2).
-- Money is integer centavos. Dates are calendar dates (Asia/Manila is applied by the app, not the DB).

create table categories (
  id          bigserial primary key,
  name        text not null check (length(btrim(name)) between 1 and 60),
  color       text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  is_system   boolean not null default false,
  created_at  timestamptz not null default now()
);
create unique index categories_name_lower_idx on categories (lower(name));

-- The system category can never be deleted or renamed (enforced here, not only in the service).
create function forbid_system_category_change() returns trigger as $$
begin
  if old.is_system then
    if tg_op = 'DELETE' then
      raise exception 'system category cannot be deleted';
    end if;
    if new.name is distinct from old.name or new.is_system is distinct from old.is_system then
      raise exception 'system category cannot be renamed or unflagged';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger categories_system_guard
  before update or delete on categories
  for each row execute function forbid_system_category_change();

insert into categories (name, color, is_system) values ('Uncategorized', '#94a3b8', true);

create table import_batches (
  id           uuid primary key,
  source       text not null check (source in ('bpi', 'gcash', 'maribank')),
  imported_at  timestamptz not null default now()
);

create table transactions (
  id               bigserial primary key,
  date             date not null,
  amount_centavos  bigint not null check (amount_centavos > 0 and amount_centavos <= 9000000000000),
  description      text not null default '' check (length(description) <= 500),
  category_id      bigint not null references categories(id),
  source           text not null default 'manual' check (source in ('manual', 'bpi', 'gcash', 'maribank')),
  kind             text not null default 'expense' check (kind in ('expense', 'income', 'refund', 'transfer', 'ignored')),
  import_batch_id  uuid references import_batches(id),
  -- imported rows only; NOT unique on purpose, so a repeat is flagged in the preview instead of failing a batch
  dedupe_hash      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index transactions_date_idx on transactions (date) where deleted_at is null;
create index transactions_category_date_idx on transactions (category_id, date) where deleted_at is null;
create index transactions_dedupe_idx on transactions (dedupe_hash) where dedupe_hash is not null;
create index transactions_batch_idx on transactions (import_batch_id) where import_batch_id is not null;
create index transactions_deleted_idx on transactions (deleted_at) where deleted_at is not null;

create table merchant_rules (
  merchant_normalized  text primary key,
  category_id          bigint not null references categories(id),
  updated_at           timestamptz not null default now()
);
