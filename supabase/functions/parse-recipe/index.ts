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
import { EXTRACTION_PROMPT, RECONSTRUCTION_PROMPT } from '../_shared/prompts.ts';

const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY')!;
const MODEL = 'gemini-2.0-flash';
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

async function callGemini(parts: unknown[], temperature = 0.1): Promise<string> {
  const res = await fetch(`${ENDPOINT}?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    }),
  });

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
      .select('id, household_id, image_paths, status')
      .eq('id', jobId)
      .single();

    if (jobErr || !job) throw new Error('job not found or not permitted');
    if (job.status === 'saved') throw new Error('job already saved');

    await admin.from('import_jobs').update({ status: 'parsing' }).eq('id', jobId);

    // ---- pass 1: vision
    const parts: unknown[] = [{ text: EXTRACTION_PROMPT }];

    for (const path of job.image_paths) {
      const { data: file, error: dlErr } = await admin
        .storage.from('recipe-images').download(path);
      if (dlErr || !file) throw new Error(`could not read ${path}`);

      parts.push({
        inline_data: {
          mime_type: file.type || 'image/png',
          data: toBase64(await file.arrayBuffer()),
        },
      });
    }

    const parsed = parseJson<ParsedRecipe>(await callGemini(parts));

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
Title: ${parsed.title ?? 'unknown'}
Servings: ${parsed.servings ?? 'unknown'}
Ingredients: ${JSON.stringify(flat)}
Existing steps: ${parsed.steps?.length ? JSON.stringify(parsed.steps) : 'none'}`,
      }], 0.3);

      const out = parseJson<{ steps: ParsedRecipe['steps'] }>(recon);
      if (out.steps?.length) parsed.steps = out.steps;
    }

    // ---- pass 3: canonical matching
    const unmatched: string[] = [];

    for (const section of parsed.sections) {
      for (const ing of section.ingredients) {
        const { data: hits } = await admin.rpc('match_ingredient', {
          q: ing.name, min_score: MATCH_FLAG,
        });

        const best = hits?.[0];
        // deno-lint-ignore no-explicit-any
        const row = ing as any;

        if (best && best.score >= MATCH_FLAG) {
          row.ingredient_id = best.id;
          row.match_confidence = best.score;
          row.matched_name = best.canonical_name;
          row.needs_review = best.score < MATCH_AUTO;
        } else {
          row.ingredient_id = null;
          row.match_confidence = null;
          row.needs_review = true;
          unmatched.push(ing.name);
        }
      }
    }

    for (const name of unmatched) {
      await admin.from('ingredient_review_queue')
        .insert({ raw_text: name, resolved: false });
    }

    // ---- write the recipe
    const { data: recipe, error: recErr } = await admin
      .from('recipes')
      .insert({
        household_id: job.household_id,
        title: parsed.title ?? 'Untitled recipe',
        servings: parsed.servings,
        source_type: 'instagram',
        source_handle: parsed.source_handle,
        image_path: job.image_paths[0],
        steps_origin: stepsOrigin,
        tags: parsed.title_inferred ? ['title-inferred'] : [],
      })
      .select('id')
      .single();

    if (recErr || !recipe) throw new Error(`recipe insert failed: ${recErr?.message}`);

    for (const [idx, section] of parsed.sections.entries()) {
      const { data: sec } = await admin
        .from('recipe_sections')
        .insert({ recipe_id: recipe.id, name: section.name, sort_order: idx })
        .select('id')
        .single();

      const rows = section.ingredients.map((ing, i) => {
        // deno-lint-ignore no-explicit-any
        const r = ing as any;
        return {
          recipe_id: recipe.id,
          section_id: sec?.id ?? null,
          ingredient_id: r.ingredient_id,
          raw_text: ing.raw_text,
          qty: ing.qty,
          unit: ing.unit,
          optional: ing.optional ?? false,
          is_topping: ing.is_topping ?? false,
          match_confidence: r.match_confidence,
          sort_order: i,
        };
      });

      if (rows.length) await admin.from('recipe_ingredients').insert(rows);
    }

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
