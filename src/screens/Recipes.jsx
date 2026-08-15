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

  useEffect(() => {
    listRecipes().then(setRecipes).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!recipes) return <p className="muted">Loading…</p>;

  const shown = recipes.filter((r) => matches(r, filter));

  if (!recipes.length) {
    return (
      <div className="empty">
        <p>No recipes yet.</p>
        <button className="btn btn-primary" onClick={() => go('/import')}>
          Import your first
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row-between">
        <h1>Recipes</h1>
        <span className="num">{shown.length}</span>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {THEMES.map(([v, label]) => (
          <button key={v} className="chip" aria-pressed={filter === v}
            onClick={() => setFilter(v)}>{label}</button>
        ))}
      </div>

      {shown.length === 0 && (
        <p className="empty">Nothing matches that filter yet.</p>
      )}

      <div className="list">
        {shown.map((r) => (
          <div className="row" key={r.id} onClick={() => go(`/recipe/${r.id}`)}>
            <div className="row-name">
              {r.title}
              <span className="row-sub">
                {r.source_handle ? `@${r.source_handle}` : (r.tags?.includes('generated') ? 'Generated' : 'Imported')}
                {r.servings ? ` · serves ${r.servings}` : ''}
                {r.macros_per_serve?.protein_g
                  ? ` · ${Math.round(r.macros_per_serve.protein_g)}g protein`
                  : ''}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Themes are computed from the estimated macros where possible,
// and fall back to the tag the recipe was created with.
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
