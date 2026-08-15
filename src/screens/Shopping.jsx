import { useEffect, useRef, useState } from 'react';
import {
  buildList, getList, toggleItem, addManualItem, subscribeList,
  clearList, haveAlready, mondayOf, supabase,
} from '../lib/supabase';

const AISLES = [
  ['produce', 'Produce'], ['bakery', 'Bakery'], ['meat', 'Meat'],
  ['seafood', 'Seafood'], ['dairy', 'Dairy'], ['frozen', 'Frozen'],
  ['pantry', 'Pantry'], ['spice', 'Spices'], ['drinks', 'Drinks'],
  ['household', 'Other'],
];

export default function Shopping({ household }) {
  const [weekOf] = useState(mondayOf());
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [manual, setManual] = useState('');
  const [showDone, setShowDone] = useState(false);
  const chan = useRef(null);

  async function load() {
    try { setData(await getList(household.id, weekOf)); }
    catch (e) { setError(e.message); }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!data?.list?.id) return;
    chan.current = subscribeList(data.list.id, load);
    return () => { if (chan.current) supabase.removeChannel(chan.current); };
  }, [data?.list?.id]);

  async function generate() {
    setBusy(true); setError(null);
    try { await buildList(household.id, weekOf); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function tick(item) {
    setData((d) => ({
      ...d,
      items: d.items.map((i) => i.id === item.id
        ? { ...i, checked_at: item.checked_at ? null : new Date().toISOString() }
        : i),
    }));
    await toggleItem(item.id, !item.checked_at);
  }

  async function have(item) {
    setData((d) => ({ ...d, items: d.items.filter((i) => i.id !== item.id) }));
    try { await haveAlready(item.id); } catch (e) { setError(e.message); load(); }
  }

  async function wipe() {
    if (!confirm('Clear the list? Anything you added by hand stays.')) return;
    await clearList(data.list.id, true);
    load();
  }

  if (error) return <p className="error">{error}</p>;

  if (!data) {
    return (
      <div className="stack">
        <h1>Shopping</h1>
        <div className="empty">
          <p>No list for this week yet.</p>
          <button className="btn btn-accent" onClick={generate} disabled={busy}>
            {busy ? 'Building…' : 'Build from this week’s plan'}
          </button>
          <p className="tiny" style={{ marginTop: 12 }}>
            Or open a recipe and add just its missing ingredients.
          </p>
        </div>
      </div>
    );
  }

  const todo = data.items.filter((i) => !i.checked_at);
  const done = data.items.filter((i) => i.checked_at);
  const pct = data.items.length
    ? Math.round((done.length / data.items.length) * 100) : 0;

  const groups = AISLES
    .map(([key, label]) => ({
      key, label,
      items: todo.filter((i) => (i.ingredients?.category ?? 'household') === key),
    }))
    .filter((g) => g.items.length);

  const other = todo.filter((i) => !i.ingredients);

  return (
    <div className="stack">
      <div className="row-between">
        <h1>Shopping</h1>
        <span className="num">{todo.length} to get</span>
      </div>

      <div className="progress">
        <span className="progress-fill" style={{ width: `${pct}%` }} />
      </div>

      <div className="searchbar">
        <input className="field" placeholder="Add something else"
          value={manual} onChange={(e) => setManual(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === 'Enter' && manual.trim()) {
              await addManualItem(data.list.id, manual.trim());
              setManual(''); load();
            }
          }} />
      </div>

      {groups.map((g) => (
        <section key={g.key}>
          <div className="cut-label">{g.label}</div>
          <div className="list">
            {g.items.map((i) => (
              <Item key={i.id} item={i} onTick={() => tick(i)} onHave={() => have(i)} />
            ))}
          </div>
        </section>
      ))}

      {other.length > 0 && (
        <section>
          <div className="cut-label">Added by hand</div>
          <div className="list">
            {other.map((i) => (
              <Item key={i.id} item={i} onTick={() => tick(i)} onHave={() => have(i)} />
            ))}
          </div>
        </section>
      )}

      {todo.length === 0 && (
        <div className="card card-pad" style={{ background: 'var(--green-wash)' }}>
          <strong>That's the lot.</strong>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Everything ticked off is now in your pantry.
          </p>
        </div>
      )}

      {done.length > 0 && (
        <section>
          <button className="btn btn-quiet" onClick={() => setShowDone(!showDone)}>
            {showDone ? 'Hide' : 'Show'} {done.length} in the trolley
          </button>
          {showDone && (
            <div className="list" style={{ marginTop: 'var(--s-2)' }}>
              {done.map((i) => (
                <Item key={i.id} item={i} onTick={() => tick(i)} />
              ))}
            </div>
          )}
        </section>
      )}

      <hr className="cut" />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-quiet" onClick={generate} disabled={busy}>
          {busy ? 'Rebuilding…' : 'Rebuild from plan'}
        </button>
        <button className="btn btn-quiet" style={{ color: 'var(--alert)' }} onClick={wipe}>
          Clear list
        </button>
      </div>
      <p className="tiny">
        Rebuilding replaces recipe items and keeps anything you typed in.
      </p>
    </div>
  );
}

function Item({ item, onTick, onHave }) {
  const name = item.ingredients?.canonical_name ?? item.label ?? 'Item';
  const done = !!item.checked_at;

  return (
    <div className={`row shop-row ${done ? 'row-done' : ''}`}>
      <button className={`tickbox ${done ? 'on' : ''}`} onClick={onTick}
        aria-label={done ? 'Not bought' : 'Bought'}>
        {done ? '✓' : ''}
      </button>

      <div className="row-name" onClick={onTick}>
        {name}
        {item.source_recipe_ids?.length > 1 && (
          <span className="row-sub">For {item.source_recipe_ids.length} recipes</span>
        )}
      </div>

      <span className="num row-qty">
        {item.is_check_only ? 'some' : fmt(item.qty_to_buy, item.unit)}
      </span>

      {!done && onHave && (
        <button className="btn btn-quiet have-btn" onClick={onHave}
          title="Already in the kitchen">have it</button>
      )}
    </div>
  );
}

function fmt(qty, unit) {
  if (qty == null) return '';
  if (unit === 'each') return Math.ceil(qty).toString();
  if (qty >= 1000) return `${Math.round(qty / 100) / 10} ${unit === 'g' ? 'kg' : 'L'}`;
  if (qty >= 100) return `${Math.round(qty / 5) * 5} ${unit}`;
  if (qty >= 10) return `${Math.round(qty)} ${unit}`;
  return `${Math.round(qty * 10) / 10} ${unit}`;
}
