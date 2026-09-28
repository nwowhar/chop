-- ============================================================
-- Chop — 012_weekly_pick.sql
--
-- The dashboard's "try something new" suggestions. Generated
-- once a week per household and cached, so opening the app
-- forty times doesn't cost forty model calls.
-- ============================================================

create table if not exists weekly_picks (
  household_id uuid not null references households(id) on delete cascade,
  week_of      date not null,
  suggestions  jsonb not null,
  created_at   timestamptz not null default now(),
  primary key (household_id, week_of)
);

alter table weekly_picks enable row level security;

create policy picks_all on weekly_picks
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

notify pgrst, 'reload schema';
