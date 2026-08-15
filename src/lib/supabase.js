import { createClient } from '@supabase/supabase-js';
import { shrink } from './shrink';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(url, key);

// ---------------------------------------------------------------
// Household
//
// Create and join go through SECURITY DEFINER functions. Doing it
// client-side fails RLS: the row has to exist before you can be a
// member of it, but the read policy requires membership. The
// function does both in one transaction.
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
}

export async function joinHousehold(code) {
  const { data, error } = await supabase.rpc('join_household', { p_code: code });
  if (error) throw error;
  return data[0];
}

// ---------------------------------------------------------------
// Import
// ---------------------------------------------------------------

export async function uploadImages(householdId, files) {
  const paths = [];

  // Shrink first, then upload in parallel. A full-size iPhone
  // screenshot is ~1.5 MB; shrunk it's under 150 KB.
  const shrunk = await Promise.all(files.map(shrink));

  const uploads = shrunk.map(async (file) => {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${householdId}/${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage
      .from('recipe-images')
      .upload(path, file, { contentType: file.type || 'image/jpeg' });

    if (error) throw new Error(`Upload failed: ${error.message}`);
    return path;
  });

  paths.push(...await Promise.all(uploads));

  return paths;
}

export async function createImportJob(householdId, imagePaths, hint) {
  const { data: user } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('import_jobs')
    .insert({
      household_id: householdId,
      created_by: user.user.id,
      image_paths: imagePaths,
      hint: hint?.trim() || null,
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

// Kick the function off and watch the job row rather than holding
// the HTTP connection open. A parse can outlast the request, and a
// dropped connection used to look like a failure even when the
// function had finished fine.
export async function runParse(jobId, onStage) {
  supabase.functions
    .invoke('parse-recipe', { body: { job_id: jobId } })
    .catch(() => { /* the job row is the source of truth */ });

  return await watchJob(jobId, onStage);
}

function watchJob(jobId, onStage) {
  return new Promise((resolve, reject) => {
    let done = false;
    let channel = null;

    const finish = (fn, arg) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(bail);
      if (channel) supabase.removeChannel(channel);
      fn(arg);
    };

    const check = async () => {
      const { data } = await supabase
        .from('import_jobs')
        .select('status, stage, error, recipe_id, parsed')
        .eq('id', jobId)
        .maybeSingle();

      if (!data) return;
      if (data.stage && onStage) onStage(data.stage);

      if (data.status === 'failed') {
        finish(reject, new Error(data.error || 'Import failed'));
      } else if (data.status === 'review' || data.status === 'saved') {
        const p = data.parsed ?? {};
        finish(resolve, {
          recipe_id: data.recipe_id,
          title: p.title,
          title_inferred: p.title_inferred,
          steps_origin: p.steps_origin,
          sections: p.sections?.length ?? 0,
          ingredients: p.sections?.reduce((n, s) => n + s.ingredients.length, 0) ?? 0,
          unmatched: [],
        });
      }
    };

    channel = supabase
      .channel(`job-${jobId}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'import_jobs', filter: `id=eq.${jobId}` },
        check)
      .subscribe();

    // Realtime can miss an update; poll as a backstop.
    const poll = setInterval(check, 2500);
    const bail = setTimeout(
      () => finish(reject, new Error('Timed out. Check the Import list in a moment.')),
      180000);

    check();
  });
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

// ---------------------------------------------------------------
// Meal plan
// ---------------------------------------------------------------

export function mondayOf(d = new Date()) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function getPlan(householdId, weekOf) {
  const start = isoDate(weekOf);
  const end = new Date(weekOf);
  end.setDate(end.getDate() + 7);

  const { data, error } = await supabase
    .from('meal_plan')
    .select('id, date, slot, servings, cooked_at, recipe_id, recipes(id, title, servings)')
    .eq('household_id', householdId)
    .gte('date', start)
    .lt('date', isoDate(end))
    .order('date');

  if (error) throw error;
  return data;
}

export async function planMeal(householdId, date, recipeId, servings) {
  const { error } = await supabase.from('meal_plan').insert({
    household_id: householdId, date, slot: 'dinner',
    recipe_id: recipeId, servings,
  });
  if (error) throw error;
}

export async function unplanMeal(id) {
  const { error } = await supabase.from('meal_plan').delete().eq('id', id);
  if (error) throw error;
}

export async function markCooked(id) {
  const { error } = await supabase
    .from('meal_plan')
    .update({ cooked_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------
// Shopping list
// ---------------------------------------------------------------

export async function buildList(householdId, weekOf) {
  const { data, error } = await supabase.rpc('build_shopping_list', {
    hid: householdId, wk: isoDate(weekOf),
  });
  if (error) throw error;
  return data;
}

export async function getList(householdId, weekOf) {
  const { data: list, error } = await supabase
    .from('shopping_lists')
    .select('id, week_of, status')
    .eq('household_id', householdId)
    .eq('week_of', isoDate(weekOf))
    .maybeSingle();

  if (error) throw error;
  if (!list) return null;

  const { data: items } = await supabase
    .from('list_items')
    .select('*, ingredients(canonical_name, category, default_unit)')
    .eq('list_id', list.id);

  return { list, items: items ?? [] };
}

export async function toggleItem(itemId, checked) {
  const { data: user } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('list_items')
    .update({
      checked_at: checked ? new Date().toISOString() : null,
      checked_by: checked ? user.user.id : null,
    })
    .eq('id', itemId);
  if (error) throw error;
}

export async function addManualItem(listId, label) {
  const { error } = await supabase.from('list_items').insert({
    list_id: listId, label, manual: true, is_check_only: true,
  });
  if (error) throw error;
}

export function subscribeList(listId, onChange) {
  return supabase
    .channel(`list-${listId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'list_items', filter: `list_id=eq.${listId}` },
      onChange)
    .subscribe();
}

// ---------------------------------------------------------------
// Pantry
// ---------------------------------------------------------------

export async function getPantry(householdId) {
  const { data, error } = await supabase
    .from('pantry_view')
    .select('*')
    .eq('household_id', householdId)
    .eq('in_stock', true)
    .order('category');
  if (error) throw error;
  return data;
}

export async function setStock(householdId, ingredientId, inStock) {
  const { error } = await supabase.from('pantry_items').upsert({
    household_id: householdId,
    ingredient_id: ingredientId,
    in_stock: inStock,
    added_at: new Date().toISOString(),
    confidence: 'confirmed',
  });
  if (error) throw error;
}

export async function searchIngredients(q) {
  if (!q.trim()) return [];
  const { data, error } = await supabase
    .from('ingredients')
    .select('id, canonical_name, category, is_staple, default_unit')
    .ilike('canonical_name', `%${q.trim()}%`)
    .limit(10);
  if (error) throw error;
  return data;
}

export async function cookFromStock(householdId, selectedIds) {
  const { data, error } = await supabase.rpc('cook_from_stock', {
    hid: householdId, selected: selectedIds, max_results: 20,
  });
  if (error) throw error;
  return data;
}
