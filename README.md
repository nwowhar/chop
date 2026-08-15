# Chop

Screenshot a recipe off Instagram. Get a shopping list, a week's meal plan, and
something you can follow in the kitchen.

Two-person household, shared database, runs free at personal scale.

---

## What's here

```
docs/
  ARCHITECTURE.md          full build spec — read this first
  parser-prompt.md         the vision + reconstruction prompts
supabase/migrations/
  001_initial_schema.sql   tables, RLS, triggers, core functions
  002_settings.sql         yield conversion, settings, rewired list builder
  003_seed_ingredients.sql 217 canonical ingredients
fixtures/
  expected.json            hand-checked parser output for the four images
  images/                  the four real screenshots
scripts/
  gen_seed.py              regenerates 003 — edit this, not the SQL
src/styles/
  theme.css                the "Mise" theme
```

Nothing here is application code yet. This is the spec, the database and the
design system.

---

## Setup

**1. Supabase**

Create two projects: `chop-dev` and `chop-prod`. Run the migrations in order —
002 must come before 003, because it adds columns that 003 populates.

```bash
supabase link --project-ref <ref>
supabase db push
```

Or paste each file into the SQL editor in order.

**2. Stop the free tier pausing**

Free projects pause after 7 days idle. Add `.github/workflows/keepalive.yml`:

```yaml
name: keepalive
on:
  schedule: [{ cron: '0 3 * * *' }]
  workflow_dispatch:
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -sS "$SUPABASE_URL/rest/v1/ingredients?select=id&limit=1" \
            -H "apikey: $SUPABASE_ANON_KEY" -o /dev/null -w '%{http_code}\n'
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
```

**3. Verify the seed**

```sql
select * from match_ingredient('tumeric');
```

Should return turmeric with a high score. If a misspelling doesn't resolve, the
trigram threshold needs loosening before anything downstream will work.

More checks are commented at the bottom of `003_seed_ingredients.sql`.

---

## Still to build

- Storage bucket for screenshots, plus its RLS policies (not in the migrations)
- Two edge functions: vision parse, step reconstruction
- Unit resolution wiring in the parse pipeline (`to_base()` exists, nothing calls it)
- Nine screens — see the phase list in `docs/ARCHITECTURE.md`

Offline sync for the shopping list is the only genuinely hard piece. Everything
else is mechanical.

---

## Working on the ingredient table

Edit `scripts/gen_seed.py` and re-run it. It validates column counts and catches
duplicate aliases across ingredients, which hand-editing the SQL will not.

```bash
python3 scripts/gen_seed.py
```

---

## Testing the parser

Feed `fixtures/images/` through the prompt in `docs/parser-prompt.md` and diff
against `fixtures/expected.json`. The `must_pass` list in that file is the bar.

The three cases each break differently: truncated steps, a missing title with
six spices crammed onto one line, and two overlapping screenshots of one post
that have to be merged rather than concatenated.

---

## Design rules

From `theme.css`, worth not violating:

- One accent element per screen — the next action. Slate carries state.
- Every quantity gets `.num`. Tabular figures or a 30-item list stops being readable.
- `.cut` dividers mark real content boundaries only, not decoration.
