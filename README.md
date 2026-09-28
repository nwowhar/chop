# Chop!

Screenshot a recipe off Instagram, or just ask for one. Get a week plan, a
shopping list you can tick off in the aisle, and a pantry that keeps itself up
to date.

Two people, one shared database, runs free at personal scale.

## How it's organised

Four surfaces, one per moment — not one per database table.

| | |
|---|---|
| **Tonight** `/` | What am I cooking right now. Straight into cook mode. |
| **Week** `/week` | Plan the nights, and the shopping list falls out beneath it. |
| **Kitchen** `/kitchen` | What's in stock, what's going off, what you could cook from it. |
| **Library** `/library` | Everything saved, searchable, plus three weekly suggestions. |

Plus two full-screen modes with no chrome, because both happen with one hand
somewhere else:

- `/shop` — in-store checklist, aisle order, wake lock on
- `/cook/:id` — one step at a time, times and temps in amber

Adding a recipe is an action, not a destination: the **+** button opens one
sheet with four ways in — ask, screenshot, link, receipt.

## Stack

React + Vite on Vercel. Supabase for Postgres, auth, storage, realtime and
edge functions. Gemini Flash for the parsing. No CSS framework — the "Kappo"
tokens in `src/styles/theme.css` do the work.

## Layout

```
src/
  App.jsx               routing
  components/Nav.jsx    sidebar on desktop, bottom bar on a phone
  components/AddSheet.jsx
  lib/supabase.js       every database call
  lib/shrink.js         downsizes screenshots before upload
  screens/
  styles/theme.css      design tokens
  styles/app.css        layout
supabase/
  migrations/           001-013, run in order
  functions/            parse-recipe, suggest-recipes, parse-receipt
docs/                   architecture, parser prompt, deploy notes
fixtures/               four real screenshots + expected parser output
scripts/gen_seed.py     regenerates migration 003
```

## Core principle

Parse once, store forever. The model runs at import and never again —
planning, shopping, the pantry and cook mode are all deterministic SQL. Cost
scales with imports, not with use, and everything except importing works
offline.

## Setup

Migrations 001–013 in order. Storage bucket `recipe-images`, private. Auth →
Email on, Confirm email off. `GEMINI_API_KEY` as an edge function secret.
Deploy the three functions. Vercel wants `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`, framework preset Vite, all overrides off.

Free Supabase projects pause after 7 days idle — add a GitHub Action that
pings the project daily.

## Design rules

- One accent per screen. `.btn-primary` (charcoal) does the work;
  `.btn-accent` (persimmon) appears once.
- Every quantity gets `.num`. Tabular figures, or a 30-item list stops scanning.
- The slash behind the wordmark appears once per screen, on the logo only.
- Green carries state. It is never a call to action.
