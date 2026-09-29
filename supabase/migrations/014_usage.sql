-- ============================================================
-- Chop — 014_usage.sql
--
-- The Gemini free tier is counted in REQUESTS, not tokens:
-- roughly 15 a minute and 1,500 a day. Nothing in the app knew
-- how close it was to that, so a 429 arrived as a surprise.
--
-- Every model call records a row. URL imports that parsed the
-- site's own structured data record nothing, because they never
-- called anything.
-- ============================================================

create table if not exists model_calls (
  id           uuid primary key default uuid_generate_v4(),
  household_id uuid not null references households(id) on delete cascade,
  kind         text not null,          -- import | generate | suggest | receipt | steps
  called_at    timestamptz not null default now()
);

create index if not exists model_calls_recent
  on model_calls (household_id, called_at desc);

alter table model_calls enable row level security;

create policy calls_all on model_calls
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

-- How much of today's free allowance is gone.
create or replace function usage_today(hid uuid)
returns table (calls_today integer, calls_this_minute integer)
language sql
stable
as $$
  select
    count(*) filter (where called_at > now() - interval '24 hours')::integer,
    count(*) filter (where called_at > now() - interval '1 minute')::integer
  from model_calls
  where household_id = hid;
$$;

grant execute on function usage_today(uuid) to authenticated;

-- Keep it tidy; nothing here matters after a week.
create or replace function prune_model_calls()
returns integer
language sql
as $$
  with gone as (
    delete from model_calls where called_at < now() - interval '7 days'
    returning 1
  ) select count(*)::integer from gone;
$$;

notify pgrst, 'reload schema';
