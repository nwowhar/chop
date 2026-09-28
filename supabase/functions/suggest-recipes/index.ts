// ============================================================
// Chop — suggest-recipes
//
// POST { query, exclude?: string[], household_id }
//
// Returns five dish suggestions for a natural-language query.
// Cheap and fast: titles and one-liners only, no ingredients,
// no method. The full recipe is only written when the person
// picks one, via parse-recipe in generation mode.
//
// "high protein dinners under 30 minutes"  -> five dishes
// "sticky bbq ribs"                        -> five variations
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY')!;
const MODEL = 'gemini-3.6-flash';
const ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PROMPT = `Suggest five real, well-known dishes matching the request.

Rules
- Real dishes only. Things people actually cook and that have an established
  recipe. Never invent a dish or a fusion novelty.
- Vary them. Five different dishes, not five versions of one, unless the
  request names a specific dish — then give five genuine regional or
  method variations of it.
- Australian supermarket ingredients. Nothing that needs a specialist trip.
- Honour every constraint in the request: time, protein, dietary, servings.
- "protein_g" and "kcal" are rough per-serve estimates. Round to 5.
- "minutes" is total time from starting to eating.
- "why" is one short clause on what makes it fit the request. No marketing.

Return ONLY JSON, no fences:
{
  "suggestions": [
    {
      "title": "Chicken katsu curry",
      "why": "Crumbed and shallow fried, sauce from pantry staples",
      "minutes": 35,
      "protein_g": 42,
      "kcal": 680,
      "tags": ["high-protein"]
    }
  ]
}

Valid tags: high-protein, pre-training, vegetarian, quick, crowd.
Only include a tag if it is genuinely true of the dish.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
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

    const { query, exclude = [] } = await req.json();
    if (!query?.trim()) throw new Error('query required');

    const text = `${PROMPT}

REQUEST: "${query.trim()}"
${exclude.length ? `ALREADY SUGGESTED, pick different dishes: ${exclude.join(', ')}` : ''}`;

    // A response schema makes the output structurally guaranteed
    // rather than hoping the model closes its braces.
    const schema = {
      type: 'OBJECT',
      properties: {
        suggestions: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              title:     { type: 'STRING' },
              why:       { type: 'STRING' },
              minutes:   { type: 'INTEGER' },
              protein_g: { type: 'INTEGER' },
              kcal:      { type: 'INTEGER' },
              tags:      { type: 'ARRAY', items: { type: 'STRING' } },
            },
            required: ['title', 'why', 'minutes'],
          },
        },
      },
      required: ['suggestions'],
    };

    // Thinking tokens count against maxOutputTokens on 3.x, so a
    // tight budget gets spent reasoning and the JSON arrives cut
    // in half. Give it room and keep the thinking short.
    const baseConfig = {
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      responseSchema: schema,
    };

    async function ask(config: Record<string, unknown>) {
      return await fetch(`${ENDPOINT}?key=${GEMINI_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: config,
        }),
      });
    }

    // thinkingLevel is rejected by older models; fall back quietly.
    let res = await ask({ ...baseConfig, thinkingLevel: 'low' });
    if (res.status === 400) res = await ask(baseConfig);

    for (let attempt = 0; attempt < 2 && res.status === 429; attempt++) {
      const body = await res.clone().text();
      if (/per day|daily|RequestsPerDay/i.test(body)) {
        throw new Error(
          'Daily Gemini quota used up. Resets around 5pm AEST, or enable ' +
          'billing on the Google Cloud project to lift the cap.');
      }
      await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt)));
      res = await ask({ ...baseConfig, thinkingLevel: 'low' });
    }

    if (res.status === 429) {
      throw new Error('Gemini is rate limiting. Give it a minute.');
    }

    if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);

    const data = await res.json();
    const cand = data?.candidates?.[0];

    let raw = cand?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';

    if (!raw) {
      throw new Error(`no output from the model (${cand?.finishReason ?? 'unknown'})`);
    }
    if (cand?.finishReason === 'MAX_TOKENS') {
      throw new Error('the model ran out of room — try a shorter query');
    }

    raw = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Salvage whatever complete objects arrived before the cut
      const items = [...raw.matchAll(/\{[^{}]*"title"[^{}]*\}/g)]
        .map((m) => { try { return JSON.parse(m[0]); } catch { return null; } })
        .filter(Boolean);
      if (!items.length) throw new Error('could not read the response');
      parsed = { suggestions: items };
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
