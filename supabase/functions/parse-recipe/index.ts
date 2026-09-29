// ============================================================
// Chop — parse-recipe edge function
//
// POST { job_id }
//
// 1. Load the import job and its images from storage
// 2. Gemini vision -> structured recipe JSON
// 3. If steps are missing or truncated, a second text-only call
// 4. Resolve every ingredient against the canonical table
// 5. Write recipe + sections + ingredients + steps
// 6. Park the job in 'review'
//
// The job row is the state machine. Every failure path writes a
// status, so nothing is left spinning.
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXTRACTION_PROMPT = `You extract recipes from screenshots of social media posts.

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
  "macros_per_serve": {
    "kcal": number, "protein_g": number, "carb_g": number,
    "fat_g": number, "fibre_g": number
  },
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

Macros
- Estimate per serving from the ingredients and servings count.
- If servings is null, assume 4.
- Round to whole grams. These are estimates for sorting, not nutrition advice.

If the images contain no recipe, return {"error": "no recipe found"}.`;

const GENERATION_PROMPT = `Write a real, well-known recipe.

You are given a dish name and sometimes a dietary steer. Produce the standard
home-cook version of that dish — the one most recipes for it agree on. Do not
invent a novel dish or an unusual variation.

Return ONLY a JSON object in the schema below. No markdown fences.

Same schema, same rules on ingredient naming, quantities and units as an
imported recipe:
- Metric only. g, ml or each. Nothing else.
- 1 cup = 240 ml, 1 tbsp = 15 ml, 1 tsp = 5 ml. Celsius only.
- "name" is the bare ingredient, no quantity or preparation.
- "raw_text" is how the line would read in a recipe ("2 brown onions, diced").
- Countable things are "each"; spices and liquids are ml; solids by weight are g.
- Sections only where the dish genuinely has them (marinade, sauce, garnish).
- Ground spice vs fresh herb: pick whichever the dish actually uses.
- 6-10 steps, one action each, explicit times and temperatures.
- Estimate per-serve macros.

Set "title_inferred": false and "steps_truncated": false.

If the dish name is not a real dish, return {"error": "not a known dish"}.`;

const RECONSTRUCTION_PROMPT = `Write cooking instructions for this recipe.

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


const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY')!;
const MODEL = 'gemini-3.6-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const MATCH_AUTO = 0.75;   // link silently
const MATCH_FLAG = 0.40;   // link but flag for review

// ============================================================
// Deterministic ingredient parsing — no model call.
//
// KEEP IN SYNC with src/lib/parseIngredient.js, which is the
// testable copy (scripts/test_parser.mjs). Inlined here because
// edge functions are pasted into the dashboard as one file.
// ============================================================

const VULGAR = {
  '½': 0.5, '⅓': 1/3, '⅔': 2/3, '¼': 0.25, '¾': 0.75,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1/6, '⅚': 5/6, '⅛': 0.125, '⅜': 0.375,
  '⅝': 0.625, '⅞': 0.875,
};

// to ml, or grams where the unit is a weight
const UNITS = {
  // volume
  tsp: ['tsp', 'teaspoon', 'teaspoons', 't'],
  tbsp: ['tbsp', 'tablespoon', 'tablespoons', 'tbs', 'tbl', 'T'],
  cup: ['cup', 'cups', 'c'],
  ml: ['ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters', 'mls'],
  l: ['l', 'litre', 'litres', 'liter', 'liters'],
  floz: ['fl oz', 'floz', 'fluid ounce', 'fluid ounces'],
  pint: ['pint', 'pints', 'pt'],
  quart: ['quart', 'quarts', 'qt'],
  // weight
  g: ['g', 'gram', 'grams', 'gm', 'gms'],
  kg: ['kg', 'kilo', 'kilos', 'kilogram', 'kilograms'],
  oz: ['oz', 'ounce', 'ounces'],
  lb: ['lb', 'lbs', 'pound', 'pounds'],
  // countable
  clove: ['clove', 'cloves'],
  can: ['can', 'cans', 'tin', 'tins'],
  pack: ['pack', 'packet', 'packets', 'punnet', 'bunch', 'bunches', 'head', 'heads'],
  slice: ['slice', 'slices'],
  piece: ['piece', 'pieces'],
};

// ml per unit, or g where noted
const TO_ML = {
  tsp: 5, tbsp: 15, cup: 240, ml: 1, l: 1000,
  floz: 30, pint: 568, quart: 946,
};
const TO_G = { g: 1, kg: 1000, oz: 28, lb: 450 };

// units that are really "one of a thing"
const COUNTABLE = new Set(['clove', 'can', 'pack', 'slice', 'piece']);

const UNIT_LOOKUP = (() => {
  const m = new Map();
  for (const [canon, forms] of Object.entries(UNITS)) {
    for (const f of forms) m.set(f.toLowerCase(), canon);
  }
  return m;
})();

// preparation words to strip off the ingredient name
const PREP = new RegExp(
  '\\b(finely|roughly|coarsely|thinly|freshly|lightly|well)?\\s*' +
  '(chopped|diced|minced|sliced|grated|crushed|shredded|julienned|' +
  'cubed|halved|quartered|trimmed|peeled|deseeded|seeded|drained|' +
  'rinsed|beaten|melted|softened|toasted|zested|juiced|' +
  'squeezed dry|room temperature|at room temperature|plus more|' +
  'to taste|to serve|for garnish|for garnishing|for serving|optional|' +
  'divided|packed|heaped|level)\\b', 'gi');

const SIZE = /\b(large|small|medium|extra large|jumbo|baby)\b/gi;

// same words as PREP, anchored to the end of the line
const TRAILING_PREP = new RegExp(PREP.source + '\\s*$', 'i');

function parseIngredientLine(raw) {
  if (!raw || typeof raw !== 'string') return null;

  let s = raw
    .replace(/\(.*?\)/g, ' ')          // parenthetical asides
    .replace(/[⁄]/g, '/')          // fraction slash
    .replace(/\s+/g, ' ')
    .trim();

  const optional = /\b(optional|to taste|to serve|for garnish)\b/i.test(raw);

  // ---- quantity -------------------------------------------------
  let qty = null;
  let rest = s;

  // "Juice of 1 lemon" / "zest of 2 limes"
  const juice = s.match(/^(?:the\s+)?(juice|zest)\s+of\s+(?:about\s+)?([\d½⅓⅔¼¾/.\s]+)?\s*(.+)$/i);
  if (juice) {
    const n = juice[2] ? numberFrom(juice[2]) : 1;
    return finish(raw, n ?? 1, 'each', juice[3], optional);
  }

  const m = s.match(
    /^(?:about\s+|approx\.?\s+|around\s+)?([\d]+\s*[–-]\s*[\d]+|[\d]+\s*[¼-¾⅐-⅞]|[¼-¾⅐-⅞]|[\d]+\s+[\d]+\/[\d]+|[\d]+\/[\d]+|[\d]*\.?[\d]+)\s*(.*)$/
  );

  if (m) {
    qty = numberFrom(m[1]);
    rest = m[2];
  }

  // ---- unit -----------------------------------------------------
  let unitToken = null;
  const um = rest.match(/^([a-zA-Z]+\.?\s?[a-zA-Z]*\.?)\b\s*(.*)$/);
  if (um) {
    const candidate = um[1].replace(/\./g, '').trim().toLowerCase();
    const twoWord = candidate;
    const oneWord = candidate.split(' ')[0];

    if (UNIT_LOOKUP.has(twoWord)) { unitToken = UNIT_LOOKUP.get(twoWord); rest = um[2]; }
    else if (UNIT_LOOKUP.has(oneWord)) {
      unitToken = UNIT_LOOKUP.get(oneWord);
      rest = rest.replace(new RegExp(`^${oneWord}\\.?\\s*`, 'i'), '');
    }
  }

  // "of" after a unit — "2 cups of flour"
  rest = rest.replace(/^of\s+/i, '');

  // Dual measurements: "800 g / 1.6 lb chicken thighs". Common on
  // sites that serve both metric and imperial. Drop the alternate.
  rest = rest.replace(
    /^[/|]\s*[\d.,]+\s*(?:g|kg|oz|lb|lbs|ml|l|cups?|tbsp|tsp)\b\.?\s*/i, '');

  if (qty == null) return finish(raw, null, null, rest, optional);

  // ---- normalise ------------------------------------------------
  if (unitToken == null) {
    // a bare number means a countable thing: "2 onions"
    return finish(raw, qty, 'each', rest, optional);
  }
  if (COUNTABLE.has(unitToken)) {
    if (unitToken === 'can') return finish(raw, qty * 400, 'g', rest, optional);
    return finish(raw, qty, 'each', rest, optional);
  }
  if (TO_ML[unitToken]) return finish(raw, round(qty * TO_ML[unitToken]), 'ml', rest, optional);
  if (TO_G[unitToken])  return finish(raw, round(qty * TO_G[unitToken]),  'g',  rest, optional);

  return finish(raw, qty, 'each', rest, optional);
}

function numberFrom(t) {
  if (!t) return null;
  const s = t.trim();

  // range — take the upper bound, as the parser prompt does
  const range = s.match(/^([\d.]+)\s*[–-]\s*([\d.]+)$/);
  if (range) return parseFloat(range[2]);

  // "1 ½"
  const mixedV = s.match(/^(\d+)\s*([¼-¾⅐-⅞])$/);
  if (mixedV) return parseInt(mixedV[1], 10) + (VULGAR[mixedV[2]] ?? 0);

  // "1 1/2"
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return parseInt(mixed[1], 10) + parseInt(mixed[2], 10) / parseInt(mixed[3], 10);

  // "1/2"
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return parseInt(frac[1], 10) / parseInt(frac[2], 10);

  // bare vulgar
  if (VULGAR[s] != null) return VULGAR[s];

  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function finish(raw, qty, unit, nameRaw, optional) {
  const name = cleanName(nameRaw);
  if (!name) return null;
  return {
    raw_text: raw.trim(),
    name,
    qty,
    unit,
    optional,
    is_topping: /\b(to serve|for garnish|for garnishing|to taste)\b/i.test(raw),
  };
}

function cleanName(s) {
  if (!s) return '';
  let out = s.split(/,| - | — |\bor\b/)[0];

  // Preparation words only count as preparation when they trail:
  // "chicken thighs chopped" loses it, "chopped tomatoes" keeps it,
  // because that is the name of the tin you buy.
  for (let i = 0; i < 4; i++) {
    const trimmed = out.replace(TRAILING_PREP, '').trim();
    if (trimmed === out.trim() || !trimmed) break;
    out = trimmed;
  }

  return out
    .replace(SIZE, ' ')
    .replace(/\b(fresh|dried|raw|whole|plain|good quality|free range|organic)\b/gi, ' ')
    .replace(/[^\w\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function round(n) {
  return Math.round(n * 100) / 100;
}

// ------------------------------------------------------------
// Whole-recipe parse from schema.org JSON-LD. Returns the same
// shape parse-recipe produces, so everything downstream is
// unchanged — or null when the data is too thin to trust, in
// which case the caller pays for a model call after all.
// ------------------------------------------------------------

function parseRecipeLd(ld) {
  if (!ld) return null;

  const lines = asArray(ld.recipeIngredient ?? ld.ingredients)
    .filter((x) => typeof x === 'string' && x.trim());
  if (lines.length < 3) return null;

  const ingredients = lines.map(parseIngredientLine).filter(Boolean);
  if (ingredients.length < Math.ceil(lines.length * 0.8)) return null;

  // a parse that found no quantities at all is not a parse
  const withQty = ingredients.filter((i) => i.qty != null).length;
  if (withQty < ingredients.length * 0.5) return null;

  const steps = flattenInstructions(ld.recipeInstructions)
    .map((text, i) => ({
      step_no: i + 1,
      text,
      timer_seconds: timerFrom(text),
    }));

  return {
    title: typeof ld.name === 'string' ? ld.name.trim() : null,
    title_inferred: false,
    servings: servingsFrom(ld.recipeYield),
    source_handle: null,
    sections: [{ name: 'Ingredients', ingredients }],
    steps,
    steps_truncated: steps.length === 0,
    macros_per_serve: macrosFrom(ld.nutrition),
    notes: null,
  };
}

function asArray(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

function flattenInstructions(x) {
  const out = [];
  for (const node of asArray(x)) {
    if (typeof node === 'string') {
      out.push(stripTags(node));
    } else if (node && typeof node === 'object') {
      if (node['@type'] === 'HowToSection' && node.itemListElement) {
        out.push(...flattenInstructions(node.itemListElement));
      } else if (node.text) {
        out.push(stripTags(node.text));
      } else if (node.name) {
        out.push(stripTags(node.name));
      }
    }
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

function stripTags(s) {
  return String(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(d))
    .replace(/\s+/g, ' ')
    .trim();
}

function servingsFrom(y) {
  if (y == null) return null;
  const s = Array.isArray(y) ? y[0] : y;
  const n = parseInt(String(s).match(/\d+/)?.[0] ?? '', 10);
  return Number.isFinite(n) && n > 0 && n < 100 ? n : null;
}

function timerFrom(text) {
  const m = String(text).match(/(\d+)\s*(?:to|-|–)?\s*(\d+)?\s*(minute|min|hour|hr)/i);
  if (!m) return null;
  const n = parseInt(m[2] ?? m[1], 10);
  return /hour|hr/i.test(m[3]) ? n * 3600 : n * 60;
}

function macrosFrom(n) {
  if (!n || typeof n !== 'object') return null;
  const num = (v) => {
    const x = parseFloat(String(v ?? '').replace(/[^\d.]/g, ''));
    return Number.isFinite(x) ? Math.round(x) : null;
  };
  const out = {
    kcal: num(n.calories),
    protein_g: num(n.proteinContent),
    carb_g: num(n.carbohydrateContent),
    fat_g: num(n.fatContent),
    fibre_g: num(n.fiberContent),
  };
  return out.kcal || out.protein_g ? out : null;
}


// ============================================================

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ParsedIngredient {
  raw_text: string;
  name: string;
  qty: number | null;
  unit: 'g' | 'ml' | 'each' | null;
  optional: boolean;
  is_topping: boolean;
}

interface ParsedSection {
  name: string;
  ingredients: ParsedIngredient[];
}

interface ParsedRecipe {
  title: string | null;
  title_inferred: boolean;
  servings: number | null;
  source_handle: string | null;
  sections: ParsedSection[];
  steps: { step_no: number; text: string; timer_seconds: number | null }[];
  steps_truncated: boolean;
  notes: string | null;
  error?: string;
}

// ------------------------------------------------------------
// Gemini sometimes wraps JSON in fences despite being told not
// to. Strip them rather than failing the whole import.
// ------------------------------------------------------------
function parseJson<T>(raw: string): T {
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first > 0 || last < s.length - 1) s = s.slice(first, last + 1);
  return JSON.parse(s) as T;
}

async function callGemini(parts: unknown[], think = 'low'): Promise<string> {
  const config: Record<string, unknown> = {
    maxOutputTokens: 8192,
    responseMimeType: 'application/json',
  };

  const send = (cfg: Record<string, unknown>) =>
    fetch(`${ENDPOINT}?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: cfg }),
    });

  // Reading a caption or writing a known recipe needs no deliberation,
  // and thinking tokens are both slow and charged against the output
  // budget. Retry without the field if the model rejects it.
  let res = await send({ ...config, thinkingLevel: think });
  if (res.status === 400) res = await send(config);

  // 429 is either the rolling per-minute cap, which clears in
  // seconds, or the daily quota, which does not. Back off for the
  // first, and say so plainly for the second.
  for (let attempt = 0; attempt < 3 && res.status === 429; attempt++) {
    const body = await res.clone().text();
    if (/per day|daily|RequestsPerDay/i.test(body)) {
      throw new Error(
        'Daily Gemini quota used up. It resets around 5pm AEST, ' +
        'or enable billing on the Google Cloud project to lift the cap.');
    }
    const wait = 2000 * Math.pow(2, attempt) + Math.random() * 500;
    await new Promise((r) => setTimeout(r, wait));
    res = await send({ ...config, thinkingLevel: think });
  }

  if (res.status === 429) {
    throw new Error('Gemini is rate limiting. Give it a minute and try again.');
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`gemini ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text ?? '')
    .join('');

  if (!text) {
    const reason = data?.candidates?.[0]?.finishReason ?? 'unknown';
    throw new Error(`gemini returned no text (finishReason: ${reason})`);
  }
  return text;
}

// ------------------------------------------------------------
// Recipe sites publish schema.org Recipe as JSON-LD — structured
// data they put there specifically for machines to read. Pull it
// straight out rather than asking a model to read the page.
// ------------------------------------------------------------
function findRecipeLd(html: string): Record<string, unknown> | null {
  const blocks = [...html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  for (const b of blocks) {
    let data;
    try { data = JSON.parse(b[1].trim()); } catch { continue; }

    const queue = Array.isArray(data) ? [...data] : [data];
    while (queue.length) {
      const node = queue.shift();
      if (!node || typeof node !== 'object') continue;

      const t = node['@type'];
      const types = Array.isArray(t) ? t : [t];
      if (types.includes('Recipe')) return node;

      if (Array.isArray(node['@graph'])) queue.push(...node['@graph']);
    }
  }
  return null;
}

function ldImage(node: Record<string, unknown>): string | null {
  const img = node.image;
  if (!img) return null;
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) {
    const first = img[0];
    return typeof first === 'string' ? first : (first?.url ?? null);
  }
  // deno-lint-ignore no-explicit-any
  return (img as any).url ?? null;
}

function ogImage(html: string): string | null {
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
        ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return m?.[1] ?? null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });


  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let jobId: string | null = null;

  try {
    // ---- auth: the caller must be a member of the job's household
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'missing authorization' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: auth } = await userClient.auth.getUser();
    if (!auth?.user) {
      return new Response(JSON.stringify({ error: 'invalid token' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    jobId = body.job_id;
    if (!jobId) throw new Error('job_id required');

    // RLS applies on the user client, so this fails if they aren't a member
    const { data: job, error: jobErr } = await userClient
      .from('import_jobs')
      .select('id, household_id, image_paths, status, hint, theme, source_url')
      .eq('id', jobId)
      .single();

    if (jobErr || !job) throw new Error('job not found or not permitted');
    if (job.status === 'saved') throw new Error('job already saved');

    await admin.from('import_jobs')
      .update({ status: 'parsing', stage: 'reading' }).eq('id', jobId);

    // ---- pass 1
    const hint = (job.hint ?? '').trim();
    const theme = (job.theme ?? '').trim();
    const sourceUrl = (job.source_url ?? '').trim();
    const generated = !job.image_paths?.length && !sourceUrl;

    if (generated && !hint) throw new Error('a dish name is required');

    let imageUrl: string | null = null;
    let usedModel = true;

    const themeLine = {
      'high-protein': 'Favour a high-protein version: at least 30 g protein per serving.',
      'pre-training': 'Favour carbohydrate, keep fat and fibre low — this is eaten before exercise.',
      'vegetarian':   'Make it vegetarian. No meat, fish, or animal-derived sauces such as fish sauce, oyster sauce or anchovy.',
      'quick':        'Keep total cooking time under 30 minutes.',
      'crowd':        'Write it for 8 servings and keep it to methods that scale in one pot or tray.',
    }[theme] ?? '';

    let parsed: ParsedRecipe;

    if (sourceUrl) {
      const page = await fetch(sourceUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Chop/1.0)' },
        redirect: 'follow',
      });
      if (!page.ok) throw new Error(`could not read that page (${page.status})`);

      const html = await page.text();
      const ld = findRecipeLd(html);
      imageUrl = (ld ? ldImage(ld) : null) ?? ogImage(html);

      // Schema.org already gives us a structured ingredient list.
      // Paying a model to read structured data is waste, and the
      // free tier is counted in requests, so parse it ourselves
      // and only fall back when the result looks thin.
      const direct = ld ? parseRecipeLd(ld) : null;
      if (direct) {
        parsed = direct;
        usedModel = false;
      } else {

      // JSON-LD when the site publishes it, page text as a fallback.
      const payload = ld
        ? JSON.stringify(ld).slice(0, 30000)
        : stripHtml(html).slice(0, 30000);

      const urlText = `${EXTRACTION_PROMPT}

The input below is ${ld ? 'schema.org Recipe JSON-LD' : 'the text of a web page'}
rather than a screenshot. Same rules apply: metric only, split combined
ingredient lines, bare ingredient names, sections where the recipe has them.

Ignore navigation, comments, adverts and the author's story. Take the
ingredients and method only.

${payload}`;

      parsed = parseJson<ParsedRecipe>(await callGemini([{ text: urlText }]));
      }

    } else if (generated) {
      const genText = `${GENERATION_PROMPT}

DISH: "${hint}"
${themeLine ? `STEER: ${themeLine}` : ''}`;

      parsed = parseJson<ParsedRecipe>(await callGemini([{ text: genText }]));
    } else {

    const promptText = hint
      ? `${EXTRACTION_PROMPT}

USER-SUPPLIED DISH NAME: "${hint}"

The person importing this told you what the dish is. Trust it.
- Use it as "title" exactly, and set "title_inferred": false.
- Let it settle ambiguous ingredient readings. In a curry, "coriander"
  with a spoon measure is the ground spice; in a salad it's the herb.
- If the images clearly show a different dish, follow the images and
  put the mismatch in "notes".`
      : EXTRACTION_PROMPT;

    const parts: unknown[] = [{ text: promptText }];

    const files = await Promise.all(job.image_paths.map(async (path: string) => {
      const { data: file, error: dlErr } = await admin
        .storage.from('recipe-images').download(path);
      if (dlErr || !file) throw new Error(`could not read ${path}`);
      return {
        inline_data: {
          mime_type: file.type || 'image/jpeg',
          data: toBase64(await file.arrayBuffer()),
        },
      };
    }));
    parts.push(...files);

      parsed = parseJson<ParsedRecipe>(await callGemini(parts));
    }

    if (parsed.error) throw new Error(parsed.error);
    if (!parsed.sections?.length) throw new Error('no ingredients extracted');

    // ---- pass 2: reconstruct steps if needed
    let stepsOrigin: 'extracted' | 'generated' | 'partial' = 'extracted';

    if (!parsed.steps?.length || parsed.steps_truncated) {
      usedModel = true;
      stepsOrigin = parsed.steps?.length ? 'partial' : 'generated';

      const flat = parsed.sections.flatMap((s) =>
        s.ingredients.map((i) => ({
          section: s.name, name: i.name, qty: i.qty,
          unit: i.unit, is_topping: i.is_topping,
        }))
      );

      const recon = await callGemini([{
        text: `${RECONSTRUCTION_PROMPT}

INPUT
Title: ${hint || parsed.title || 'unknown'}
Servings: ${parsed.servings ?? 'unknown'}
Ingredients: ${JSON.stringify(flat)}
Existing steps: ${parsed.steps?.length ? JSON.stringify(parsed.steps) : 'none'}`,
      }]);

      const out = parseJson<{ steps: ParsedRecipe['steps'] }>(recon);
      if (out.steps?.length) parsed.steps = out.steps;
    }

    // ---- pass 3: canonical matching (one round trip, not thirty)
    const unmatched: string[] = [];
    const allIngredients = parsed.sections.flatMap((s) => s.ingredients);
    const names = allIngredients.map((i) => i.name);

    const { data: matches, error: matchErr } = await admin
      .rpc('match_ingredients_batch', { names });
    if (matchErr) throw new Error(`matching failed: ${matchErr.message}`);

    const byName = new Map<string, { id: string; canonical_name: string; score: number }>();
    for (const m of matches ?? []) {
      if (m.id && !byName.has(m.input)) byName.set(m.input, m);
    }

    for (const ing of allIngredients) {
      const best = byName.get(ing.name);
      // deno-lint-ignore no-explicit-any
      const row = ing as any;

      if (best && best.score >= MATCH_FLAG) {
        row.ingredient_id = best.id;
        row.match_confidence = best.score;
        row.needs_review = best.score < MATCH_AUTO;
      } else {
        row.ingredient_id = null;
        row.match_confidence = null;
        row.needs_review = true;
        unmatched.push(ing.name);
      }
    }

    if (unmatched.length) {
      await admin.from('ingredient_review_queue')
        .insert(unmatched.map((raw_text) => ({ raw_text, resolved: false })));
    }

    await admin.from('import_jobs').update({ stage: 'writing' }).eq('id', jobId);

    // ---- write the recipe
    const { data: recipe, error: recErr } = await admin
      .from('recipes')
      .insert({
        household_id: job.household_id,
        title: hint || parsed.title || 'Untitled recipe',
        servings: parsed.servings,
        source_type: sourceUrl ? 'url' : generated ? 'manual' : 'instagram',
        source_handle: parsed.source_handle,
        image_path: job.image_paths?.[0] ?? null,
        image_url: imageUrl,
        source_url: sourceUrl || null,
        macros_per_serve: parsed.macros_per_serve ?? null,
        steps_origin: stepsOrigin,
        tags: [
          ...((!hint && parsed.title_inferred) ? ['title-inferred'] : []),
          ...(generated ? ['generated'] : []),
          ...(theme ? [theme] : []),
        ],
      })
      .select('id')
      .single();

    if (recErr || !recipe) throw new Error(`recipe insert failed: ${recErr?.message}`);

    const { data: secRows } = await admin
      .from('recipe_sections')
      .insert(parsed.sections.map((s, idx) => ({
        recipe_id: recipe.id, name: s.name, sort_order: idx,
      })))
      .select('id, sort_order');

    const secId = new Map<number, string>();
    for (const r of secRows ?? []) secId.set(r.sort_order, r.id);

    const ingRows = parsed.sections.flatMap((section, idx) =>
      section.ingredients.map((ing, i) => {
        // deno-lint-ignore no-explicit-any
        const r = ing as any;
        return {
          recipe_id: recipe.id,
          section_id: secId.get(idx) ?? null,
          ingredient_id: r.ingredient_id,
          raw_text: ing.raw_text,
          qty: ing.qty,
          unit: ing.unit,
          optional: ing.optional ?? false,
          is_topping: ing.is_topping ?? false,
          match_confidence: r.match_confidence,
          sort_order: i,
        };
      })
    );

    if (ingRows.length) await admin.from('recipe_ingredients').insert(ingRows);

    if (parsed.steps?.length) {
      await admin.from('recipe_steps').insert(
        parsed.steps.map((s, i) => ({
          recipe_id: recipe.id,
          step_no: s.step_no ?? i + 1,
          text: s.text,
          timer_seconds: s.timer_seconds,
        }))
      );
    }

    // Only bill a call against the free tier when one happened.
    if (usedModel) {
      await admin.from('model_calls').insert({
        household_id: job.household_id,
        kind: generated ? 'generate' : sourceUrl ? 'import' : 'import',
      }).then(() => {}, () => {});
    }

    await admin.from('import_jobs').update({
      status: 'review',
      parsed,
      recipe_id: recipe.id,
      error: null,
    }).eq('id', jobId);

    return new Response(JSON.stringify({
      recipe_id: recipe.id,
      title: parsed.title,
      title_inferred: parsed.title_inferred,
      steps_origin: stepsOrigin,
      sections: parsed.sections.length,
      ingredients: parsed.sections.reduce((n, s) => n + s.ingredients.length, 0),
      unmatched,
      used_model: usedModel,
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (jobId) {
      await admin.from('import_jobs')
        .update({ status: 'failed', error: message })
        .eq('id', jobId);
    }
    return new Response(JSON.stringify({ error: message }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
