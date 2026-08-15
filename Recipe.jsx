import { useEffect, useState } from 'react';
import { getRecipe, deleteRecipe } from '../lib/supabase';

export default function Recipe({ id, go }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [servings, setServings] = useState(null);

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

  const bySection = new Map();
  for (const ing of ingredients) {
    const key = ing.section_id ?? 'none';
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key).push(ing);
  }

  const ordered = sections.length
    ? sections
    : [{ id: 'none', name: 'Ingredients' }];

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
          {recipe.tags?.includes('title-inferred') && ' · title guessed'}
        </p>
        {recipe.steps_origin !== 'extracted' && (
          <span className="badge badge-reconstructed" style={{ marginTop: 8 }}>
            {recipe.steps_origin === 'partial' ? 'Steps partly reconstructed' : 'Steps reconstructed'}
          </span>
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
                  {ing.raw_text}
                  {!ing.ingredient_id && <span className="ingredient-flag">unmatched</span>}
                  {ing.ingredient_id && ing.match_confidence < 0.75 &&
                    <span className="ingredient-flag">check</span>}
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

function round(n) {
  if (n >= 100) return Math.round(n / 5) * 5;
  if (n >= 10) return Math.round(n);
  return Math.round(n * 10) / 10;
}
