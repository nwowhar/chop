// ============================================================
// Chop — parse-receipt
//
// POST { image_path, household_id, store? }
//
// Photograph a supermarket docket. Every line becomes a price
// observation and a pantry item, so stock and prices both stay
// current without anyone typing anything.
//
// Receipt lines are abbreviated and brand-heavy — "WW BRWN
// ONION 1KG" — so the model is asked to normalise before the
// canonical matcher sees them.
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

const PROMPT = `Read this Australian supermarket receipt.

Return ONLY JSON, no fences:
{
  "store": "Woolworths" | "Coles" | "ALDI" | "IGA" | null,
  "date": "YYYY-MM-DD" | null,
  "total": number | null,
  "items": [
    {
      "raw_text": "WW BRWN ONION 1KG",
      "name": "brown onion",
      "price": 3.50,
      "qty": 1000,
      "unit": "g" | "ml" | "each" | null
    }
  ]
}

Rules
- "raw_text" is the line exactly as printed.
- "name" is the plain ingredient, expanded and unabbreviated, no brand,
  no pack size. "WW BRWN ONION 1KG" -> "brown onion".
  "COLES RSP CHKN THIGH" -> "chicken thighs".
- "price" is what was actually paid for that line, after any discount
  shown against it. Numbers only.
- "qty" and "unit" come from the pack size where it is printed:
  "1KG" -> 1000 g, "500ML" -> 500 ml, "6PK" -> 6 each. Null if absent.
- Skip: bag charges, container deposits, subtotals, GST lines, rewards
  points, EFTPOS and change lines, and anything that is not food or a
  kitchen consumable.
- If a line is a discount applied to the line above, subtract it rather
  than listing it separately.

If this is not a receipt, return {"error": "not a receipt"}.`;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('missing authorization');

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: auth } = await userClient.auth.getUser();
    if (!auth?.user) throw new Error('invalid token');

    const { image_path, household_id } = await req.json();
    if (!image_path || !household_id) throw new Error('image_path and household_id required');

    // membership check under RLS before spending anything
    const { data: member } = await userClient
      .from('household_members')
      .select('household_id')
      .eq('household_id', household_id)
      .maybeSingle();
    if (!member) throw new Error('not your household');

    const { data: file, error: dlErr } = await admin
      .storage.from('recipe-images').download(image_path);
    if (dlErr || !file) throw new Error('could not read that image');

    const send = (cfg: Record<string, unknown>) =>
      fetch(`${ENDPOINT}?key=${GEMINI_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: PROMPT },
              {
                inline_data: {
                  mime_type: file.type || 'image/jpeg',
                  data: toBase64(await file.arrayBuffer()),
                },
              },
            ],
          }],
          generationConfig: cfg,
        }),
      });

    const config = { maxOutputTokens: 8192, responseMimeType: 'application/json' };
    let res = await send({ ...config, thinkingLevel: 'low' });
    if (res.status === 400) res = await send(config);

    for (let a = 0; a < 3 && res.status === 429; a++) {
      const body = await res.clone().text();
      if (/per day|daily|RequestsPerDay/i.test(body)) {
        throw new Error('Daily Gemini quota used up.');
      }
      await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, a)));
      res = await send({ ...config, thinkingLevel: 'low' });
    }
    if (!res.ok) throw new Error(`gemini ${res.status}`);

    const data = await res.json();
    let raw = data?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
    raw = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

    const parsed = JSON.parse(raw);
    if (parsed.error) throw new Error(parsed.error);

    const items = parsed.items ?? [];
    if (!items.length) throw new Error('no items found on that receipt');

    // one matching round trip for the lot
    const { data: matches } = await admin.rpc('match_ingredients_batch', {
      names: items.map((i: { name: string }) => i.name),
    });

    const byName = new Map<string, { id: string; score: number }>();
    for (const m of matches ?? []) {
      if (m.id && !byName.has(m.input)) byName.set(m.input, m);
    }

    const observations = [];
    const pantry = [];
    const unmatched: string[] = [];

    for (const item of items) {
      const hit = byName.get(item.name);
      if (!hit || hit.score < 0.4) { unmatched.push(item.raw_text ?? item.name); continue; }

      if (item.price != null) {
        observations.push({
          household_id,
          ingredient_id: hit.id,
          price: item.price,
          qty: item.qty,
          unit: item.unit,
          store: parsed.store,
          observed_at: parsed.date ? `${parsed.date}T12:00:00Z` : new Date().toISOString(),
        });
      }
      pantry.push({ ingredient_id: hit.id, qty: item.qty });
    }

    if (observations.length) {
      await admin.from('price_observations').insert(observations);
    }

    // stock what was bought
    for (const p of pantry) {
      await admin.rpc('set_pantry_qty', {
        hid: household_id, ing: p.ingredient_id, new_qty: p.qty ?? null,
      }).then(() => {}, () => {});
    }

    // tick anything on the active list that was just bought
    const bought = pantry.map((p) => p.ingredient_id);
    if (bought.length) {
      const { data: list } = await admin
        .from('shopping_lists')
        .select('id')
        .eq('household_id', household_id)
        .eq('status', 'active')
        .order('week_of', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (list) {
        await admin.from('list_items')
          .update({ checked_at: new Date().toISOString() })
          .eq('list_id', list.id)
          .in('ingredient_id', bought)
          .is('checked_at', null);
      }
    }

    return new Response(JSON.stringify({
      store: parsed.store,
      date: parsed.date,
      total: parsed.total,
      matched: pantry.length,
      priced: observations.length,
      unmatched,
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
