import { useEffect, useState } from 'react';
import { listRecipes } from '../lib/supabase';

export default function Recipes({ go }) {
  const [recipes, setRecipes] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    listRecipes().then(setRecipes).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!recipes) return <p className="muted">Loading…</p>;

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
        <span className="num">{recipes.length}</span>
      </div>

      <div className="list">
        {recipes.map((r) => (
          <div className="row" key={r.id} onClick={() => go(`/recipe/${r.id}`)}>
            <div className="row-name">
              {r.title}
              <span className="row-sub">
                {r.source_handle ? `@${r.source_handle}` : 'Imported'}
                {r.servings ? ` · serves ${r.servings}` : ''}
                {r.steps_origin !== 'extracted' ? ' · reconstructed' : ''}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
