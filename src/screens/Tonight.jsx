import { useEffect, useState } from 'react';
import {
  getPlan, getRecipe, markCooked, getPantry, cookFromStock,
  mondayOf, isoDate,
} from '../lib/supabase';

// The front page answers the question actually being asked at
// 5pm on a Tuesday: what am I cooking tonight. Everything else
// is one tap away.

export default function Tonight({ household, go, onAdd }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    try {
      const today = isoDate(new Date());
      const plan = await getPlan(household.id, mondayOf());
      const mine = plan.filter((m) => m.date === today);

      let detail = null;
      if (mine.length) detail = await getRecipe(mine[0].recipe_id);

      let ready = [];
      if (!mine.length) {
        const pantry = await getPantry(household.id);
        const ids = pantry.map((p) => p.ingredient_id);
        if (ids.length) {
          ready = (await cookFromStock(household.id, ids))
            .filter((r) => r.make_tonight).slice(0, 4);
        }
      }

      const rest = plan
        .filter((m) => m.date > today && !m.cooked_at)
        .slice(0, 3);

      setState({ meal: mine[0] ?? null, detail, ready, rest });
    } catch (e) { setError(e.message); }
  }

  useEffect(() => { load(); }, [household.id]);

  if (error) return <p className="error">{error}</p>;
  if (!state) return <p className="muted">Loading…</p>;

  const { meal, detail, ready, rest } = state;
  const missing = detail
    ? detail.ingredients.filter(
        (i) => i.ingredient_id && i.stock?.stock === 'none' && !i.is_topping)
    : [];

  return (
    <div className="stack">
      <div>
        <span className="eyebrow">{dayName()}</span>
        <h1>{meal ? 'Tonight' : 'Nothing planned'}</h1>
      </div>

      {meal ? (
        <div className="hero">
          {detail?.recipe?.image_url && (
            <img className="hero-img" src={detail.recipe.image_url} alt=""
              onError={(e) => { e.target.style.display = 'none'; }} />
          )}

          <div className="hero-body">
            <h2>{meal.recipes?.title}</h2>

            <p className="hero-sub">
              {detail?.recipe?.servings ? `Serves ${detail.recipe.servings}` : ''}
              {detail?.steps?.length ? ` · ${detail.steps.length} steps` : ''}
              {detail?.recipe?.macros_per_serve?.protein_g
                ? ` · ${Math.round(detail.recipe.macros_per_serve.protein_g)}g protein`
                : ''}
            </p>

            {missing.length > 0 ? (
              <p className="hero-warn">
                Missing {missing.map((i) => i.ingredients?.canonical_name).join(', ')}
              </p>
            ) : (
              <p className="hero-ok">You have everything</p>
            )}

            <div className="hero-actions">
              {meal.cooked_at ? (
                <span className="badge">Cooked</span>
              ) : (
                <>
                  <button className="btn btn-accent"
                    onClick={() => go(`/cook/${meal.recipe_id}`)}>Start cooking</button>
                  <button className="btn btn-quiet"
                    onClick={() => go(`/recipe/${meal.recipe_id}`)}>The recipe</button>
                  <button className="btn btn-quiet"
                    onClick={async () => { await markCooked(meal.id); load(); }}>
                    Already done
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          {ready.length > 0 ? (
            <>
              <p className="muted">
                Nothing on the board for tonight, but you have everything for these.
              </p>
              <div className="list">
                {ready.map((r) => (
                  <div className="row" key={r.recipe_id}
                    onClick={() => go(`/recipe/${r.recipe_id}`)}>
                    <div className="row-name">{r.title}</div>
                    <span className="badge badge-hot">ready</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="card card-pad hatch">
              <strong>Nothing planned and not much in the kitchen.</strong>
              <p className="muted" style={{ margin: '4px 0 12px' }}>
                Plan the week and the shopping list writes itself.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-accent" onClick={() => go('/week')}>
                  Plan the week
                </button>
                <button className="btn" onClick={onAdd}>Add a recipe</button>
              </div>
            </div>
          )}
        </>
      )}

      {rest.length > 0 && (
        <section>
          <div className="cut-label">Coming up</div>
          <div className="list">
            {rest.map((m) => (
              <div className="row" key={m.id} onClick={() => go(`/recipe/${m.recipe_id}`)}>
                <div className="row-name">
                  {m.recipes?.title}
                  <span className="row-sub">{weekday(m.date)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <button className="btn btn-quiet" onClick={() => go('/week')}>
        See the whole week →
      </button>
    </div>
  );
}

function dayName() {
  return new Date().toLocaleDateString('en-AU',
    { weekday: 'long', day: 'numeric', month: 'long' });
}

function weekday(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-AU', { weekday: 'long' });
}
