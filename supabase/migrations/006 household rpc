-- ============================================================
-- Chop — 006_household_rpc.sql
--
-- Creating a household client-side fails RLS: the row must exist
-- before you can be a member of it, but the read policy requires
-- membership. Chicken and egg.
--
-- These do both in one transaction as SECURITY DEFINER.
-- ============================================================

create or replace function create_household(p_name text)
returns table (id uuid, name text, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'household needs a name';
  end if;

  insert into households (name) values (trim(p_name))
  returning households.id into new_id;

  insert into household_members (household_id, user_id, role)
  values (new_id, auth.uid(), 'owner');

  return query
    select h.id, h.name, h.invite_code
    from households h where h.id = new_id;
end;
$$;

create or replace function join_household(p_code text)
returns table (id uuid, name text, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  hh_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select h.id into hh_id
  from households h
  where lower(h.invite_code) = lower(trim(p_code));

  if hh_id is null then
    raise exception 'That code does not match a household';
  end if;

  insert into household_members (household_id, user_id, role)
  values (hh_id, auth.uid(), 'member')
  on conflict (household_id, user_id) do nothing;

  return query
    select h.id, h.name, h.invite_code
    from households h where h.id = hh_id;
end;
$$;

grant execute on function create_household(text) to authenticated;
grant execute on function join_household(text)   to authenticated;
