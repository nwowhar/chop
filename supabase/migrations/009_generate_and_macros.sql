-- ============================================================
-- Chop — 009_generate_and_macros.sql
--
-- Three things:
--   1. A job can have no images. hint + theme is enough to
--      generate a recipe from scratch.
--   2. Recipes carry estimated per-serve macros so themes
--      ("high protein", "pre-training") become real queries.
--   3. A view that answers "do I already have this?" for every
--      ingredient in a recipe.
-- ============================================================

alter table import_jobs
  add column if not exists theme text;

comment on column import_jobs.theme is
  'Optional dietary steer: high-protein | pre-training | vegetarian | quick | crowd';

-- image_paths can now be empty for generated recipes
alter table import_jobs
  alter column image_paths set default '{}';

-- ------------------------------------------------------------
-- Macros. Estimated at import, not AFCD-accurate — good enough
-- to sort and filter, not good enough to diet on.
-- ------------------------------------------------------------

create index if not exists recipes_macros
  on recipes using gin (macros_per_serve);

create or replace function recipe_matches_theme(m jsonb, theme text)
returns boolean
language sql
immutable
as $$
  select case
    when m is null then false
    when theme = 'high-protein'  then (m->>'protein_g')::numeric >= 30
    when theme = 'pre-training'  then (m->>'carb_g')::numeric >= 60
                                  and (m->>'fat_g')::numeric   <= 20
                                  and coalesce((m->>'fibre_g')::numeric, 0) <= 8
    when theme = 'low-cal'       then (m->>'kcal')::numeric <= 500
    else true
  end;
$$;

-- ------------------------------------------------------------
-- "Do I have this?" per ingredient, per household.
--
-- Staples are boolean; perishables carry a quantity. Both count
-- as "have" — partial stock counts too, which is the point:
-- garlic bought last week and half used is still garlic.
-- ------------------------------------------------------------

create or replace view recipe_stock_view as
select ri.recipe_id,
       ri.id            as recipe_ingredient_id,
       ri.ingredient_id,
       hm.household_id,
       i.canonical_name,
       i.is_staple,
       ri.qty           as needed_qty,
       ri.unit          as needed_unit,
       p.qty            as have_qty,
       p.in_stock,
       p.expires_at,
       case
         when p.ingredient_id is null then 'none'
         when not p.in_stock then 'none'
         when p.qty is null then 'have'                      -- staple
         when ri.qty is null then 'have'                     -- no amount asked for
         when p.qty >= to_base(ri.ingredient_id, ri.qty, ri.unit) then 'have'
         else 'partial'
       end as stock
from recipe_ingredients ri
join recipes r        on r.id = ri.recipe_id
join household_members hm on hm.household_id = r.household_id
join ingredients i    on i.id = ri.ingredient_id
left join pantry_items p
       on p.ingredient_id = ri.ingredient_id
      and p.household_id  = r.household_id;

alter view recipe_stock_view set (security_invoker = on);

-- ------------------------------------------------------------
-- Add a single recipe's missing ingredients to this week's list
-- without rebuilding the whole thing.
-- ------------------------------------------------------------

create or replace function add_recipe_to_list(
  hid uuid,
  rid uuid,
  wk  date
)
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

  insert into list_items (list_id, ingredient_id, qty_needed, qty_to_buy,
                          unit, source_recipe_ids, is_check_only, manual)
  select lid,
         ri.ingredient_id,
         to_base(ri.ingredient_id, ri.qty, ri.unit),
         case
           when ri.qty is null then null
           when i.pack_size is not null
             then ceil(greatest(to_base(ri.ingredient_id, ri.qty, ri.unit)
                                - coalesce(p.qty, 0), 0) / i.pack_size) * i.pack_size
           when i.default_unit = 'each'
             then ceil(greatest(to_base(ri.ingredient_id, ri.qty, ri.unit)
                                - coalesce(p.qty, 0), 0))
           else greatest(to_base(ri.ingredient_id, ri.qty, ri.unit)
                         - coalesce(p.qty, 0), 0)
         end,
         i.default_unit,
         array[rid],
         ri.qty is null,
         false
  from recipe_ingredients ri
  join ingredients i on i.id = ri.ingredient_id
  left join pantry_items p
         on p.ingredient_id = ri.ingredient_id
        and p.household_id  = hid
        and p.in_stock
  where ri.recipe_id = rid
    and ri.ingredient_id is not null
    and not (i.is_staple and coalesce(p.in_stock, false))
    and not exists (
      select 1 from list_items li
      where li.list_id = lid and li.ingredient_id = ri.ingredient_id
    );

  return lid;
end;
$$;

grant execute on function add_recipe_to_list(uuid, uuid, date) to authenticated;
grant execute on function recipe_matches_theme(jsonb, text) to authenticated;
