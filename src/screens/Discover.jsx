import { useState } from 'react';
import { suggestRecipes, searchRecipes, generateRecipe, planMeal, mondayOf, isoDate } from '../lib/supabase';

const EXAMPLES = [
  'High protein, under 30 minutes',
  'Sticky bbq ribs',
  'Something with mince and rice',
  'Big carb load before a long ride',
  'Vegetarian, feeds six',
];

export default function Discover({ household, go }) {
  const [query, setQuery] = useState('');
  const [mine, setMine] = useState([]);
  const [suggestions, setSuggestions] = useState(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(null);

  async function run(q = query) {
    if (!q.trim()) return;
    setQuery(q);
    setBusy(true); setError(null); setSuggestions(null); setMine([]);

    try {
      const [own, sug] = await Promise.all([
        searchRecipes(q),
        suggestRecipes(q),
      ]);
      setMine(own);
      setSuggestions(sug);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function loadMore() {
    setMore(true);
    try {
      const next = await suggestRecipes(query, suggestions.map((s) => s.title));
      setSuggestions((s) => [...s, ...next]);
    } catch (e) { setError(e.message); }
    finally { setMore(false); }
  }

  async function add(sug, thenPlan) {
    setAdding(sug.title); setError(null);
    try {
      const theme = sug.tags?.[0] ?? '';
      const result = await generateRecipe(household.id, sug.title, theme);
      if (thenPlan) {
        const d = mondayOf();
        await planMeal(household.id, isoDate(d), result.recipe_id, null);
      }
      go(`/recipe/${result.recipe_id}`);
    } catch (e) {
      setError(e.message);
      setAdding(null);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>Find a recipe</h1>
        <p className="muted">
          Describe what you feel like, or name a dish.
        </p>
      </div>

      <div className="searchbar">
        <input className="field" placeholder="High protein dinners under 30 minutes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()} />
        <button className="btn btn-accent" onClick={() => run()} disabled={busy}>
          {busy ? 'Looking…' : 'Search'}
        </button>
      </div>

      {!suggestions && !busy && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {EXAMPLES.map((e) => (
            <button key={e} className="chip" onClick={() => run(e)}>{e}</button>
          ))}
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {busy && (
        <div className="card card-pad" style={{ background: 'var(--amber-wash)' }}>
          <span className="eyebrow" style={{ color: 'var(--on-amber)' }}>Thinking</span>
          <p className="muted" style={{ margin: '6px 0 0' }}>Finding five that fit…</p>
        </div>
      )}

      {mine.length > 0 && (
        <section>
          <div className="cut-label">Already in your library</div>
          <div className="list">
            {mine.map((r) => (
              <div className="row" key={r.id} onClick={() => go(`/recipe/${r.id}`)}>
                <div className="row-name">
                  {r.title}
                  <span className="row-sub">
                    {r.macros_per_serve?.protein_g
                      ? `${Math.round(r.macros_per_serve.protein_g)}g protein`
                      : 'Saved'}
                  </span>
                </div>
                <span className="num">open</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {suggestions && suggestions.length > 0 && (
        <section>
          <div className="cut-label">Suggestions</div>
          <div className="stack-s">
            {suggestions.map((s) => (
              <div className="card card-pad suggestion" key={s.title}>
                <div className="row-between" style={{ alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <h3>{s.title}</h3>
                    <p className="muted" style={{ margin: '2px 0 0' }}>{s.why}</p>
                  </div>
                  <span className="num" style={{ whiteSpace: 'nowrap' }}>
                    {s.minutes} min
                  </span>
                </div>

                <div className="suggestion-meta">
                  {s.protein_g != null && <span className="badge">{s.protein_g}g protein</span>}
                  {s.kcal != null && <span className="badge">{s.kcal} kcal</span>}
                  {s.tags?.map((t) => <span className="badge" key={t}>{t.replace('-', ' ')}</span>)}
                </div>

                <div className="suggestion-actions">
                  <button className="btn btn-primary" onClick={() => add(s, false)}
                    disabled={!!adding}>
                    {adding === s.title ? 'Writing…' : 'Add to library'}
                  </button>
                  <button className="btn btn-quiet" onClick={() => add(s, true)}
                    disabled={!!adding}>
                    Add to this week
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button className="btn btn-block" style={{ marginTop: 'var(--s-4)' }}
            onClick={loadMore} disabled={more}>
            {more ? 'Finding more…' : 'Show five more'}
          </button>
        </section>
      )}

      {suggestions && suggestions.length === 0 && !busy && (
        <p className="empty">Nothing came back for that. Try describing it differently.</p>
      )}
    </div>
  );
}
