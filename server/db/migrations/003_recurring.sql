-- Recurring expenses (subscriptions, utilities). Kept apart from transactions: they are a standing amount, not a dated event.
-- The dashboard spreads each one over the months it is active (a yearly bill counts as one twelfth per month).
create table recurring_expenses (
  id               bigserial primary key,
  description      text not null check (length(btrim(description)) between 1 and 200),
  amount_centavos  bigint not null check (amount_centavos > 0 and amount_centavos <= 9000000000000),
  frequency        text not null check (frequency in ('monthly', 'yearly')),
  category_id      bigint not null references categories(id),
  -- the first charge; the day of the month (and month, for yearly) it repeats on
  start_date       date not null,
  -- the last month it applies to; null = still running
  end_date         date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
