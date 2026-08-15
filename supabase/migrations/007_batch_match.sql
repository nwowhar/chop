-- ============================================================
-- Chop — 007_batch_match.sql
--
-- The parse function was making one match_ingredient round trip
-- per ingredient — thirty-odd sequential calls to Postgres for a
-- single recipe. This does the lot in one.
--
-- Also puts import_jobs on realtime so the client can watch a
-- job progress instead of holding an HTTP connection open.
-- ============================================================

create or replace function match_ingredients_batch(names text[])
returns table (
  input          text,
  id             uuid,
  canonical_name text,
  score          numeric
)
language sql
stable
as $$
  select n.name,
         m.id,
         m.canonical_name,
         m.score
  from unnest(names) as n(name)
  left join lateral (
    select * from match_ingredient(n.name, 0.30) limit 1
  ) m on true;
$$;

grant execute on function match_ingredients_batch(text[]) to authenticated, service_role;

-- ------------------------------------------------------------
-- Watch job progress without holding a connection open.
-- ------------------------------------------------------------

alter publication supabase_realtime add table import_jobs;

-- ------------------------------------------------------------
-- Progress reporting. The function writes a stage here so the
-- UI can say something more useful than "working".
-- ------------------------------------------------------------

alter table import_jobs
  add column if not exists stage text;

comment on column import_jobs.stage is
  'reading | writing — human-facing progress, not a state machine';
