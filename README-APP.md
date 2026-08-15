# Chop — app

Vite + React. No Tailwind, no CSS framework — styling is `src/styles/theme.css`
(the Mise tokens) plus `src/styles/app.css` (layout).

## Adding this to the repo

These files go in the repo ROOT, alongside the existing `supabase/` and `docs/`
folders. `src/styles/theme.css` is already there — this zip has the same file,
so overwriting is fine.

Result:

```
chop/
  index.html          <- new
  package.json        <- new
  vite.config.js      <- new
  vercel.json         <- new
  src/                <- new (except styles/theme.css, already there)
  supabase/
  docs/
  fixtures/
  scripts/
```

## Vercel

Import the repo. Framework preset: Vite. Then add two environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Both from Supabase → Settings → API. Apply to all environments.

## Supabase auth setup

Authentication → URL Configuration:
- Site URL: your Vercel URL
- Redirect URLs: add the Vercel URL and `http://localhost:5173`

Authentication → Providers → Email: enabled, with magic link on.

## What works

Sign in by email link → create or join a household → upload screenshots →
parse → browse recipes → view a recipe with scaling.

## What doesn't exist yet

Kitchen mode, week planner, shopping list, pantry, cook-from-stock. Phases 2–4b
in `docs/ARCHITECTURE.md`.
