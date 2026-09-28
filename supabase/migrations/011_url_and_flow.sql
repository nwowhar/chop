-- ============================================================
-- Chop — 011_url_and_flow.sql
--
-- URL import, recipe images, and the shopping list flow fixes.
-- ============================================================

-- Recipes get a picture. For URL imports this is the image the
-- publisher put in their own structured data; for anything else
-- it's a photo you took after cooking it.
alter table recipes add column if not exists image_url text;

-- Jobs can now be a link as well as images or a dish name.
alter table import_jobs add column if not exists source_url text;

-- ------------------------------------------------------------
-- Shopping list flow
-- ------------------------------------------------------------

-- "I already have this" is different from "I bought it". Both
-- clear the row, only one of them is a purchase.
alter table list_items
  add column if not exists dismissed_at timestamptz;

-- ------------------------------------------------------------
-- Clear the list. Keeps manual items unless asked otherwise.
-- ------------------------------------------------------------

create or replace function clear_list(lid uuid, keep_manual boolean default true)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not exists (
    select 1 from shopping_lists sl
    where sl.id = lid and is_household_member(sl.household_id)
  ) then
    raise exception 'not your list';
  end if;

  with gone as (
    delete from list_items
    where list_id = lid
      and (not keep_manual or manual = false)
    returning 1
  )
  select count(*) into n from gone;

  return n;
end;
$$;

-- ------------------------------------------------------------
-- Mark an item as already in the kitchen. Stocks the pantry the
-- same way ticking it off would, but records it as a dismissal
-- rather than a purchase.
-- ------------------------------------------------------------

create or replace function have_already(item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  hid  uuid;
  ing  uuid;
  life integer;
begin
  select sl.household_id, li.ingredient_id
  into hid, ing
  from list_items li
  join shopping_lists sl on sl.id = li.list_id
  where li.id = item_id;

  if hid is null or not is_household_member(hid) then
    raise exception 'not your item';
  end if;

  update list_items
  set dismissed_at = now(), checked_at = null
  where id = item_id;

  if ing is not null then
    select shelf_life_days into life from ingredients where id = ing;

    insert into pantry_items (household_id, ingredient_id, in_stock,
                              added_at, expires_at, confidence)
    values (hid, ing, true, now(),
            case when life is not null then now() + (life || ' days')::interval end,
            'confirmed')
    on conflict (household_id, ingredient_id) do update
      set in_stock = true, confidence = 'confirmed';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- Set a pantry quantity directly. Zero means out of stock.
-- ------------------------------------------------------------

create or replace function set_pantry_qty(
  hid uuid,
  ing uuid,
  new_qty numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  du base_unit;
  life integer;
begin
  if not is_household_member(hid) then
    raise exception 'not a member of this household';
  end if;

  select default_unit, shelf_life_days into du, life
  from ingredients where id = ing;

  insert into pantry_items (household_id, ingredient_id, qty, unit,
                            in_stock, added_at, expires_at, confidence)
  values (hid, ing, nullif(new_qty, 0), du,
          coalesce(new_qty, 0) > 0, now(),
          case when life is not null then now() + (life || ' days')::interval end,
          'confirmed')
  on conflict (household_id, ingredient_id) do update
    set qty        = nullif(new_qty, 0),
        unit       = du,
        in_stock   = coalesce(new_qty, 0) > 0,
        confidence = 'confirmed';
end;
$$;

grant execute on function clear_list(uuid, boolean)         to authenticated;
grant execute on function have_already(uuid)                to authenticated;
grant execute on function set_pantry_qty(uuid, uuid, numeric) to authenticated;

notify pgrst, 'reload schema';
