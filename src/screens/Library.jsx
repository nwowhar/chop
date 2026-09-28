import { useEffect, useState } from 'react';
import { listRecipes, getWeeklyPick, generateRecipe } from '../lib/supabase';

const THEMES = [
  ['all',          'All'],
  ['high-protein', 'High protein'],
  ['pre-training', 'Pre-training'],
  ['vegetarian',   'Vegetarian'],
  ['quick',        'Under 30 min'],
  ['crowd',        'Feeds a crowd'],
];

export default function Library({ household, go, onAdd }) {
  const [recipes, setRecipes] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [picks, setPicks] = useState(null);
  const [adding, setAdding] = useState(null);

  useEffect(() => {
    listRecipes().then(setRecipes).catch((e) => setError(e.message));
    getWeeklyPick(household.id).then(setPicks).catch(() => setPicks([]));
  }, [household.id]);

  async function tryPick(s) {
    setAdding(s.title);
    try {
      const r = await generateRecipe(household.id, s.title, s.tags?.[0] ?? '');
      go(`/recipe/${r.recipe_id}`);
    } catch (e) { setError(e.message); setAdding(null); }
  }

  if (error) return <p className="error">{error}</p>;
  if (!recipes) return <p className="muted">Loading…</p>;

  if (!recipes.length) {
    return (
      <div className="empty">
        <p>Nothing in the library yet.</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
          <button className="btn btn-accent" onClick={onAdd}>Add a recipe</button>
        </div>
      </div>
    );
  }

  const shown = recipes
    .filter((r) => matches(r, filter))
    .filter((r) => !q.trim() || r.title.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="stack">
      <div className="row-between">
        <h1>Library</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input className="field" style={{ width: 200 }}
            placeholder={`Search ${recipes.length} recipes`}
            value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn btn-accent" onClick={onAdd}>+ Add</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {THEMES.map(([v, label]) => (
          <button key={v} className="chip" aria-pressed={filter === v}
            onClick={() => setFilter(v)}>{label}</button>
        ))}
      </div>

      {picks?.length > 0 && !q.trim() && filter === 'all' && (
        <section>
          <div className="cut-label">Worth a go this week</div>
          <div className="picks">
            {picks.map((s, i) => (
              <div className={`pick pick-c${i % 3}`} key={s.title}>
                <div>
                  <h3>{s.title}</h3>
                  <p className="pick-why">{s.why}</p>
                </div>
                <div className="pick-foot">
                  <span className="num">{s.minutes} min</span>
                  <button className="btn" onClick={() => tryPick(s)} disabled={!!adding}>
                    {adding === s.title ? 'Writing…' : 'Try it'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {shown.length === 0 ? (
        <p className="empty">Nothing matches that.</p>
      ) : (
        <div className="tiles">
          {shown.map((r, n) => (
            <button className="tile" key={r.id} onClick={() => go(`/recipe/${r.id}`)}>
              <div className={`tile-art tile-c${colour(r.id, n)}`}>
                {r.image_url
                  ? <img src={r.image_url} alt="" loading="lazy"
                      onError={(e) => { e.target.style.display = 'none'; }} />
                  : <span>{r.title.slice(0, 2).toUpperCase()}</span>}
                {r.tags?.includes('generated') && <span className="tile-flag">AI</span>}
              </div>
              <div className="tile-body">
                <span className="tile-title">{r.title}</span>
                <span className="tile-meta">
                  {r.servings ? `SERVES ${r.servings}` : 'SERVES —'}
                  {r.macros_per_serve?.protein_g
                    ? ` · ${Math.round(r.macros_per_serve.protein_g)}G PROTEIN` : ''}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Stable colour per recipe so tiles don't reshuffle on every render
function colour(id, n) {
  const c = id ? id.charCodeAt(0) + id.charCodeAt(id.length - 1) : n;
  return c % 4;
}

function matches(r, filter) {
  if (filter === 'all') return true;
  if (r.tags?.includes(filter)) return true;

  const m = r.macros_per_serve;
  if (!m) return false;
  if (filter === 'high-protein') return m.protein_g >= 30;
  if (filter === 'pre-training') {
    return m.carb_g >= 60 && m.fat_g <= 20 && (m.fibre_g ?? 0) <= 8;
  }
  return false;
}
