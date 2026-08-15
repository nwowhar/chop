import { useEffect, useState } from 'react';
import { getRecipe, deleteRecipe, addRecipeToList } from '../lib/supabase';

export default function Recipe({ id, household, go }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [servings, setServings] = useState(null);
  const [added, setAdded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getRecipe(id)
      .then((d) => { setData(d); setServings(d.recipe.servings ?? null); })
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const { recipe, sections, ingredients, steps } = data;
  const base = recipe.servings || 1;
  const scale = servings ? servings / base : 1;
  const m = recipe.macros_per_serve;

  const missing = ingredients.filter(
    (i) => i.ingredient_id && i.stock?.stock === 'none' && !i.is_topping
  );
  const partial = ingredients.filter((i) => i.stock?.stock === 'partial');

  const bySection = new Map();
  for (const ing of ingredients) {
    const key = ing.section_id ?? 'none';
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key).push(ing);
  }
  const ordered = sections.length ? sections : [{ id: 'none', name: 'Ingredients' }];

  async function toList() {
    setBusy(true);
    try { await addRecipeToList(household.id, id); setAdded(true); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm('Delete this recipe?')) return;
    await deleteRecipe(id);
    go('/');
  }

  return (
    <div className="stack">
      <button className="btn btn-quiet" style={{ alignSelf: 'flex-start' }}
        onClick={() => go('/')}>← Recipes</button>

      <div>
        <h1>{recipe.title}</h1>
        <p className="muted">
          {recipe.source_handle ? `@${recipe.source_handle}` : 'Imported'}
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {recipe.tags?.includes('generated') && (
            <span className="badge badge-reconstructed">Generated</span>
          )}
          {recipe.tags?.includes('title-inferred') && (
            <span className="badge">Title guessed</span>
          )}
          {recipe.steps_origin !== 'extracted' && (
            <span className="badge badge-reconstructed">
              {recipe.steps_origin === 'partial'
                ? 'Steps partly reconstructed'
                : 'Steps reconstructed'}
            </span>
          )}
        </div>
      </div>

      {m && (
        <div className="card card-pad">
          <span className="eyebrow">Per serving</span>
          <div style={{ display: 'flex', gap: 18, marginTop: 10, flexWrap: 'wrap' }}>
            <Macro label="kcal"    value={m.kcal} />
            <Macro label="protein" value={m.protein_g} unit="g" />
            <Macro label="carbs"   value={m.carb_g} unit="g" />
            <Macro label="fat"     value={m.fat_g} unit="g" />
          </div>
          <p className="tiny" style={{ marginTop: 10 }}>Estimated, not measured.</p>
        </div>
      )}

      <div className="card card-pad stack-s">
        <div className="row-between">
          <span className="eyebrow">In your kitchen</span>
          <span className="num">
            {ingredients.length - missing.length}/{ingredients.length}
          </span>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          {missing.length === 0
            ? 'You have everything for this.'
            : `Missing ${missing.map((i) => i.ingredients?.canonical_name).join(', ')}.`}
          {partial.length > 0 &&
            ` Running low on ${partial.map((i) => i.ingredients?.canonical_name).join(', ')}.`}
        </p>
        {missing.length > 0 && (
          <button className="btn btn-accent btn-block" onClick={toList}
            disabled={busy || added}>
            {added ? 'Added to shopping list'
              : busy ? 'Adding…'
              : `Add ${missing.length} to shopping list`}
          </button>
        )}
      </div>

      {recipe.servings && (
        <div className="row-between card card-pad">
          <span>Servings</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn btn-quiet"
              onClick={() => setServings((s) => Math.max(1, (s ?? base) - 1))}>−</button>
            <span className="num-lg">{servings ?? base}</span>
            <button className="btn btn-quiet"
              onClick={() => setServings((s) => (s ?? base) + 1)}>+</button>
          </span>
        </div>
      )}

      {ordered.map((sec) => {
        const rows = bySection.get(sec.id) ?? [];
        if (!rows.length) return null;
        return (
          <section key={sec.id}>
            <div className="cut-label">{sec.name}</div>
            {rows.map((ing) => (
              <div className="ingredient" key={ing.id}>
                <span>
                  <StockDot stock={ing.stock?.stock} />
                  {ing.raw_text}
                  {!ing.ingredient_id && <span className="ingredient-flag">unmatched</span>}
                </span>
                {ing.qty != null && scale !== 1 && (
                  <span className="num">{round(ing.qty * scale)} {ing.unit}</span>
                )}
              </div>
            ))}
          </section>
        );
      })}

      {steps.length > 0 && (
        <section>
          <div className="cut-label">Method</div>
          {steps.map((s) => (
            <div className="step" key={s.step_no}>
              <span className="step-no">{String(s.step_no).padStart(2, '0')}</span>
              <span>{s.text}</span>
            </div>
          ))}
        </section>
      )}

      <hr className="cut" />
      <button className="btn btn-quiet" onClick={remove}
        style={{ alignSelf: 'flex-start', color: 'var(--alert)' }}>Delete recipe</button>
    </div>
  );
}

function StockDot({ stock }) {
  const map = {
    have:    { c: 'var(--green)',     t: 'You have this' },
    partial: { c: 'var(--amber)',     t: 'Running low' },
    none:    { c: 'var(--line-firm)', t: "You don't have this" },
  };
  const s = map[stock];
  if (!s) return null;
  return (
    <span title={s.t} aria-label={s.t}
      style={{
        display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
        background: s.c, marginRight: 9, verticalAlign: 'middle',
      }} />
  );
}

function Macro({ label, value, unit = '' }) {
  if (value == null) return null;
  return (
    <span style={{ display: 'flex', flexDirection: 'column' }}>
      <span className="num-lg">{Math.round(value)}{unit}</span>
      <span className="tiny">{label}</span>
    </span>
  );
}

function round(n) {
  if (n >= 100) return Math.round(n / 5) * 5;
  if (n >= 10) return Math.round(n);
  return Math.round(n * 10) / 10;
}
