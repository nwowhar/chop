import { useEffect, useMemo, useState } from 'react';
import {
  getPlan, planMeal, unplanMeal, markCooked,
  listRecipes, getPantry, cookFromStock, mondayOf, isoDate,
} from '../lib/supabase';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const FILTERS = [
  ['all',          'All'],
  ['ready',        'Nothing missing'],
  ['high-protein', 'High protein'],
  ['pre-training', 'Pre-training'],
  ['vegetarian',   'Vegetarian'],
  ['quick',        'Quick'],
];

export default function Plan({ household, go }) {
  const [weekOf, setWeekOf] = useState(mondayOf());
  const [plan, setPlan] = useState(null);
  const [recipes, setRecipes] = useState([]);
  const [ready, setReady] = useState(new Set());
  const [picking, setPicking] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState(null);

  async function load() {
    try {
      const [p, r] = await Promise.all([getPlan(household.id, weekOf), listRecipes()]);
      setPlan(p);
      setRecipes(r);
    } catch (e) { setError(e.message); }
  }

  useEffect(() => { load(); }, [weekOf]);

  // which recipes need no shopping — used by the filter and by
  // surprise me, which prefers something you can cook right now
  useEffect(() => {
    (async () => {
      try {
        const pantry = await getPantry(household.id);
        const ids = pantry.map((p) => p.ingredient_id);
        if (!ids.length) return;
        const rows = await cookFromStock(household.id, ids);
        setReady(new Set(rows.filter((r) => r.make_tonight).map((r) => r.recipe_id)));
      } catch { /* not fatal */ }
    })();
  }, [household.id]);

  const days = DAYS.map((label, i) => {
    const d = new Date(weekOf);
    d.setDate(d.getDate() + i);
    return { label, short: label.slice(0, 3), date: isoDate(d), dayNum: d.getDate() };
  });

  const planned = useMemo(
    () => new Set((plan ?? []).map((m) => m.recipe_id)),
    [plan]);

  const candidates = useMemo(() => recipes.filter((r) => {
    if (q.trim() && !r.title.toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (filter === 'all') return true;
    if (filter === 'ready') return ready.has(r.id);
    if (r.tags?.includes(filter)) return true;
    const m = r.macros_per_serve;
    if (!m) return false;
    if (filter === 'high-protein') return m.protein_g >= 30;
    if (filter === 'pre-training') return m.carb_g >= 60 && m.fat_g <= 20 && (m.fibre_g ?? 0) <= 8;
    return false;
  }), [recipes, q, filter, ready]);

  async function add(recipeId) {
    await planMeal(household.id, picking, recipeId, null);
    setPicking(null); setQ('');
    load();
  }

  // Prefer something you can cook without shopping, and that isn't
  // already on the board this week. Fall back gracefully.
  function surprise() {
    const pool = candidates.filter((r) => !planned.has(r.id));
    const best = pool.filter((r) => ready.has(r.id));
    const from = best.length ? best : pool.length ? pool : candidates;
    if (!from.length) return;
    add(from[Math.floor(Math.random() * from.length)].id);
  }

  if (error) return <p className="error">{error}</p>;
  if (!plan) return <p className="muted">Loading…</p>;

  if (picking) {
    const day = days.find((d) => d.date === picking);
    return (
      <div className="stack">
        <button className="btn btn-quiet" style={{ alignSelf: 'flex-start' }}
          onClick={() => { setPicking(null); setQ(''); }}>← Back</button>

        <div className="row-between">
          <h2>{day?.label}</h2>
          <button className="btn btn-accent" onClick={surprise}
            disabled={!candidates.length}>Surprise me</button>
        </div>

        <input className="field" placeholder={`Search ${recipes.length} recipes`}
          value={q} autoFocus onChange={(e) => setQ(e.target.value)} />

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map(([v, label]) => (
            <button key={v} className="chip" aria-pressed={filter === v}
              onClick={() => setFilter(v)}>{label}</button>
          ))}
        </div>

        {candidates.length === 0 ? (
          <div className="empty">
            <p>Nothing matches.</p>
            <button className="btn btn-primary" onClick={() => go('/discover')}>
              Find something new
            </button>
          </div>
        ) : (
          <div className="list">
            {candidates.map((r) => (
              <div className="row" key={r.id} onClick={() => add(r.id)}>
                <div className="row-name">
                  {r.title}
                  <span className="row-sub">
                    {r.servings ? `Serves ${r.servings}` : 'Serves —'}
                    {r.macros_per_serve?.protein_g
                      ? ` · ${Math.round(r.macros_per_serve.protein_g)}g protein` : ''}
                    {planned.has(r.id) ? ' · already this week' : ''}
                  </span>
                </div>
                {ready.has(r.id) && <span className="badge badge-hot">ready</span>}
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
        <h1>The week</h1>
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
        const today = d.date === isoDate(new Date());
        return (
          <div key={d.date}>
            <div className="cut-label">
              {d.label} {d.dayNum}{today ? ' · today' : ''}
            </div>

            {meals.map((m) => (
              <div className="row" key={m.id} style={{ borderRadius: 'var(--r-md)' }}>
                <div className="row-name" onClick={() => go(`/recipe/${m.recipe_id}`)}>
                  {m.recipes?.title ?? 'Recipe'}
                  {m.cooked_at && <span className="row-sub">Cooked</span>}
                </div>
                {!m.cooked_at && (
                  <>
                    <button className="btn btn-quiet"
                      onClick={() => go(`/cook/${m.recipe_id}`)}>Cook</button>
                    <button className="btn btn-quiet"
                      onClick={async () => { await markCooked(m.id); load(); }}>Done</button>
                  </>
                )}
                <button className="btn btn-quiet" style={{ color: 'var(--ink-3)' }}
                  onClick={async () => { await unplanMeal(m.id); load(); }}>×</button>
              </div>
            ))}

            {meals.length === 0 && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-quiet"
                  style={{ justifyContent: 'flex-start', color: 'var(--ink-3)', flex: 1 }}
                  onClick={() => setPicking(d.date)}>+ Add dinner</button>
                <button className="btn btn-quiet" style={{ color: 'var(--ink-3)' }}
                  onClick={() => { setPicking(d.date); setTimeout(surprise, 0); }}
                  title="Pick one for me">✳</button>
              </div>
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
