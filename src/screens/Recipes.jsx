import { useEffect, useState } from 'react';
import { listRecipes } from '../lib/supabase';

const THEMES = [
  ['all',          'All'],
  ['high-protein', 'High protein'],
  ['pre-training', 'Pre-training'],
  ['vegetarian',   'Vegetarian'],
  ['quick',        'Under 30 min'],
  ['crowd',        'Feeds a crowd'],
];

export default function Recipes({ go }) {
  const [recipes, setRecipes] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');

  useEffect(() => {
    listRecipes().then(setRecipes).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!recipes) return <p className="muted">Loading…</p>;

  if (!recipes.length) {
    return (
      <div className="empty">
        <p>Nothing in the library yet.</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
          <button className="btn btn-accent" onClick={() => go('/discover')}>Find a recipe</button>
          <button className="btn" onClick={() => go('/import')}>Import a screenshot</button>
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
          <button className="btn btn-primary" onClick={() => go('/discover')}>Find</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {THEMES.map(([v, label]) => (
          <button key={v} className="chip" aria-pressed={filter === v}
            onClick={() => setFilter(v)}>{label}</button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="empty">Nothing matches that.</p>
      ) : (
        <div className="tiles">
          {shown.map((r, n) => (
            <button className="tile" key={r.id} onClick={() => go(`/recipe/${r.id}`)}>
              <div className={`tile-art tile-c${colour(r.id, n)}`}>
                <span>dish photo</span>
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
