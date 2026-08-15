import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(url, key);

// ---------------------------------------------------------------
// Household
// ---------------------------------------------------------------

export async function getHousehold() {
  const { data, error } = await supabase
    .from('household_members')
    .select('household_id, role, households(id, name, invite_code)')
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.households ?? null;
}

export async function createHousehold(name) {
  const { data, error } = await supabase.rpc('create_household', { p_name: name });
  if (error) throw error;
  return data[0];

  const { data: hh, error } = await supabase
    .from('households')
    .insert({ name })
    .select('id, name, invite_code')
    .single();
  if (error) throw error;

  const { error: memErr } = await supabase
    .from('household_members')
    .insert({ household_id: hh.id, user_id: user.user.id, role: 'owner' });
  if (memErr) throw memErr;

  return hh;
}

export async function joinHousehold(code) {
  const { data, error } = await supabase.rpc('join_household', { p_code: code });
  if (error) throw error;
  return data[0];

  const { data: hh, error } = await supabase
    .from('households')
    .select('id, name, invite_code')
    .eq('invite_code', code.trim().toLowerCase())
    .maybeSingle();

  if (error) throw error;
  if (!hh) throw new Error("That code doesn't match a household");

  const { error: memErr } = await supabase
    .from('household_members')
    .insert({ household_id: hh.id, user_id: user.user.id, role: 'member' });
  if (memErr) throw memErr;

  return hh;
}

// ---------------------------------------------------------------
// Import
// ---------------------------------------------------------------

export async function uploadImages(householdId, files) {
  const paths = [];

  for (const file of files) {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${householdId}/${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage
      .from('recipe-images')
      .upload(path, file, { contentType: file.type || 'image/png' });

    if (error) throw new Error(`Upload failed: ${error.message}`);
    paths.push(path);
  }

  return paths;
}

export async function createImportJob(householdId, imagePaths) {
  const { data: user } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('import_jobs')
    .insert({
      household_id: householdId,
      created_by: user.user.id,
      image_paths: imagePaths,
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

export async function runParse(jobId) {
  const { data, error } = await supabase.functions.invoke('parse-recipe', {
    body: { job_id: jobId },
  });
  if (error) {
    // the function returns useful detail in the body on 4xx
    let detail = error.message;
    try {
      const ctx = await error.context?.json();
      if (ctx?.error) detail = ctx.error;
    } catch { /* body wasn't json */ }
    throw new Error(detail);
  }
  return data;
}

// ---------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------

export async function listRecipes() {
  const { data, error } = await supabase
    .from('recipes')
    .select('id, title, servings, source_handle, steps_origin, tags, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getRecipe(id) {
  const { data: recipe, error } = await supabase
    .from('recipes')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;

  const { data: sections } = await supabase
    .from('recipe_sections')
    .select('id, name, sort_order')
    .eq('recipe_id', id)
    .order('sort_order');

  const { data: ingredients } = await supabase
    .from('recipe_ingredients')
    .select('*, ingredients(canonical_name, category)')
    .eq('recipe_id', id)
    .order('sort_order');

  const { data: steps } = await supabase
    .from('recipe_steps')
    .select('step_no, text, timer_seconds')
    .eq('recipe_id', id)
    .order('step_no');

  return { recipe, sections: sections ?? [], ingredients: ingredients ?? [], steps: steps ?? [] };
}

export async function deleteRecipe(id) {
  const { error } = await supabase.from('recipes').delete().eq('id', id);
  if (error) throw error;
}
