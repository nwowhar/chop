export const EXTRACTION_PROMPT = `You extract recipes from screenshots of social media posts.

You will receive one or more images. If there is more than one, they are
overlapping screenshots of the SAME post, taken while scrolling. Merge them into
a single recipe. Content that appears in two images is the same content seen
twice — never list it twice.

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
- "name" is the ingredient alone: no quantity, no preparation, no brand, no
  descriptive adjectives. This field is matched against a database, so it must
  be the shortest correct noun phrase.
    "1 large onion, finely diced"            -> "onion"
    "2 lbs boneless skinless chicken thighs" -> "chicken thighs"
    "1/3 cup green onions, thinly sliced"    -> "spring onion"
    "150ml double cream (heavy whipping cream)" -> "double cream"
- One line may contain several ingredients. Split them.
    "2 tbsp garam masala, 1 tbsp turmeric, 3/4 tbsp chilli powder"
    -> three separate entries.
- Do not correct spelling in raw_text. Do normalise it in "name".

Herb and spice form — this matters, they are different products
- A small spoon measure in a spice list is the DRIED GROUND spice.
- A bunch, a garnish, "fresh", or "chopped" is the FRESH herb.
    "1½ tsp coriander"       -> "ground coriander"
    "chopped coriander"      -> "coriander"
    "1 tsp dried oregano"    -> "dried oregano"
    "2 tbsp chopped parsley" -> "parsley"
    "1 tbsp fresh ginger"    -> "ginger"
    "1 tsp ground ginger"    -> "ground ginger"
  Same distinction applies to dill, thyme, rosemary, chilli and mint.

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
  self-promotion, hashtags, like counts, UI chrome, the iOS status bar and the
  "Saved" header.
- Brand tags in the middle of an ingredient list are noise, not ingredients.

If the images contain no recipe, return {"error": "no recipe found"}.`;

export const RECONSTRUCTION_PROMPT = `Write cooking instructions for this recipe.

You are given the dish name and the complete ingredient list with quantities.
Some steps may already exist — if so, continue from where they stop rather than
rewriting them.

Rules
- Use ONLY the ingredients listed. Do not add any.
- Every ingredient must be used somewhere, except items marked is_topping.
- Reference the exact quantities given.
- Keep to the sections provided: marinade steps before sauce steps, and so on.
- 6-10 steps. Each step is one action.
- Give explicit times and temperatures where a home cook needs them.
- Celsius only.
- No preamble, no serving suggestions, no commentary.

Return ONLY JSON, no markdown fences:
{ "steps": [ { "step_no": 1, "text": "...", "timer_seconds": null } ] }`;
