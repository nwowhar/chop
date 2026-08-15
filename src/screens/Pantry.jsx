import { useEffect, useState } from 'react';
import { getPantry, setStock, searchIngredients, cookFromStock } from '../lib/supabase';

export default function Pantry({ household, go }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [suggestions, setSuggestions] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setItems(await getPantry(household.id)); }
    catch (e) { setError(e.message); }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const t = setTimeout(() => {
      searchIngredients(q).then(setHits).catch(() => setHits([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  async function add(ing) {
    await setStock(household.id, ing.id, true);
    setQ(''); setHits([]); load();
  }

  async function remove(ingredientId) {
    await setStock(household.id, ingredientId, false);
    setSelected((s) => { const n = new Set(s); n.delete(ingredientId); return n; });
    load();
  }

  function toggleSelect(id) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
    setSuggestions(null);
  }

  async function suggest() {
    setBusy(true);
    try { setSuggestions(await cookFromStock(household.id, [...selected])); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (error) return <p className="error">{error}</p>;
  if (!items) return <p className="muted">Loading…</p>;

  const expiring = items.filter((i) => i.freshness === 'soon' || i.freshness === 'expired');
  const groups = groupBy(items, 'category');

  return (
    <div className="stack">
      <h1>Pantry</h1>

      <input className="field" placeholder="Add something you have"
        value={q} onChange={(e) => setQ(e.target.value)} />

      {hits.length > 0 && (
        <div className="list">
          {hits.map((h) => (
            <div className="row" key={h.id} onClick={() => add(h)}>
              <div className="row-name">{h.canonical_name}
                <span className="row-sub">{h.category}</span></div>
              <span className="num">add</span>
            </div>
          ))}
        </div>
      )}

      {expiring.length > 0 && (
        <div className="card card-pad">
          <span className="eyebrow">Use these up</span>
          <p className="muted" style={{ marginTop: 4 }}>
            {expiring.map((e) => e.canonical_name).join(', ')}
          </p>
          <button className="btn btn-block" style={{ marginTop: 12 }}
            onClick={() => {
              setSelected(new Set(expiring.map((e) => e.ingredient_id)));
              setSuggestions(null);
            }}>
            Select all {expiring.length}
          </button>
        </div>
      )}

      {items.length === 0 && (
        <p className="empty">
          Nothing in the pantry yet. Tick items off a shopping list and they land here.
        </p>
      )}

      {Object.entries(groups).map(([cat, rows]) => (
        <div key={cat}>
          <div className="cut-label">{cat}</div>
          <div className="list">
            {rows.map((i) => (
              <div className="row" key={i.ingredient_id}>
                <input type="checkbox" checked={selected.has(i.ingredient_id)}
                  onChange={() => toggleSelect(i.ingredient_id)} />
                <div className="row-name">
                  {i.canonical_name}
                  {i.freshness === 'soon' && <span className="badge badge-soon" style={{ marginLeft: 8 }}>soon</span>}
                  {i.freshness === 'expired' && <span className="badge badge-expired" style={{ marginLeft: 8 }}>old</span>}
                  {i.confidence === 'assumed' && <span className="row-sub">estimated</span>}
                </div>
                <span className="num">{i.qty_label || (i.is_staple ? 'have' : '')}</span>
                <button className="btn btn-quiet" style={{ color: 'var(--ink-3)' }}
                  onClick={() => remove(i.ingredient_id)}>×</button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {selected.size > 0 && (
        <button className="btn btn-primary btn-block" onClick={suggest} disabled={busy}>
          {busy ? 'Looking…' : `What can I make with ${selected.size} of these?`}
        </button>
      )}

      {suggestions && (
        <div>
          <div className="cut-label">Suggestions</div>
          {suggestions.length === 0 ? (
            <p className="empty">Nothing in your recipes uses those. Import more.</p>
          ) : (
            <div className="list">
              {suggestions.map((s) => (
                <div className="row" key={s.recipe_id} onClick={() => go(`/recipe/${s.recipe_id}`)}>
                  <div className="row-name">
                    {s.title}
                    <span className="row-sub">
                      {s.make_tonight
                        ? 'You have everything'
                        : `Missing ${s.missing_names.slice(0, 3).join(', ')}`}
                    </span>
                  </div>
                  <span className="num">{s.used_count} used</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function groupBy(rows, key) {
  return rows.reduce((acc, r) => {
    (acc[r[key]] ??= []).push(r);
    return acc;
  }, {});
}
