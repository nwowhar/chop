# Deploying parse-recipe

## 1. Storage bucket

Dashboard -> Storage -> New bucket
- Name: `recipe-images`
- Public: **off**

Then run `supabase/migrations/005_storage.sql` in the SQL editor.

## 2. Set the secret

Get a key at https://aistudio.google.com/apikey (free tier, no card).

```bash
supabase secrets set GEMINI_API_KEY=your_key_here
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
injected automatically — do not set them.

## 3. Deploy

```bash
supabase functions deploy parse-recipe
```

## 4. Test

Create a household and upload an image manually, then:

```sql
-- get your household id
select h.id from households h
join household_members m on m.household_id = h.id
where m.user_id = auth.uid();

-- after uploading to recipe-images/{household_id}/test.png
insert into import_jobs (household_id, created_by, image_paths)
values ('<household_id>', auth.uid(), array['<household_id>/test.png'])
returning id;
```

```bash
curl -X POST 'https://<ref>.supabase.co/functions/v1/parse-recipe' \
  -H "Authorization: Bearer <user_access_token>" \
  -H 'Content-Type: application/json' \
  -d '{"job_id":"<job_id>"}'
```

Watch logs with `supabase functions logs parse-recipe --tail`.

## Notes

- The user's JWT is required; the function checks household membership via RLS
  before doing anything expensive.
- Failures write `status='failed'` and the message to `import_jobs.error`.
- Multiple images in one job are treated as overlapping shots of ONE post and
  merged. Separate recipes need separate jobs.
