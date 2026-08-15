import { useEffect, useState } from 'react';
import {
  getPantry, setStock, setPantryQty, searchIngredients, cookFromStock,
} from '../lib/supabase';

const CATS = [
  ['produce', 'Produce'], ['meat', 'Meat'], ['seafood', 'Seafood'],
  ['dairy', 'Dairy'], ['bakery', 'Bakery'], ['frozen', 'Frozen'],
  ['pantry', 'Pantry'], ['spice', 'Spices'], ['drinks', 'Drinks'],
  ['household', 'Other'],
];

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

  async function nudge(item, delta) {
    const step = item.unit === 'each' ? 1
      : item.unit === 'ml' || item.unit === 'g' ? (item.qty >= 500 ? 100 : 50)
      : 1;
    const next = Math.max(0, (item.qty ?? 0) + delta * step);

    setItems((rows) => rows.map((r) =>
      r.ingredient_id === item.ingredient_id ? { ...r, qty: next || null } : r));
    await setPantryQty(household.id, item.ingredient_id, next);
    load();
  }

  async function remove(ingredientId) {
    setItems((rows) => rows.filter((r) => r.ingredient_id !== ingredientId));
    await setStock(household.id, ingredientId, false);
    setSelected((s) => { const n = new Set(s); n.delete(ingredientId); return n; });
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
  const staples = items.filter((i) => i.is_staple);
  const fresh = items.filter((i) => !i.is_staple);

  return (
    <div className="stack">
      <div className="row-between">
        <h1>Pantry</h1>
        <span className="num">{items.length} items</span>
      </div>

      <div className="searchbar">
        <input className="field" placeholder="Add something you have"
          value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

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
        <div className="card card-pad" style={{ background: 'var(--amber-wash)' }}>
          <div className="row-between">
            <div>
              <strong>{expiring.length} to use up</strong>
              <p className="muted" style={{ margin: '3px 0 0' }}>
                {expiring.map((e) => e.canonical_name).join(', ')}
              </p>
            </div>
            <button className="btn" onClick={() => {
              setSelected(new Set(expiring.map((e) => e.ingredient_id)));
              setSuggestions(null);
            }}>Use these</button>
          </div>
        </div>
      )}

      {items.length === 0 && (
        <p className="empty">
          Empty. Tick items off a shopping list and they land here automatically.
        </p>
      )}

      {fresh.length > 0 && (
        <section>
          <div className="cut-label">Fresh &amp; measured</div>
          <div className="pantry-grid">
            {fresh.map((i) => (
              <Card key={i.ingredient_id} item={i}
                selected={selected.has(i.ingredient_id)}
                onSelect={() => toggleSelect(i.ingredient_id)}
                onNudge={(d) => nudge(i, d)}
                onRemove={() => remove(i.ingredient_id)} />
            ))}
          </div>
        </section>
      )}

      {staples.length > 0 && (
        <section>
          <div className="cut-label">Staples</div>
          <p className="tiny" style={{ marginTop: -6, marginBottom: 10 }}>
            Tracked as have or don't have. No amounts.
          </p>
          <div className="staples">
            {staples.map((i) => (
              <button key={i.ingredient_id}
                className="chip" aria-pressed={selected.has(i.ingredient_id)}
                onClick={() => toggleSelect(i.ingredient_id)}
                onDoubleClick={() => remove(i.ingredient_id)}
                title="Double-click to remove">
                {i.canonical_name}
              </button>
            ))}
          </div>
        </section>
      )}

      {selected.size > 0 && (
        <button className="btn btn-accent btn-block" onClick={suggest} disabled={busy}>
          {busy ? 'Looking…' : `What can I make with ${selected.size}?`}
        </button>
      )}

      {suggestions && (
        <section>
          <div className="cut-label">Suggestions</div>
          {suggestions.length === 0 ? (
            <p className="empty">Nothing in your library uses those yet.</p>
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
                  {s.make_tonight && <span className="badge badge-hot">tonight</span>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Card({ item, selected, onSelect, onNudge, onRemove }) {
  const label = item.qty_label || 'some';
  return (
    <div className={`pcard ${selected ? 'on' : ''} ${item.freshness === 'expired' ? 'old' : ''}`}>
      <button className="pcard-main" onClick={onSelect}>
        <span className="pcard-name">{item.canonical_name}</span>
        <span className="num-lg">{label}</span>
        {item.freshness === 'soon' && <span className="badge badge-soon">use soon</span>}
        {item.freshness === 'expired' && <span className="badge badge-expired">old</span>}
        {item.confidence === 'assumed' && <span className="tiny">estimated</span>}
      </button>
      <div className="pcard-nudge">
        <button className="btn btn-quiet" onClick={() => onNudge(-1)}>−</button>
        <button className="btn btn-quiet" onClick={() => onNudge(1)}>+</button>
        <button className="btn btn-quiet" onClick={onRemove}
          style={{ color: 'var(--ink-3)' }}>×</button>
      </div>
    </div>
  );
}
