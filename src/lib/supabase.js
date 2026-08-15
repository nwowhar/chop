import { createClient } from '@supabase/supabase-js';

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
