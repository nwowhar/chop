-- ============================================================
-- Chop — 005_storage.sql
--
-- The recipe-images bucket and its policies.
--
-- Create the bucket in the dashboard first:
--   Storage -> New bucket -> name "recipe-images" -> PRIVATE
-- Then run this.
--
-- Paths are {household_id}/{filename}. The policies read the
-- first folder segment as the household id, so an upload
-- anywhere else is rejected.
-- ============================================================

create policy "household members read recipe images"
on storage.objects for select to authenticated
using (
  bucket_id = 'recipe-images'
  and is_household_member(((storage.foldername(name))[1])::uuid)
);

create policy "household members upload recipe images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'recipe-images'
  and is_household_member(((storage.foldername(name))[1])::uuid)
);

create policy "household members delete recipe images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'recipe-images'
  and is_household_member(((storage.foldername(name))[1])::uuid)
);

-- ------------------------------------------------------------
-- Screenshots have no value once parsed. Storage is the only
-- thing on the free tier you can realistically exhaust, so
-- clear them out.
--
-- Run manually, or from the keepalive workflow.
-- ------------------------------------------------------------

create or replace function purge_parsed_images(older_than_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
  p text;
begin
  for p in
    select unnest(image_paths)
    from import_jobs
    where status = 'saved'
      and created_at < now() - (older_than_days || ' days')::interval
  loop
    delete from storage.objects
    where bucket_id = 'recipe-images' and name = p;
    n := n + 1;
  end loop;
  return n;
end;
$$;
