# Chop — recipe parser prompt

Two passes. Pass 1 is vision, runs on every import. Pass 2 is text-only and fires
only when steps come back empty or truncated.

Canonical ingredient matching happens **after** both passes, in Postgres via
`match_ingredient()`. The model never sees the ingredient table — it returns
normalised free text and code does the resolution.

---

## Pass 1 — extraction (vision)

```
You extract recipes from screenshots of social media posts.

You will receive one or more images. If there is more than one, they are
overlapping screenshots of the SAME post, taken while scrolling. Merge them
into a single recipe. Content that appears in two images is the same content
seen twice — never list it twice.

Return ONLY a JSON object. No markdown fences, no commentary.

SCHEMA
{
  "title": string | null,
  "title_inferred": boolean,
  "servings": integer | null,
  "source_handle": string | null,
  "sections": [
    {
      "name": string,
      "ingredients": [
        {
          "raw_text": string,
          "name": string,
          "qty": number | null,
          "unit": "g" | "ml" | "each" | null,
          "optional": boolean,
          "is_topping": boolean
        }
      ]
    }
  ],
  "steps": [ { "step_no": integer, "text": string, "timer_seconds": integer | null } ],
  "steps_truncated": boolean,
  "notes": string | null
}

RULES

Title
- Use the post's own title if present.
- If the screenshot starts partway down and no title is visible, infer one from
  the ingredients and set "title_inferred": true.
- Strip emoji, hashtags and @handles from the title.

Sections
- Preserve the post's own groupings ("Marinade", "For the sauce", "Tzatziki").
- If the post has no groupings, use a single section named "Ingredients".
- Toppings, garnishes and "to serve" items go in their own section AND get
  "is_topping": true.

Ingredients
- "raw_text" is the line exactly as written, minus @handles and hashtags.
  Never clean it up. It is the audit trail.
- "name" is the ingredient alone: no quantity, no preparation, no brand.
  "1 large onion, finely diced" -> "onion"
  "2 lbs boneless skinless chicken thighs" -> "chicken thighs"
- One line may contain several ingredients. Split them.
  "2 tbsp garam masala, 1 tbsp turmeric, 3/4 tbsp chilli powder"
  -> three separate entries.
- Do not correct spelling in raw_text. Do normalise it in "name"
  ("tumeric" -> "turmeric").

Quantities — convert to g, ml or each. Nothing else.
- 1 lb = 450 g, 1 oz = 28 g
- 1 US cup = 240 ml, 1 tbsp = 15 ml, 1 tsp = 5 ml
- Fractions and unicode fractions resolve to decimals: 1½ tsp -> 7.5 ml
- Ranges take the upper bound: "18-20 wrappers" -> 20 each
- Countable items are "each": cloves, onions, eggs, chicken thighs, lemons,
  garlic heads, naan. "4 garlic cloves" -> qty 4, unit "each".
- "1 can chopped tomatoes" -> 400, "g"
- Cups of a solid stay in ml. Density conversion happens downstream.
- No amount given ("Avocado oil", "chopped coriander for garnishing",
  "salt to taste") -> qty null, unit null. Never guess a number.

Steps
- Copy them as written, lightly cleaned.
- Convert temperatures to Celsius: 425F -> 220C. Leave Celsius alone.
- "timer_seconds" only for explicit durations. "for 25 minutes" -> 1500.
  "until golden" -> null.
- If the last step is cut off mid-sentence, include what is visible and set
  "steps_truncated": true.
- If no steps are visible at all, return an empty array and
  "steps_truncated": true.

Ignore
- Engagement bait ("Comment RECIPE and I'll send it"), follow prompts,
  self-promotion, hashtags, like counts, UI chrome, the iOS status bar and
  the "Saved" header.
- Brand tags in the middle of an ingredient list (@elmlea_ukie) are noise,
  not ingredients.

If the images contain no recipe, return {"error": "no recipe found"}.
```

---

## Pass 2 — step reconstruction (text only)

Fires when `steps` is empty or `steps_truncated` is true.

```
Write cooking instructions for this recipe.

You are given the dish name and the complete ingredient list with quantities.
Some steps may already exist — if so, continue from where they stop rather
than rewriting them.

Rules
- Use ONLY the ingredients listed. Do not add any.
- Every ingredient must be used somewhere, except items marked is_topping.
- Reference the exact quantities given.
- Keep to the sections provided: marinade steps before sauce steps, and so on.
- 6-10 steps. Each step is one action.
- Give explicit times and temperatures where a home cook needs them.
- Celsius only.
- No preamble, no serving suggestions, no commentary.

Return ONLY JSON:
{ "steps": [ { "step_no": 1, "text": "...", "timer_seconds": null } ] }

INPUT
Title: {{title}}
Servings: {{servings}}
Ingredients: {{ingredients_json}}
Existing steps: {{existing_steps_or_none}}
```

Recipes completed this way get `steps_origin = 'generated'` (or `'partial'`
when Pass 1 returned some steps), and the UI shows a "reconstructed" badge.
Never web-search for steps — a found recipe has different quantities and will
contradict the shopping list.

---

## Pass 3 — canonical matching (code, no model)

For each extracted ingredient:

1. `select * from match_ingredient(name)`
2. Score ≥ 0.75 → auto-link, store `match_confidence`.
3. Score 0.4–0.75 → link, but flag the row on the review screen.
4. Score < 0.4 → leave `ingredient_id` null, insert into
   `ingredient_review_queue`, show as unmatched.

Volume → weight happens here, using `ingredients.g_per_ml` and `g_per_each`.
The parser deliberately leaves `¼ cup parsley` as 60 ml; only the ingredient
table knows that's about 15 g.

---

## Review screen

Never skip it. Show title (flagged if inferred), sections, every ingredient
with its quantity, and any low-confidence matches highlighted. One tap to
correct, one tap to save.

Silent parse errors become wrong quantities on the shopping list two days
later, at the shops, with no way to trace them.
