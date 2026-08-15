-- ============================================================
-- Chop — 004_display.sql
--
-- Two problems, both about fractional quantities:
--   1. Depletion leaves crumbs. Cooking a recipe that uses "most
--      of" something shouldn't leave 3 g of mince in the pantry.
--   2. Raw numerics are unreadable. Nobody has 0.6666667 onions.
--
-- Storage stays precise. Snapping happens on depletion, rounding
-- happens on display.
-- ============================================================

-- ------------------------------------------------------------
-- snap_empty: treat a trivial remainder as gone.
--
-- Below 5% of a pack, or below 0.15 of anything, is empty. The
-- second rule catches whole items — a third of an onion is real,
-- a tenth of one is not.
-- ------------------------------------------------------------

create or replace function snap_empty(qty numeric, pack numeric default null)
returns numeric
language sql
immutable
as $$
  select case
    when qty is null then null
    when qty <= 0 then 0
    when pack is not null and qty < pack * 0.05 then 0
    when qty < 0.15 then 0
    else qty
  end;
$$;

-- ------------------------------------------------------------
-- display_qty: what the user actually reads.
--
-- Never used in maths. Pantry screens, shopping list rows and
-- kitchen mode call this; nothing else does.
-- ------------------------------------------------------------

create or replace function display_qty(qty numeric, unit base_unit)
returns text
language sql
immutable
as $$
  select case
    when qty is null then ''
    when qty = 0 then '0'

    -- whole items: halves are the only fraction worth showing
    when unit = 'each' then
      case
        when qty < 0.75 then '½'
        when abs(qty - round(qty)) < 0.25 then round(qty)::text
        when qty < 1.75 then '1½'
        else floor(qty)::text || '½'
      end

    -- scale up past a thousand
    when unit = 'g'  and qty >= 1000 then trim(trailing '.0' from round(qty/1000.0, 1)::text) || ' kg'
    when unit = 'ml' and qty >= 1000 then trim(trailing '.0' from round(qty/1000.0, 1)::text) || ' L'

    -- coarser as the number gets bigger
    when qty >= 100 then (round(qty / 5.0) * 5)::text || ' ' || unit::text
    when qty >= 10  then round(qty)::text || ' ' || unit::text
    when qty >= 1   then trim(trailing '.0' from round(qty, 1)::text) || ' ' || unit::text
    else round(qty, 1)::text || ' ' || unit::text
  end;
$$;

-- ------------------------------------------------------------
-- Rewire depletion to snap.
--
-- Replaces the version in 001. Same logic, but the remainder
-- goes through snap_empty and anything that lands on zero is
-- marked out of stock rather than lingering as a crumb.
-- ------------------------------------------------------------

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
  set qty = snap_empty(
              greatest(coalesce(p.qty, 0)
                       - (to_base(ri.ingredient_id, ri.qty, ri.unit)
                          * coalesce(scale, 1)), 0),
              i.pack_size),
      in_stock = case
        when p.qty is null then p.in_stock            -- staples stay boolean
        when snap_empty(
               greatest(coalesce(p.qty, 0)
                        - (to_base(ri.ingredient_id, ri.qty, ri.unit)
                           * coalesce(scale, 1)), 0),
               i.pack_size) = 0 then false
        else true
      end,
      confidence = case
        when p.qty is null then p.confidence
        else 'assumed'::stock_conf                    -- depletion is an estimate
      end
  from recipe_ingredients ri
  join ingredients i on i.id = ri.ingredient_id
  where ri.recipe_id = new.recipe_id
    and ri.ingredient_id = p.ingredient_id
    and ri.qty is not null
    and p.household_id = new.household_id;

  return new;
end;
$$;

-- ------------------------------------------------------------
-- Convenience view for the pantry screen.
-- ------------------------------------------------------------

create or replace view pantry_view as
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

-- Views inherit RLS from their underlying tables under
-- security_invoker, which is what we want here.
alter view pantry_view set (security_invoker = on);
