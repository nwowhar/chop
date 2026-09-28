-- ============================================================
-- Chop — 013_prices_and_autoplan.sql
--
-- 1. Estimated prices per ingredient, plus real prices learned
--    from your own receipts. Your prices always win.
-- 2. Auto meal plan for the week.
-- ============================================================

alter table ingredients
  add column if not exists est_price       numeric,   -- $ for one pack_size
  add column if not exists price_updated_at timestamptz;

comment on column ingredients.est_price is
  'Rough $AU for one pack_size. A starting point — receipts override it.';

-- ------------------------------------------------------------
-- What you actually paid. Household-scoped, because prices vary
-- by store and this is worth more than any national average.
-- ------------------------------------------------------------

create table if not exists price_observations (
  id            uuid primary key default uuid_generate_v4(),
  household_id  uuid not null references households(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  price         numeric not null,
  qty           numeric,
  unit          base_unit,
  store         text,
  observed_at   timestamptz not null default now(),
  source        text default 'receipt'
);

create index if not exists price_obs_lookup
  on price_observations (household_id, ingredient_id, observed_at desc);

alter table price_observations enable row level security;

create policy prices_all on price_observations
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

-- ------------------------------------------------------------
-- Your last three prices, median, falling back to the estimate.
-- Median rather than latest so one special doesn't skew it.
-- ------------------------------------------------------------

create or replace function effective_price(hid uuid, ing uuid)
returns numeric
language sql
stable
as $$
  select coalesce(
    (select percentile_cont(0.5) within group (order by price)
     from (select price from price_observations
           where household_id = hid and ingredient_id = ing
           order by observed_at desc limit 3) recent),
    (select est_price from ingredients where id = ing)
  );
$$;

alter table list_items add column if not exists est_cost numeric;

-- ------------------------------------------------------------
-- Cost a whole list.
-- ------------------------------------------------------------

create or replace function list_total(lid uuid)
returns table (known numeric, unpriced integer)
language sql
stable
as $$
  with sl as (select household_id from shopping_lists where id = lid),
  priced as (
    select li.qty_to_buy,
           i.pack_size,
           effective_price((select household_id from sl), li.ingredient_id) as unit_price
    from list_items li
    join ingredients i on i.id = li.ingredient_id
    where li.list_id = lid
      and li.checked_at is null
      and li.dismissed_at is null
  )
  select coalesce(sum(
           case when unit_price is null then 0
                when pack_size is null or pack_size = 0 then unit_price
                else unit_price * greatest(ceil(qty_to_buy / pack_size), 1)
           end), 0)::numeric,
         count(*) filter (where unit_price is null)::integer
  from priced;
$$;

-- ------------------------------------------------------------
-- Auto meal plan.
--
-- Fills empty nights. Prefers recipes that use up what's about
-- to go off, then ones needing little shopping, then ones you
-- haven't cooked lately. Never repeats within the week.
-- ------------------------------------------------------------

create or replace function auto_plan(
  hid    uuid,
  wk     date,
  nights integer default 5,
  theme  text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  d date;
  picked uuid;
  n integer := 0;
begin
  if not is_household_member(hid) then
    raise exception 'not a member of this household';
  end if;

  for d in
    select generate_series(wk, wk + 6, '1 day')::date
  loop
    exit when n >= nights;

    -- skip nights that already have something
    if exists (select 1 from meal_plan mp
               where mp.household_id = hid and mp.date = d) then
      continue;
    end if;

    select r.id into picked
    from recipes r
    left join lateral (
      select
        count(*) filter (
          where p.ingredient_id is null and not i.is_staple
        ) as missing,
        count(*) filter (
          where p.expires_at is not null
            and p.expires_at < now() + interval '5 days'
        ) as uses_expiring
      from recipe_ingredients ri
      join ingredients i on i.id = ri.ingredient_id
      left join pantry_items p
             on p.ingredient_id = ri.ingredient_id
            and p.household_id = hid
            and p.in_stock
      where ri.recipe_id = r.id
    ) stock on true
    left join lateral (
      select max(mp.date) as last_cooked
      from meal_plan mp
      where mp.recipe_id = r.id and mp.household_id = hid
        and mp.cooked_at is not null
    ) hist on true
    where r.household_id = hid
      -- not already on this week's board
      and not exists (
        select 1 from meal_plan mp
        where mp.household_id = hid
          and mp.recipe_id = r.id
          and mp.date between wk and wk + 6
      )
      and (theme is null or theme = '' 
           or r.tags @> array[theme]
           or recipe_matches_theme(r.macros_per_serve, theme))
    order by
      (stock.uses_expiring * 3)
      - (stock.missing * 1.0)
      + coalesce(extract(day from (current_date - hist.last_cooked)), 60) / 30.0
      desc,
      random()
    limit 1;

    exit when picked is null;

    insert into meal_plan (household_id, date, slot, recipe_id)
    values (hid, d, 'dinner', picked);

    n := n + 1;
    picked := null;
  end loop;

  return n;
end;
$$;

grant execute on function auto_plan(uuid, date, integer, text) to authenticated;
grant execute on function effective_price(uuid, uuid)          to authenticated;
grant execute on function list_total(uuid)                     to authenticated;

-- ------------------------------------------------------------
-- Starting price estimates, $AU per pack_size, mid-2026.
-- Deliberately rough. Receipts will correct them.
-- ------------------------------------------------------------

update ingredients set est_price = v.p, price_updated_at = now()
from (values
  ('brown onion',2.50),('red onion',3.00),('spring onion',2.50),('garlic',1.20),
  ('ginger',2.00),('lemon',1.20),('lime',1.00),('carrot',2.50),('celery',3.50),
  ('potato',6.00),('sweet potato',4.50),('tomato',6.00),('cherry tomatoes',4.00),
  ('cucumber',2.00),('capsicum',2.50),('red chilli',2.00),('broccoli',4.00),
  ('cauliflower',5.00),('zucchini',4.00),('eggplant',3.50),('mushrooms',5.50),
  ('baby spinach',3.50),('lettuce',3.50),('cabbage',4.50),('bok choy',2.50),
  ('coriander',3.00),('parsley',3.00),('basil',3.50),('mint',3.00),('dill',3.50),
  ('thyme',3.50),('rosemary',3.50),('avocado',2.50),('apple',5.00),('banana',4.00),
  ('orange',1.20),('pumpkin',4.00),('green beans',4.00),('snow peas',4.50),
  ('corn',1.50),('leek',3.50),('shallot',4.00),('kale',4.00),('asparagus',5.00),
  ('beetroot',4.00),('radish',3.00),('fennel',4.50),('lemongrass',2.00),
  ('chicken thighs',12.00),('chicken breast',13.00),('chicken drumsticks',8.00),
  ('whole chicken',12.00),('chicken mince',8.00),('pork mince',8.50),
  ('beef mince',10.00),('lamb mince',12.00),('pork belly',18.00),
  ('pork shoulder',14.00),('beef steak',15.00),('beef chuck',16.00),
  ('lamb shoulder',20.00),('lamb chops',14.00),('bacon',8.00),('chorizo',6.00),
  ('sausages',8.00),('ham',6.00),('prosciutto',7.00),
  ('salmon fillet',15.00),('barramundi',14.00),('white fish fillet',12.00),
  ('prawns',18.00),('tinned tuna',2.00),('tinned salmon',4.50),('anchovies',3.50),
  ('squid',12.00),('mussels',10.00),('fish sauce',4.00),
  ('milk',3.20),('thickened cream',3.00),('sour cream',3.50),('butter',6.50),
  ('greek yoghurt',6.00),('cheddar cheese',9.00),('parmesan',8.00),
  ('mozzarella',5.00),('feta',5.50),('halloumi',7.00),('ricotta',4.50),
  ('cream cheese',5.00),('eggs',6.50),('coconut milk',2.20),('coconut cream',2.50),
  ('bread',4.50),('naan bread',4.00),('pita bread',3.50),('tortillas',4.50),
  ('burger buns',4.00),('breadcrumbs',3.00),('dumpling wrappers',4.00),
  ('puff pastry',6.00),
  ('olive oil',12.00),('vegetable oil',6.00),('avocado oil',12.00),
  ('sesame oil',5.00),('coconut oil',8.00),('soy sauce',4.00),('oyster sauce',4.50),
  ('hoisin sauce',4.00),('chilli crisp',8.00),('sriracha',5.00),
  ('worcestershire sauce',4.50),('rice vinegar',3.50),('white vinegar',2.50),
  ('balsamic vinegar',5.00),('apple cider vinegar',4.50),('dijon mustard',4.50),
  ('wholegrain mustard',4.50),('tomato paste',1.50),('chopped tomatoes',1.50),
  ('passata',2.50),('tomato sauce',4.00),('mayonnaise',5.50),('chicken stock',3.00),
  ('beef stock',3.00),('vegetable stock',3.00),('plain flour',2.50),
  ('self raising flour',2.80),('cornflour',2.50),('caster sugar',2.50),
  ('brown sugar',2.50),('honey',9.00),('maple syrup',9.00),('rice',4.00),
  ('arborio rice',5.00),('pasta',2.50),('egg noodles',3.50),('rice noodles',3.50),
  ('couscous',3.50),('quinoa',6.00),('rolled oats',3.00),('red lentils',3.50),
  ('chickpeas',1.50),('black beans',1.80),('kidney beans',1.60),
  ('cannellini beans',1.60),('peanut butter',5.50),('tahini',6.00),
  ('cashews',6.00),('almonds',5.50),('peanuts',3.50),('sesame seeds',3.00),
  ('baking powder',2.50),('bicarb soda',2.00),('vanilla extract',6.00),
  ('cocoa powder',5.00),('dark chocolate',4.50),('gochujang',7.00),
  ('miso paste',6.00),('curry paste',4.00),('ginger garlic paste',4.00),
  ('mirin',5.00),('shaoxing wine',5.00),('olives',4.50),('capers',3.50),
  ('gherkins',4.00),('sundried tomatoes',5.00),
  ('salt',2.00),('black pepper',4.00),('cumin',3.00),('ground coriander',3.00),
  ('turmeric',3.00),('paprika',3.00),('smoked paprika',3.50),('cayenne pepper',3.00),
  ('chilli powder',3.00),('garam masala',3.50),('curry powder',3.00),
  ('fenugreek',3.50),('cinnamon',3.00),('nutmeg',4.00),('cardamom',6.00),
  ('cloves',4.00),('bay leaves',3.00),('dried oregano',3.00),('mixed herbs',3.00),
  ('garlic powder',3.00),('chinese five spice',3.50),('sumac',4.00),
  ('frozen peas',3.00),('frozen corn',3.00),('frozen spinach',3.00),
  ('frozen berries',6.00),('frozen chips',5.00),
  ('white wine',12.00),('red wine',12.00)
) as v(name, p)
where ingredients.canonical_name = v.name;

notify pgrst, 'reload schema';

-- Triage marks an item as reviewed without changing its state.
alter table list_items add column if not exists triaged_at timestamptz;
notify pgrst, 'reload schema';
