-- ============================================================
-- Chop — 002_settings.sql
--
-- Yield conversion, pack divisibility, household settings.
-- Run before 003_seed_ingredients.sql.
-- ============================================================

-- ------------------------------------------------------------
-- Yield: what one whole item gives you in volume.
--
-- One canonical row per ingredient, not two. "juice of 1 lemon",
-- "1 tbsp lemon juice" and "juice of 1/2 lemon" all resolve to
-- lemons via ml_per_each, then sum, then round up to whole fruit.
-- Same for garlic: cloves and crushed teaspoons are one row.
-- ------------------------------------------------------------

alter table ingredients
  add column ml_per_each numeric,
  add column divisible   boolean not null default false;

comment on column ingredients.ml_per_each is
  'Volume yielded by one whole item. lemon=45 (juice), garlic=5 (crushed clove).';
comment on column ingredients.divisible is
  'true = buy the shortfall (weighed goods). false = buy whole packs (cans, jars).';

-- ------------------------------------------------------------
-- Household settings — kept deliberately small.
-- Aisle order is hardcoded in the app; it is not a setting.
-- ------------------------------------------------------------

create table household_settings (
  household_id     uuid primary key references households(id) on delete cascade,
  buy_whole_pack   boolean not null default true,   -- applies to divisible items only
  expiry_soon_days integer not null default 4,
  default_servings integer not null default 2
);

alter table household_settings enable row level security;

create policy settings_all on household_settings
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

create or replace function seed_household_settings()
returns trigger language plpgsql as $$
begin
  insert into household_settings (household_id) values (new.id)
  on conflict do nothing;
  return new;
end;
$$;

create trigger trg_seed_household_settings
  after insert on households
  for each row execute function seed_household_settings();

-- ------------------------------------------------------------
-- Buy-as preference: sticky, per household, per ingredient.
--
-- Asked once the first time an ingredient hits a list. Fresh
-- lemons or bottled juice? Whole garlic or the jar? Either way
-- it converts back to the same canonical amount, so the pantry
-- and the recipe maths are unaffected.
-- ------------------------------------------------------------

create table household_ingredient_prefs (
  household_id  uuid not null references households(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  buy_as        base_unit not null,
  primary key (household_id, ingredient_id)
);

alter table household_ingredient_prefs enable row level security;

create policy prefs_all on household_ingredient_prefs
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

-- ------------------------------------------------------------
-- Convert any (qty, unit) pair to the ingredient's base unit.
--
-- Recipe views never call this — they show raw_text, because
-- "3 garlic cloves" is how you cook and "9 g garlic" is not.
-- This is shopping-list and pantry maths only.
-- ------------------------------------------------------------

create or replace function to_base(
  ing_id uuid,
  qty    numeric,
  unit   base_unit
)
returns numeric
language plpgsql
stable
as $$
declare
  i ingredients%rowtype;
begin
  if qty is null then return null; end if;

  select * into i from ingredients where id = ing_id;
  if not found then return null; end if;
  if unit = i.default_unit then return qty; end if;

  -- volume measure against an item sold whole (lemon, garlic)
  if unit = 'ml' and i.default_unit = 'each' then
    if i.ml_per_each is null or i.ml_per_each = 0 then return null; end if;
    return qty / i.ml_per_each;
  end if;

  -- whole item where the base is volume
  if unit = 'each' and i.default_unit = 'ml' then
    return qty * coalesce(i.ml_per_each, 0);
  end if;

  -- volume to weight
  if unit = 'ml' and i.default_unit = 'g' then
    if i.g_per_ml is null then return null; end if;
    return qty * i.g_per_ml;
  end if;

  -- weight to volume
  if unit = 'g' and i.default_unit = 'ml' then
    if i.g_per_ml is null or i.g_per_ml = 0 then return null; end if;
    return qty / i.g_per_ml;
  end if;

  -- whole item to weight
  if unit = 'each' and i.default_unit = 'g' then
    if i.g_per_each is null then return null; end if;
    return qty * i.g_per_each;
  end if;

  -- weight to whole item
  if unit = 'g' and i.default_unit = 'each' then
    if i.g_per_each is null or i.g_per_each = 0 then return null; end if;
    return qty / i.g_per_each;
  end if;

  return null;
end;
$$;

-- ------------------------------------------------------------
-- Rewire the shopping list to aggregate in base units.
--
-- Replaces the version in 001. Everything is normalised through
-- to_base() before summing, so half a cucumber and half a cup of
-- diced cucumber add up instead of appearing twice.
-- ------------------------------------------------------------

create or replace function build_shopping_list(hid uuid, wk date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  lid       uuid;
  whole_pack boolean;
begin
  if not is_household_member(hid) then
    raise exception 'not a member of this household';
  end if;

  select buy_whole_pack into whole_pack
  from household_settings where household_id = hid;
  whole_pack := coalesce(whole_pack, true);

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
           when short.amount <= 0 then 0
           -- indivisible goods always round to a whole pack
           when not i.divisible and i.pack_size is not null
             then ceil(short.amount / i.pack_size) * i.pack_size
           -- divisible goods follow the household preference
           when whole_pack and i.pack_size is not null
             then ceil(short.amount / i.pack_size) * i.pack_size
           -- whole items never come in fractions
           when i.default_unit = 'each' then ceil(short.amount)
           else short.amount
         end,
         i.default_unit,
         agg.recipe_ids,
         agg.needed is null
  from (
    select ri.ingredient_id,
           sum(to_base(ri.ingredient_id, ri.qty, ri.unit)
               * coalesce(mp.servings, r.servings, 1)::numeric
               / nullif(coalesce(r.servings, 1), 0))  as needed,
           array_agg(distinct r.id)                    as recipe_ids
    from meal_plan mp
    join recipes r             on r.id = mp.recipe_id
    join recipe_ingredients ri on ri.recipe_id = r.id
    where mp.household_id = hid
      and mp.date >= wk
      and mp.date <  wk + 7
      and mp.cooked_at is null
      and ri.ingredient_id is not null
    group by ri.ingredient_id
  ) agg
  join ingredients i on i.id = agg.ingredient_id
  left join pantry_items p
         on p.ingredient_id = agg.ingredient_id
        and p.household_id  = hid
        and p.in_stock
  cross join lateral (
    select greatest(coalesce(agg.needed, 0) - coalesce(p.qty, 0), 0) as amount
  ) short
  where not (i.is_staple and coalesce(p.in_stock, false))
    and (agg.needed is null or short.amount > 0 or p.qty is null);

  return lid;
end;
$$;
