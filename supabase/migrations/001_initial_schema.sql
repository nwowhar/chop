-- ============================================================
-- Chop — 001_initial_schema.sql
-- Supabase / Postgres 15+
--
-- Run against chop-dev first. Everything is household-scoped;
-- nothing is scoped to a single user.
-- ============================================================

create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm;      -- fuzzy ingredient matching
create extension if not exists unaccent;

-- ============================================================
-- Enums
-- ============================================================

create type meal_slot     as enum ('breakfast', 'lunch', 'dinner', 'snack');
create type source_type   as enum ('instagram', 'url', 'manual', 'receipt');
create type steps_origin  as enum ('extracted', 'generated', 'partial');
create type stock_conf    as enum ('confirmed', 'assumed', 'stale');
create type list_status   as enum ('draft', 'active', 'done');
create type import_status as enum ('queued', 'parsing', 'review', 'saved', 'failed');

-- Base units only. Everything is converted at parse time.
create type base_unit     as enum ('g', 'ml', 'each');

-- ============================================================
-- Households
-- ============================================================

create table households (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  invite_code text unique default encode(gen_random_bytes(4), 'hex'),
  created_at  timestamptz not null default now()
);

create table household_members (
  household_id uuid not null references households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index on household_members (user_id);

-- SECURITY DEFINER breaks the RLS recursion: policies on
-- household_members cannot themselves query household_members
-- under RLS without looping forever.
create or replace function is_household_member(hid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from household_members
    where household_id = hid and user_id = auth.uid()
  );
$$;

-- ============================================================
-- Canonical ingredients (global, not household-scoped)
--
-- The backbone. Pantry matching, list aggregation, dietary
-- flags and macros all resolve through this table.
-- ============================================================

create table ingredients (
  id                uuid primary key default uuid_generate_v4(),
  canonical_name    text not null unique,
  aliases           text[] not null default '{}',
  category          text not null default 'pantry'
                    check (category in ('produce','dairy','meat','seafood','bakery',
                                        'pantry','spice','frozen','drinks','household')),

  -- units and conversion
  default_unit      base_unit not null default 'g',
  g_per_ml          numeric,          -- density, for volume → weight
  g_per_each        numeric,          -- 'one onion' → grams

  -- behaviour
  is_staple         boolean not null default false,
  shelf_life_days   integer,

  -- purchasing
  purchase_unit     base_unit,
  pack_size         numeric,

  -- dietary
  is_meat           boolean not null default false,
  is_fish           boolean not null default false,
  is_dairy          boolean not null default false,
  is_gluten         boolean not null default false,

  -- macros per 100 g
  protein_g_per_100 numeric,
  carb_g_per_100    numeric,
  fat_g_per_100     numeric,
  fibre_g_per_100   numeric,
  macro_source      text check (macro_source in ('afcd','estimated','manual')),

  created_at        timestamptz not null default now()
);

create index ingredients_name_trgm on ingredients using gin (canonical_name gin_trgm_ops);
create index ingredients_aliases    on ingredients using gin (aliases);
create index ingredients_category   on ingredients (category);
create index ingredients_staple     on ingredients (is_staple) where is_staple;

-- Unmatched extractions land here and grow the table over time.
create table ingredient_review_queue (
  id           uuid primary key default uuid_generate_v4(),
  raw_text     text not null,
  suggested_id uuid references ingredients(id),
  confidence   numeric,
  occurrences  integer not null default 1,
  resolved     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Fuzzy match against canonical names and aliases.
create or replace function match_ingredient(q text, min_score numeric default 0.3)
returns table (id uuid, canonical_name text, score numeric)
language sql
stable
as $$
  with needle as (select lower(unaccent(trim(q))) as t)
  select i.id,
         i.canonical_name,
         greatest(
           similarity(lower(i.canonical_name), (select t from needle)),
           coalesce((
             select max(similarity(lower(a), (select t from needle)))
             from unnest(i.aliases) a
           ), 0)
         ) as score
  from ingredients i
  where greatest(
          similarity(lower(i.canonical_name), (select t from needle)),
          coalesce((
            select max(similarity(lower(a), (select t from needle)))
            from unnest(i.aliases) a
          ), 0)
        ) >= min_score
  order by score desc
  limit 5;
$$;

-- ============================================================
-- Recipes
-- ============================================================

create table recipes (
  id               uuid primary key default uuid_generate_v4(),
  household_id     uuid not null references households(id) on delete cascade,
  title            text not null,
  servings         integer,
  source_type      source_type not null default 'instagram',
  source_handle    text,
  source_url       text,
  image_path       text,
  steps_origin     steps_origin not null default 'extracted',
  scales_well      boolean not null default true,
  macros_per_serve jsonb,
  tags             text[] not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index on recipes (household_id);
create index recipes_title_trgm on recipes using gin (title gin_trgm_ops);

create table recipe_sections (
  id         uuid primary key default uuid_generate_v4(),
  recipe_id  uuid not null references recipes(id) on delete cascade,
  name       text not null,
  sort_order integer not null default 0
);

create index on recipe_sections (recipe_id);

create table recipe_ingredients (
  id               uuid primary key default uuid_generate_v4(),
  recipe_id        uuid not null references recipes(id) on delete cascade,
  section_id       uuid references recipe_sections(id) on delete set null,
  ingredient_id    uuid references ingredients(id),
  raw_text         text not null,          -- never discarded
  qty              numeric,                -- null = "to taste" / no amount given
  unit             base_unit,
  optional         boolean not null default false,
  is_topping       boolean not null default false,
  match_confidence numeric,
  sort_order       integer not null default 0
);

create index on recipe_ingredients (recipe_id);
create index on recipe_ingredients (ingredient_id);

create table recipe_steps (
  id            uuid primary key default uuid_generate_v4(),
  recipe_id     uuid not null references recipes(id) on delete cascade,
  step_no       integer not null,
  text          text not null,
  timer_seconds integer,
  unique (recipe_id, step_no)
);

create index on recipe_steps (recipe_id);

-- ============================================================
-- Import queue
-- ============================================================

create table import_jobs (
  id            uuid primary key default uuid_generate_v4(),
  household_id  uuid not null references households(id) on delete cascade,
  created_by    uuid not null references auth.users(id),
  image_paths   text[] not null,          -- grouped: overlapping shots of one post
  status        import_status not null default 'queued',
  parsed        jsonb,                    -- pre-review payload
  error         text,
  recipe_id     uuid references recipes(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index on import_jobs (household_id, status);

-- ============================================================
-- Pantry
-- ============================================================

create table pantry_items (
  household_id  uuid not null references households(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  qty           numeric,                  -- null for staples
  unit          base_unit,
  in_stock      boolean not null default true,
  added_at      timestamptz not null default now(),
  expires_at    timestamptz,
  confidence    stock_conf not null default 'confirmed',
  primary key (household_id, ingredient_id)
);

create index on pantry_items (household_id) where in_stock;
create index on pantry_items (expires_at) where in_stock;

-- ============================================================
-- Meal plan
-- ============================================================

create table meal_plan (
  id           uuid primary key default uuid_generate_v4(),
  household_id uuid not null references households(id) on delete cascade,
  date         date not null,
  slot         meal_slot not null default 'dinner',
  recipe_id    uuid not null references recipes(id) on delete cascade,
  servings     integer,
  cooked_at    timestamptz,
  unique (household_id, date, slot, recipe_id)
);

create index on meal_plan (household_id, date);

-- ============================================================
-- Shopping lists
-- ============================================================

create table shopping_lists (
  id           uuid primary key default uuid_generate_v4(),
  household_id uuid not null references households(id) on delete cascade,
  week_of      date not null,
  status       list_status not null default 'active',
  created_at   timestamptz not null default now(),
  unique (household_id, week_of)
);

create table list_items (
  id                uuid primary key default uuid_generate_v4(),
  list_id           uuid not null references shopping_lists(id) on delete cascade,
  ingredient_id     uuid references ingredients(id),
  label             text,                 -- for manual items with no canonical match
  qty_needed        numeric,
  qty_to_buy        numeric,
  unit              base_unit,
  source_recipe_ids uuid[] not null default '{}',
  is_check_only     boolean not null default false,
  manual            boolean not null default false,
  checked_at        timestamptz,
  checked_by        uuid references auth.users(id)
);

create index on list_items (list_id);

-- ============================================================
-- Trigger: ticking an item off stocks the pantry
--
-- This is the whole "no data entry chore" design. Buying is
-- the event that adds stock; there is no separate action.
-- ============================================================

create or replace function stock_from_checked_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  hid  uuid;
  life integer;
begin
  if new.checked_at is null or old.checked_at is not null then
    return new;
  end if;
  if new.ingredient_id is null then
    return new;
  end if;

  select sl.household_id into hid
  from shopping_lists sl where sl.id = new.list_id;

  select shelf_life_days into life
  from ingredients where id = new.ingredient_id;

  insert into pantry_items (household_id, ingredient_id, qty, unit,
                            in_stock, added_at, expires_at, confidence)
  values (hid, new.ingredient_id, new.qty_to_buy, new.unit,
          true, now(),
          case when life is not null then now() + (life || ' days')::interval end,
          'confirmed')
  on conflict (household_id, ingredient_id) do update
    set qty        = coalesce(pantry_items.qty, 0) + coalesce(excluded.qty, 0),
        in_stock   = true,
        added_at   = now(),
        expires_at = excluded.expires_at,
        confidence = 'confirmed';

  return new;
end;
$$;

create trigger trg_stock_from_checked_item
  after update of checked_at on list_items
  for each row execute function stock_from_checked_item();

-- ============================================================
-- Trigger: marking a meal cooked depletes the pantry
-- ============================================================

create or replace function deplete_on_cooked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  scale numeric;
begin
  if new.cooked_at is null or old.cooked_at is not null then
    return new;
  end if;

  select coalesce(new.servings, r.servings, 1)::numeric
       / nullif(coalesce(r.servings, 1), 0)
  into scale
  from recipes r where r.id = new.recipe_id;

  update pantry_items p
  set qty = greatest(coalesce(p.qty, 0) - (ri.qty * coalesce(scale, 1)), 0),
      in_stock = case
        when p.qty is null then p.in_stock  -- staples stay boolean
        when greatest(coalesce(p.qty, 0) - (ri.qty * coalesce(scale, 1)), 0) <= 0
          then false
        else true
      end
  from recipe_ingredients ri
  where ri.recipe_id = new.recipe_id
    and ri.ingredient_id = p.ingredient_id
    and ri.qty is not null
    and p.household_id = new.household_id;

  return new;
end;
$$;

create trigger trg_deplete_on_cooked
  after update of cooked_at on meal_plan
  for each row execute function deplete_on_cooked();

-- ============================================================
-- Function: build the shopping list for a week
--
-- Sums ACROSS SECTIONS — a recipe with butter in the marinade,
-- the sauce and the naan buys butter once.
-- ============================================================

create or replace function build_shopping_list(hid uuid, wk date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  lid uuid;
begin
  if not is_household_member(hid) then
    raise exception 'not a member of this household';
  end if;

  insert into shopping_lists (household_id, week_of)
  values (hid, wk)
  on conflict (household_id, week_of) do update set status = 'active'
  returning id into lid;

  delete from list_items where list_id = lid and manual = false;

  insert into list_items (list_id, ingredient_id, qty_needed, qty_to_buy,
                          unit, source_recipe_ids, is_check_only)
  select lid,
         agg.ingredient_id,
         agg.needed,
         case
           when agg.needed is null then null
           when i.pack_size is not null
             then ceil(greatest(agg.needed - coalesce(p.qty, 0), 0) / i.pack_size) * i.pack_size
           else greatest(agg.needed - coalesce(p.qty, 0), 0)
         end,
         agg.unit,
         agg.recipe_ids,
         agg.needed is null
  from (
    select ri.ingredient_id,
           ri.unit,
           sum(ri.qty * coalesce(mp.servings, r.servings, 1)::numeric
               / nullif(coalesce(r.servings, 1), 0))          as needed,
           array_agg(distinct r.id)                            as recipe_ids
    from meal_plan mp
    join recipes r             on r.id = mp.recipe_id
    join recipe_ingredients ri on ri.recipe_id = r.id
    where mp.household_id = hid
      and mp.date >= wk
      and mp.date <  wk + 7
      and mp.cooked_at is null
      and ri.ingredient_id is not null
    group by ri.ingredient_id, ri.unit
  ) agg
  join ingredients i on i.id = agg.ingredient_id
  left join pantry_items p
         on p.ingredient_id = agg.ingredient_id
        and p.household_id  = hid
        and p.in_stock
  -- staples already in stock never hit the list
  where not (i.is_staple and coalesce(p.in_stock, false))
    and (agg.needed is null or greatest(agg.needed - coalesce(p.qty, 0), 0) > 0
         or p.qty is null);

  return lid;
end;
$$;

-- ============================================================
-- Function: cook from stock
--
-- Ranks the household's own recipes against a chosen set of
-- pantry ingredients. Missing staples are penalised far less
-- than missing specialty items — that weighting is what makes
-- the results feel sensible.
-- ============================================================

create or replace function cook_from_stock(
  hid uuid,
  selected uuid[],
  max_results integer default 20
)
returns table (
  recipe_id     uuid,
  title         text,
  used_count    integer,
  missing_count integer,
  missing_names text[],
  make_tonight  boolean,
  score         numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with have as (
    select ingredient_id, qty, expires_at
    from pantry_items
    where household_id = hid and in_stock
  ),
  scored as (
    select r.id,
           r.title,
           count(*) filter (
             where ri.ingredient_id = any(selected)
           )::int as used,
           count(*) filter (
             where h.ingredient_id is null and not i.is_staple and not ri.optional
           )::int as missing_key,
           count(*) filter (
             where h.ingredient_id is null and i.is_staple
           )::int as missing_staple,
           count(*) filter (
             where h.expires_at is not null
               and h.expires_at < now() + interval '4 days'
           )::int as uses_expiring,
           array_agg(i.canonical_name) filter (
             where h.ingredient_id is null and not i.is_staple and not ri.optional
           ) as missing
    from recipes r
    join recipe_ingredients ri on ri.recipe_id = r.id
    join ingredients i         on i.id = ri.ingredient_id
    left join have h           on h.ingredient_id = ri.ingredient_id
    where r.household_id = hid
    group by r.id, r.title
  )
  select id,
         title,
         used,
         missing_key,
         coalesce(missing, '{}'),
         missing_key = 0,
         (used * 3) + (uses_expiring * 2) - (missing_key * 2) - (missing_staple * 0.5)
  from scored
  where used > 0
  order by 7 desc, missing_key asc
  limit max_results;
$$;

-- ============================================================
-- updated_at
-- ============================================================

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger trg_recipes_touch before update on recipes
  for each row execute function touch_updated_at();

-- ============================================================
-- Row level security
-- ============================================================

alter table households             enable row level security;
alter table household_members      enable row level security;
alter table recipes                enable row level security;
alter table recipe_sections        enable row level security;
alter table recipe_ingredients     enable row level security;
alter table recipe_steps           enable row level security;
alter table import_jobs            enable row level security;
alter table pantry_items           enable row level security;
alter table meal_plan              enable row level security;
alter table shopping_lists         enable row level security;
alter table list_items             enable row level security;
alter table ingredients            enable row level security;
alter table ingredient_review_queue enable row level security;

-- Canonical ingredients: everyone reads, only service role writes.
create policy ing_read on ingredients
  for select to authenticated using (true);

create policy queue_read on ingredient_review_queue
  for select to authenticated using (true);
create policy queue_insert on ingredient_review_queue
  for insert to authenticated with check (true);

-- Households
create policy hh_read on households
  for select using (is_household_member(id));
create policy hh_insert on households
  for insert with check (true);
create policy hh_update on households
  for update using (is_household_member(id));

create policy hm_read on household_members
  for select using (user_id = auth.uid() or is_household_member(household_id));
create policy hm_insert on household_members
  for insert with check (user_id = auth.uid() or is_household_member(household_id));
create policy hm_delete on household_members
  for delete using (is_household_member(household_id));

-- Direct household-scoped tables
create policy recipes_all on recipes
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy pantry_all on pantry_items
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy plan_all on meal_plan
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy lists_all on shopping_lists
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy imports_all on import_jobs
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

-- Child tables inherit through their parent
create policy sections_all on recipe_sections
  for all using (exists (
    select 1 from recipes r
    where r.id = recipe_id and is_household_member(r.household_id)));

create policy ri_all on recipe_ingredients
  for all using (exists (
    select 1 from recipes r
    where r.id = recipe_id and is_household_member(r.household_id)));

create policy steps_all on recipe_steps
  for all using (exists (
    select 1 from recipes r
    where r.id = recipe_id and is_household_member(r.household_id)));

create policy list_items_all on list_items
  for all using (exists (
    select 1 from shopping_lists sl
    where sl.id = list_id and is_household_member(sl.household_id)));

-- ============================================================
-- Realtime — the shared shopping list
-- ============================================================

alter publication supabase_realtime add table list_items;
alter publication supabase_realtime add table pantry_items;
