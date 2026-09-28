-- ============================================================
-- Chop — 010_repair_views.sql
--
-- Migration 004 put pantry_view at the very end, so if anything
-- above it failed the view never got created. Same shape for 009
-- and recipe_stock_view.
--
-- Everything here is idempotent. Safe to run more than once.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Diagnostic. Run this on its own first and read the output.
-- ------------------------------------------------------------

-- select 'function' as kind, proname as name from pg_proc
-- where proname in ('to_base','display_qty','snap_empty',
--                   'add_recipe_to_list','recipe_matches_theme')
-- union all
-- select 'view', table_name from information_schema.views
-- where table_schema = 'public'
-- union all
-- select 'column', column_name from information_schema.columns
-- where table_name = 'ingredients'
--   and column_name in ('ml_per_each','divisible')
-- order by 1, 2;

-- ------------------------------------------------------------
-- 2. Dependencies the views need
-- ------------------------------------------------------------

alter table ingredients add column if not exists ml_per_each numeric;
alter table ingredients add column if not exists divisible boolean not null default false;

create or replace function snap_empty(qty numeric, pack numeric default null)
returns numeric language sql immutable as $$
  select case
    when qty is null then null
    when qty <= 0 then 0
    when pack is not null and qty < pack * 0.05 then 0
    when qty < 0.15 then 0
    else qty
  end;
$$;

create or replace function display_qty(qty numeric, unit base_unit)
returns text language sql immutable as $$
  select case
    when qty is null then ''
    when qty = 0 then '0'
    when unit = 'each' then
      case
        when qty < 0.75 then '½'
        when abs(qty - round(qty)) < 0.25 then round(qty)::text
        when qty < 1.75 then '1½'
        else floor(qty)::text || '½'
      end
    when unit = 'g' and qty >= 1000 then
      case when round(qty/1000.0, 1) = round(qty/1000.0)
           then round(qty/1000.0)::text else round(qty/1000.0, 1)::text end || ' kg'
    when unit = 'ml' and qty >= 1000 then
      case when round(qty/1000.0, 1) = round(qty/1000.0)
           then round(qty/1000.0)::text else round(qty/1000.0, 1)::text end || ' L'
    when qty >= 100 then (round(qty / 5.0) * 5)::text || ' ' || unit::text
    when qty >= 10  then round(qty)::text || ' ' || unit::text
    else
      case when round(qty, 1) = round(qty)
           then round(qty)::text else round(qty, 1)::text end || ' ' || unit::text
  end;
$$;

create or replace function to_base(ing_id uuid, qty numeric, unit base_unit)
returns numeric language plpgsql stable as $$
declare
  i ingredients%rowtype;
begin
  if qty is null then return null; end if;
  select * into i from ingredients where id = ing_id;
  if not found then return null; end if;
  if unit = i.default_unit then return qty; end if;

  if unit = 'ml' and i.default_unit = 'each' then
    if i.ml_per_each is null or i.ml_per_each = 0 then return null; end if;
    return qty / i.ml_per_each;
  end if;
  if unit = 'each' and i.default_unit = 'ml' then
    return qty * coalesce(i.ml_per_each, 0);
  end if;
  if unit = 'ml' and i.default_unit = 'g' then
    if i.g_per_ml is null then return null; end if;
    return qty * i.g_per_ml;
  end if;
  if unit = 'g' and i.default_unit = 'ml' then
    if i.g_per_ml is null or i.g_per_ml = 0 then return null; end if;
    return qty / i.g_per_ml;
  end if;
  if unit = 'each' and i.default_unit = 'g' then
    if i.g_per_each is null then return null; end if;
    return qty * i.g_per_each;
  end if;
  if unit = 'g' and i.default_unit = 'each' then
    if i.g_per_each is null or i.g_per_each = 0 then return null; end if;
    return qty / i.g_per_each;
  end if;

  return null;
end;
$$;

-- ------------------------------------------------------------
-- 3. The views
-- ------------------------------------------------------------

drop view if exists pantry_view;

create view pantry_view as
select p.household_id,
       p.ingredient_id,
       i.canonical_name,
       i.category,
       i.is_staple,
       p.qty,
       p.unit,
       display_qty(p.qty, coalesce(p.unit, i.default_unit)) as qty_label,
       p.in_stock,
       p.expires_at,
       p.confidence,
       case
         when p.expires_at is null then null
         when p.expires_at < now() then 'expired'
         when p.expires_at < now() + interval '4 days' then 'soon'
         else 'ok'
       end as freshness
from pantry_items p
join ingredients i on i.id = p.ingredient_id;

alter view pantry_view set (security_invoker = on);

drop view if exists recipe_stock_view;

create view recipe_stock_view as
select ri.recipe_id,
       ri.id            as recipe_ingredient_id,
       ri.ingredient_id,
       r.household_id,
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
         when p.qty is null then 'have'
         when ri.qty is null then 'have'
         when p.qty >= coalesce(to_base(ri.ingredient_id, ri.qty, ri.unit), 0) then 'have'
         else 'partial'
       end as stock
from recipe_ingredients ri
join recipes r     on r.id = ri.recipe_id
join ingredients i on i.id = ri.ingredient_id
left join pantry_items p
       on p.ingredient_id = ri.ingredient_id
      and p.household_id  = r.household_id;

alter view recipe_stock_view set (security_invoker = on);

-- ------------------------------------------------------------
-- 4. Grants and cache reload
--
-- New views are not covered by "automatically expose new tables",
-- and PostgREST caches the schema until told otherwise.
-- ------------------------------------------------------------

grant select on public.pantry_view       to authenticated;
grant select on public.recipe_stock_view to authenticated;

notify pgrst, 'reload schema';
