# Chop!

Screenshot a recipe off Instagram. Get a shopping list, a week's meal plan, and
something you can follow in the kitchen.

Two-person household, shared database, runs free at personal scale.

## Stack

React + Vite on Vercel. Supabase for Postgres, auth, storage, realtime and the
edge function. Gemini for parsing screenshots. No CSS framework — styling is
the theme tokens in `src/styles/`.

## Layout

```
index.html            Vite entry
package.json          vite is a regular dependency, not a devDependency,
                      because Vercel builds with NODE_ENV=production
src/
  App.jsx             routing
  main.jsx            entry
  components/Nav.jsx
  lib/supabase.js     every database call lives here
  screens/            Login, Onboarding, Import, Recipes, Recipe,
                      Plan, Shopping, Pantry
  styles/theme.css    "Kappo" design tokens
  styles/app.css      layout
supabase/
  migrations/         001-006, run in order
  functions/parse-recipe/index.ts
docs/                 architecture, parser prompt, deploy notes
fixtures/             four real screenshots + expected parser output
scripts/gen_seed.py   regenerates migration 003
```

## Setup

**Supabase** — run migrations 001 through 006 in order in the SQL editor. Then:

- Storage → new bucket `recipe-images`, private
- Authentication → Providers → Email on, **Confirm email off**
- Edge Functions → Secrets → `GEMINI_API_KEY`
- Deploy `parse-recipe` (paste `supabase/functions/parse-recipe/index.ts`)

**Vercel** — import the repo, framework preset Vite, leave build settings on
defaults. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

**Keepalive** — free Supabase projects pause after 7 days idle. Add a GitHub
Action that pings the project daily.

## Verify

```sql
select count(*) from ingredients;              -- 217
select * from match_ingredient('chicken thighs');
select display_qty(1450, 'g');                 -- 1.5 kg
```

## Design rules

- One accent per screen. `.btn-primary` (charcoal) does most of the work;
  `.btn-accent` (persimmon) appears at most once.
- Every quantity gets `.num`. Tabular figures or a 30-item list stops scanning.
- The slash behind the wordmark appears once per screen, on the logo only.
- Green carries state and section labels. It is never a call to action.

## Not built yet

Kitchen mode, receipt import, macros and the dietary filters. See the phase
list in `docs/ARCHITECTURE.md`.
