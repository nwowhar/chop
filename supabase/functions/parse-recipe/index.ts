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
