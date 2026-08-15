import { useEffect, useState } from 'react';
import {
  getPlan, planMeal, unplanMeal, markCooked,
  listRecipes, mondayOf, isoDate,
} from '../lib/supabase';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function Plan({ household, go }) {
  const [weekOf, setWeekOf] = useState(mondayOf());
  const [plan, setPlan] = useState(null);
  const [recipes, setRecipes] = useState([]);
  const [picking, setPicking] = useState(null); // date string
  const [error, setError] = useState(null);

  async function load() {
    try {
      const [p, r] = await Promise.all([getPlan(household.id, weekOf), listRecipes()]);
      setPlan(p);
      setRecipes(r);
    } catch (e) { setError(e.message); }
  }

  useEffect(() => { load(); }, [weekOf]);

  const days = DAYS.map((label, i) => {
    const d = new Date(weekOf);
    d.setDate(d.getDate() + i);
    return { label, date: isoDate(d), dayNum: d.getDate() };
  });

  async function add(recipeId) {
    await planMeal(household.id, picking, recipeId, null);
    setPicking(null);
    load();
  }

  if (error) return <p className="error">{error}</p>;
  if (!plan) return <p className="muted">Loading…</p>;

  if (picking) {
    return (
      <div className="stack">
        <button className="btn btn-quiet" style={{ alignSelf: 'flex-start' }}
          onClick={() => setPicking(null)}>← Back</button>
        <h2>Pick a recipe</h2>
        {recipes.length === 0 ? (
          <p className="empty">No recipes yet. Import some first.</p>
        ) : (
          <div className="list">
            {recipes.map((r) => (
              <div className="row" key={r.id} onClick={() => add(r.id)}>
                <div className="row-name">
                  {r.title}
                  {r.servings && <span className="row-sub">Serves {r.servings}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row-between">
        <h1>This week</h1>
        <span style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn-quiet" onClick={() => shift(-7)}>←</button>
          <button className="btn btn-quiet" onClick={() => shift(7)}>→</button>
        </span>
      </div>

      <p className="muted">
        Week of {weekOf.toLocaleDateString('en-AU', { day: 'numeric', month: 'long' })}
      </p>

      {days.map((d) => {
        const meals = plan.filter((m) => m.date === d.date);
        return (
          <div key={d.date}>
            <div className="cut-label">{d.label} {d.dayNum}</div>
            {meals.map((m) => (
              <div className="row" key={m.id} style={{ borderRadius: 'var(--r-md)' }}>
                <div className="row-name" onClick={() => go(`/recipe/${m.recipe_id}`)}>
                  {m.recipes?.title ?? 'Recipe'}
                  {m.cooked_at && <span className="row-sub">Cooked</span>}
                </div>
                {!m.cooked_at && (
                  <button className="btn btn-quiet"
                    onClick={async () => { await markCooked(m.id); load(); }}>Cooked</button>
                )}
                <button className="btn btn-quiet" style={{ color: 'var(--ink-3)' }}
                  onClick={async () => { await unplanMeal(m.id); load(); }}>×</button>
              </div>
            ))}
            {meals.length === 0 && (
              <button className="btn btn-quiet btn-block"
                style={{ justifyContent: 'flex-start', color: 'var(--ink-3)' }}
                onClick={() => setPicking(d.date)}>+ Add dinner</button>
            )}
          </div>
        );
      })}
    </div>
  );

  function shift(days) {
    const d = new Date(weekOf);
    d.setDate(d.getDate() + days);
    setWeekOf(d);
    setPlan(null);
  }
}
