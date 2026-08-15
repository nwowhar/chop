# Chop — Build Architecture

**Status:** design locked, pre-build
**Primary users:** two-person household, shared data
**Priority features:** stock tracking → shopping list → meal plan → kitchen mode
**Constraint:** must run free at personal scale; monetisable later without a rewrite
**Theme:** Mise — see `theme.css`

---

## 1. The problem

Recipes get saved on Instagram and never cooked, because the gap between "that looks good" and "I have the ingredients on a Tuesday night" is full of manual work: retyping ingredients, converting US units, guessing what's already in the cupboard, building a shopping list, and remembering what's been used.

The app closes that gap. It does **not** try to be a recipe website.

---

## 2. Core architectural principle

> **The LLM runs once per recipe, at import. Never again.**

Screenshot → structured JSON → stored forever. Every downstream feature — meal planning, shopping list generation, unit conversion, macro filtering, pantry maths — is deterministic code over that stored JSON.

Consequences:

- Cost scales with **imports**, not usage. ~10–30 LLM calls/month for a household.
- Everything except import works **offline**.
- The same input always produces the same shopping list.
- Recipe corpus is only ever what the household imported (~100–300 items). Trivially small.

---

## 3. Users and household model

Multi-tenancy is built in from day one — retrofitting it is painful, adding it upfront is one table.

**Rule: nothing is scoped to `user_id`. Everything is scoped to `household_id`.**

```
households        (id, name, created_at)
household_members (household_id, user_id, role, joined_at)
```

All RLS policies check membership in `household_members`, not row ownership.

Joining a household: invite code or magic link. No org chart, no permissions matrix — `role` exists only so a future paid tier can distinguish owner from member.

### Realtime

Supabase Realtime subscription on `list_items` scoped to the household. When one person ticks an item at the shops it vanishes from the other's phone immediately. Last-write-wins is acceptable; there is no meaningful conflict case.

Track `checked_by` as well as `checked_at`.

---

## 4. Data model

### Canonical ingredients (the backbone)

This table is the single most important asset in the system. Everything — pantry matching, list aggregation, dietary flags, macros — depends on resolving free text to a canonical ID.

```sql
ingredients (
  id                 uuid pk,
  canonical_name     text unique,       -- 'brown onion'
  aliases            text[],            -- ['onion','yellow onion','brown onions']
  category           text,              -- produce | dairy | meat | pantry | spice | frozen
  default_unit       text,              -- g | ml | each
  g_per_ml           numeric,           -- density, for volume→weight
  g_per_each         numeric,           -- 'one onion' → grams
  is_staple          boolean,           -- boolean stock tracking, not quantity
  shelf_life_days    integer,           -- perishable decay
  -- purchasing
  purchase_unit      text,              -- how it's sold
  pack_size          numeric,           -- 500 (g), 400 (g can)
  -- dietary
  is_meat            boolean,
  is_fish            boolean,
  is_dairy           boolean,
  is_gluten          boolean,
  -- macros per 100g (AFCD-sourced, LLM-estimated fallback)
  protein_g_per_100  numeric,
  carb_g_per_100     numeric,
  fat_g_per_100      numeric,
  fibre_g_per_100    numeric,
  macro_source       text               -- 'afcd' | 'estimated' | 'manual'
)
```

Seeded from the **Australian Food Composition Database** (FSANZ, free download) — local products, local pack sizes. Grows organically: unmatched ingredients from imports go to a review queue and get promoted.

This table is global, not per-household. It is also the moat if this ever becomes a product.

### Recipes

```sql
recipes (
  id, household_id, title, servings,
  source_type,          -- 'instagram' | 'manual' | 'url'
  source_handle,        -- '@thecontrarianmoney'
  image_path,           -- optional thumbnail
  steps_origin,         -- 'extracted' | 'generated' | 'partial'
  scales_well           boolean default true,   -- manual flag
  macros_per_serve      jsonb,                  -- cached
  tags                  text[],
  created_at
)

recipe_sections (
  id, recipe_id, name, sort_order   -- 'Marinade', 'Sauce', 'Garlic butter naan'
)

recipe_ingredients (
  id, recipe_id, section_id, ingredient_id,
  raw_text,             -- '1½ tsp sesame oil' — always preserved
  qty numeric,          -- null allowed
  unit text,            -- normalised to g/ml/each
  optional boolean,
  is_topping boolean,   -- garnishes, 'to serve'
  match_confidence numeric
)

recipe_steps (
  id, recipe_id, step_no, text, timer_seconds
)
```

`raw_text` is never discarded. When the canonical match is wrong, the original line is the ground truth for fixing it.

`section_id` matters — see §7 on cross-section aggregation.

### Pantry

```sql
pantry_items (
  household_id, ingredient_id,
  qty numeric,          -- null for staples
  unit text,
  in_stock boolean,     -- the only field that matters for staples
  added_at, expires_at,
  confidence            -- 'confirmed' | 'assumed' | 'stale'
)
```

### Planning and lists

```sql
meal_plan (
  household_id, date, meal_slot, recipe_id,
  servings,             -- may differ from recipe default
  cooked_at             -- null until marked cooked; this triggers depletion
)

shopping_lists (id, household_id, week_of, status)

list_items (
  list_id, ingredient_id,
  qty_needed, qty_to_buy, unit,
  source_recipe_ids uuid[],   -- why is this on the list?
  is_check_only boolean,      -- 'do you have chilli crisp?' vs '500g pork'
  checked_at, checked_by,
  manual boolean              -- added by hand, not from a recipe
)
```

`source_recipe_ids` answers the aisle question "why do I need buttermilk?".

---

## 5. Import pipeline

### Capture

Multi-select upload from camera roll inside the PWA. Real usage pattern is **bulk import sessions** (save posts all week, import six at once on Sunday), not one-at-a-time capture. A share-sheet target optimises the wrong workflow.

Optional later: iOS Shortcut posting to the same endpoint. Not a second platform, just another door into the same API.

### Parse

**Pass 1 — vision (per image batch):**

Input: 1–n images belonging to one recipe.
Output: `{ title, servings, sections[], ingredients[], steps[], source_handle }`

**Pass 2 — text only, conditional:**

Fires when `steps` is empty or truncated. Input is title + full ingredient list. Generates steps consistent with the extracted quantities. Marked `steps_origin: 'generated'` and badged in the UI.

Never web-search for steps — a found recipe has different quantities and will contradict the shopping list.

**Pass 3 — canonical matching (code, not LLM):**

Each extracted ingredient → embedding + trigram fuzzy match against `ingredients.canonical_name` and `aliases`. Below a confidence threshold, queue for review.

### Known failure modes (observed in real screenshots)

| Problem | Handling |
|---|---|
| Multiple overlapping screenshots of one post | Fuzzy-match ingredient lines across the batch, merge and dedupe. Do not concatenate. |
| iOS header bar obscures top lines | Overlapping shots are the fix — previous image covers what the next one hides. |
| No title (scrolled past the top) | Infer from ingredients; prompt user to confirm on the review screen. |
| Multiple ingredients on one line | Extraction must be semantic, not line-based. |
| Brand tags mid-list (`@elmlea_ukie`) | Strip handles and hashtags. |
| Misspellings ('tumeric') | Fuzzy matcher tolerance. |
| Instructions truncated | Pass 2. |
| No quantity given (garnishes, 'avocado oil') | `qty: null`, `is_topping: true`, becomes a check-only list item. |
| Video-only, no caption | Manual entry. Do not engineer around this. |

### Review screen

A 5-second confirmation before save — parsed title, sections, ingredients with any low-confidence matches highlighted. Not a nag; a cheap correction path. Silent errors here become wrong quantities at the shops.

---

## 6. Units and metric conversion

Deterministic code. Never the LLM — a lookup table gives the same answer every time.

**Convert to grams and millilitres. Never to Australian spoon units.**

An Australian tablespoon is 20 ml; a US tablespoon is 15 ml. Converting "2 tbsp" to "2 tbsp" is a 33% error at the bench.

| From | To |
|---|---|
| 1 lb | 450 g |
| 1 US cup (liquid) | 240 ml |
| 1 US tbsp | 15 ml |
| 1 US tsp | 5 ml |
| 425 °F | 220 °C |
| 1 can chopped tomatoes | 400 g (AU standard) |

Cups of solids are not volume — resolve via `g_per_ml` or `g_per_each` per ingredient. `¼ cup parsley` ≈ 15 g, `⅓ cup Greek yogurt` ≈ 80 g.

**Recipe quantity ≠ purchase quantity.** Recipe needs 450 g pork; list says 500 g because that's the pack. Rounding up happens at list generation using `pack_size`.

---

## 7. Stock tracking (priority feature)

This is where apps in this category usually die, because they demand manual inventory entry with no immediate payoff. The design brief is therefore: **the user must never do data entry that exists only to feed the pantry.**

### Two tiers of item

**Staples** (`is_staple = true`) — flour, soy sauce, oil, spices. Boolean `in_stock` only. No quantities, ever. Periodically re-confirmed ("still got fish sauce?") rather than tracked.

**Perishables and one-offs** — quantity tracked, `expires_at` set from `shelf_life_days`.

### Stock in, stock out — both are side effects

| Event | Effect |
|---|---|
| Tick item off shopping list | Adds to pantry, `confidence: 'confirmed'` |
| Mark meal cooked (`cooked_at`) | Depletes recipe quantities from pantry |
| `expires_at` passes | `confidence: 'stale'`, greys out, prompts on next list build |
| Manual adjust | Always available, never required |

There is no "add to pantry" chore. Buying and cooking are the two events, and both already exist in the workflow.

### Receipt import (high leverage — same pipeline)

Photograph or forward the Coles/Woolworths receipt → the vision pipeline already built for recipes parses line items → matches against canonical ingredients → stocks the pantry in one action.

This is the strongest possible answer to "keeping track of what I have", and it reuses infrastructure that exists for import. Worth building early given stock tracking is a priority feature.

Caveat: receipt line items are abbreviated and brand-heavy (`WW BROWN ONION 1KG`). Needs its own alias set on the canonical table, which will build up quickly over a few shops.

### The non-negotiable rule

**The pantry is advisory, never a gate.** All it does is pre-tick items on the shopping list and rank recipes. If it's wrong, the cost is one tap. Nothing in the app is ever blocked by pantry state being inaccurate.

---

## 8. Shopping list generation

Pure aggregation. No AI.

```
1. Collect recipe_ingredients for all meal_plan entries in the target week
2. Scale each by (planned servings / recipe servings)
3. Convert all to base units (g / ml / each)
4. Group by ingredient_id, summing ACROSS SECTIONS
5. Subtract pantry qty where in_stock / qty > 0
6. Round up to pack_size → qty_to_buy
7. Items with qty null → is_check_only = true
8. Sort by ingredient.category (aisle order)
```

**Step 4 matters.** A single recipe can list butter in three sections (marinade, sauce, naan). The recipe view must keep sections separate — you add them at different times. The shopping view must flatten and sum them — you buy butter once.

Aisle ordering by category is a small feature with disproportionate real-world value.

Manual items (`manual: true`) can be added directly to the list without a recipe — milk, bin bags, whatever.

---

## 9. Meal planning and suggestions

### Assignment, not generation

A week's plan is picking from the household's own imported recipes and assigning dates. No LLM involved.

### Filters — computed, not tagged

Dietary flags aggregate from `ingredients` booleans. This catches what manual tagging misses: a dumpling recipe containing **oyster sauce and chicken broth** is not vegetarian, and no human tagging it by eye will notice.

Macro filters aggregate from per-100g values × quantity ÷ servings.

| Preset | Query |
|---|---|
| Vegetarian | no `is_meat`, no `is_fish`, and no hidden animal derivatives |
| Protein / recovery | `protein_g_per_serve >= 30` |
| Pre-training (footy, triathlon) | `carb >= 60g` AND `fat <= 15g` AND `fibre` low |
| Feeding a group | `scales_well = true`, sorted by cost per serve |
| Quick | total `timer_seconds` under threshold |

Note pre-training is **not** simply "high carb" — low fat and low fibre matter more for gut comfort than raw carb count. Encode all three.

### Cook from stock

The user selects which pantry items they want to build around — not "use everything I have", but "I've got these chicken thighs and this cream to use up, what can I make". Selection is the point: the user drives it.

**Interaction**

1. Pantry screen, multi-select rows.
2. Items within `expiry_soon_days` of `expires_at` are pre-selected by default. This is where expiry tracking finally pays for itself.
3. Optional filters layered on: any of the meal-type presets above.
4. Results ranked, each showing which selected items it uses and what's missing.
5. Missing items get one-tap "add to shopping list", writing straight into `list_items` with `source_recipe_ids`.

**Ranking**

Naive match-counting surfaces the wrong recipes. Missing chilli crisp and missing salt are not the same problem — one is a shopping trip, the other is dinner tonight.

```
score =  (selected ingredients used   × 3)
       + (expiring-soon items used    × 2)
       - (missing non-staples         × 2)
       - (missing staples             × 0.5)
```

Staple weighting via `ingredients.is_staple` is what makes results feel intelligent. Recipes with zero missing non-staples get a "make tonight" flag.

All of it is SQL over `recipe_ingredients` joined to `pantry_items`. No LLM, works offline, costs nothing.

### Recipes must be real

Generated-from-scratch recipes are explicitly **out**. The imported corpus comes from people who cooked the dish, photographed it, and got public feedback on it. A generated recipe is a plausible guess whose timings drift, and it's the feature this app category leads with and users abandon.

When the corpus feels thin, the answer is to import more through the existing pipeline — not to invent.

### External recipe sources — licensing constraint

Spoonacular's `findByIngredients` endpoint does exactly this feature (`ranking=1` maximises used ingredients, `ranking=2` minimises missing, `ignorePantry` skips water/salt/flour). Free tier is ~150 requests/day.

**It cannot be used as a stored corpus.** Their terms permit caching user-requested data for a maximum of one hour, after which it must be deleted and refreshed; ceasing use requires deleting everything ever obtained. That is incompatible with parse-once-store-forever, and it breaks meal planning, offline access, and the shopping list — all of which need permanent local rows.

Acceptable uses:

- **Discovery only** — browse there, then import the source recipe through Chop's own pipeline so the stored copy is first-party.
- **TheMealDB** — small but openly licensed, safe to store.

Decision: build cook-from-stock against the household's own corpus. Revisit external sources only if the corpus proves too thin after a bulk import session, and never store third-party API data as permanent rows.

### `scales_well`

Manual flag. Some recipes don't scale — dumplings need frying in batches, so 10 servings is four times the pan time, not one big pan. No ingredient maths detects this.

---

## 10. Kitchen mode

- Wake Lock API (Safari 16.4+) — screen stays on
- Large type, one step at a time, thumb-sized targets
- Inline timers from `timer_seconds`
- Ingredient quantities scale live with the serving selector
- `steps_origin: 'generated'` shows a **reconstructed** badge — you want to know whether you're following the creator's method or a plausible substitute
- Fully offline from IndexedDB cache

Step text can embed ingredient tokens (`add the {{rice}}`) so scaled quantities substitute at render time rather than going stale.

---

## 11. Stack and cost

| Layer | Choice | Free tier |
|---|---|---|
| DB / auth / storage / realtime | Supabase | 500 MB DB, 1 GB storage, 5 GB egress, 2M realtime msgs |
| Hosting | Vercel Hobby | Free, non-commercial |
| Frontend | React + Vite, PWA | — |
| Offline | IndexedDB (Dexie) | — |
| Vision + generation | Gemini Flash via edge function | ~15 RPM, ~1500 RPD |

API keys live in Supabase Edge Functions. Never in the client.

**Storage discipline:** delete source screenshots after parsing, or keep one downscaled thumbnail. A 2 MB PNG per recipe is the only thing that could threaten the quota, and it has no value post-extraction.

### The gotcha

Free Supabase projects **pause after 7 days of inactivity**. With an 8-on/6-off roster this will trigger regularly. Fix: a GitHub Actions cron pinging the project daily. Fifteen lines, free, set once.

### If it ever monetises

- Vercel Hobby is non-commercial → Pro
- Supabase Pro removes the pause
- LLM cost is per-import, which maps cleanly to a credit model
- Household sharing is the natural paid feature

Not a v1 concern. Noted so nothing gets built in a way that blocks it.

---

## 12. Build phases

**Phase 1 — capture and store**
Auth, households, multi-image upload, vision parse, review screen, canonical ingredient table seeded, recipe list and detail view.

**Phase 2 — the units and the kitchen**
Metric conversion, serving scaler, kitchen mode with wake lock and timers, offline cache.

**Phase 3 — the list** *(first priority feature)*
Weekly plan assignment, shopping list generation with cross-section aggregation and pack rounding, realtime tick-off, aisle sorting.

**Phase 4a — stock** *(second priority feature)*
Pantry from list tick-off, depletion on cooked, staple booleans, expiry decay.

**Phase 4b — cook from stock**
Pantry multi-select, weighted ranking, expiring-items pre-selection, "make tonight" flag, add-missing-to-list. Depends on 4a and on `is_staple` being populated.

**Phase 5 — receipts**
Receipt photo → line item parse → pantry stocking. Receipt alias set on canonical ingredients.

**Phase 6 — nutrition**
AFCD load, macro computation, dietary flags, filter presets.

Phases 3 and 4 are the stated priorities, but 1 and 2 are hard prerequisites — a shopping list needs correctly parsed, correctly converted ingredients to aggregate.

---

## 13. Open risks

1. **Canonical matching quality** is the single biggest determinant of whether this works. Bad matching means the pantry never lines up and the shopping list double-buys. Budget real time for the review queue early.
2. **Cold start on filters.** With 10 recipes imported, "vegetarian AND high protein" may return nothing. Needs a bulk import session up front, not organic growth.
3. **Pantry drift** is inevitable. Design assumes it. Anything that breaks when the pantry is wrong is a design error.
4. **Recipe content is private to the household.** Ingredient lists and functional steps aren't copyrightable; the creator's prose and photos are. Personal storage is fine. A public recipe feed is a different legal question entirely.
5. **Scaling generated steps** — regenerate or tokenise, don't let "add the 300g of rice" go stale.
6. **Third-party recipe data cannot be stored.** Spoonacular and similar APIs cap caching at an hour and require deletion on ceasing use. Any external source must be discovery-only, or openly licensed. Storing API recipes as permanent rows forecloses monetisation.
7. **`is_staple` coverage drives cook-from-stock quality.** If staples aren't flagged correctly the ranking penalises recipes for missing salt, and results feel stupid. Audit the flag across the seeded ingredient table before shipping phase 4b.
