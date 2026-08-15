import { useEffect, useRef, useState } from 'react';
import {
  buildList, getList, toggleItem, addManualItem, subscribeList,
  mondayOf, supabase,
} from '../lib/supabase';

const AISLES = ['produce', 'bakery', 'meat', 'seafood', 'dairy',
                'frozen', 'pantry', 'spice', 'drinks', 'household'];

export default function Shopping({ household }) {
  const [weekOf] = useState(mondayOf());
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [manual, setManual] = useState('');
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
    // optimistic — realtime confirms
    setData((d) => ({
      ...d,
      items: d.items.map((i) => i.id === item.id
        ? { ...i, checked_at: item.checked_at ? null : new Date().toISOString() }
        : i),
    }));
    await toggleItem(item.id, !item.checked_at);
  }

  if (error) return <p className="error">{error}</p>;

  if (!data) {
    return (
      <div className="stack">
        <h1>Shopping</h1>
        <div className="empty">
          <p>No list for this week yet.</p>
          <button className="btn btn-primary" onClick={generate} disabled={busy}>
            {busy ? 'Building…' : 'Build from this week’s plan'}
          </button>
        </div>
      </div>
    );
  }

  const groups = AISLES
    .map((aisle) => ({
      aisle,
      items: data.items.filter((i) => (i.ingredients?.category ?? 'household') === aisle),
    }))
    .filter((g) => g.items.length);

  const manualItems = data.items.filter((i) => i.manual && !i.ingredient_id);
  const remaining = data.items.filter((i) => !i.checked_at).length;

  return (
    <div className="stack">
      <div className="row-between">
        <h1>Shopping</h1>
        <span className="num">{remaining} left</span>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
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
        <div key={g.aisle}>
          <div className="cut-label">{g.aisle}</div>
          <div className="list">
            {g.items.map((i) => (
              <Item key={i.id} item={i} onTick={() => tick(i)} />
            ))}
          </div>
        </div>
      ))}

      {manualItems.length > 0 && (
        <div>
          <div className="cut-label">Other</div>
          <div className="list">
            {manualItems.map((i) => (
              <Item key={i.id} item={i} onTick={() => tick(i)} />
            ))}
          </div>
        </div>
      )}

      <hr className="cut" />
      <button className="btn btn-quiet" onClick={generate} disabled={busy}>
        {busy ? 'Rebuilding…' : 'Rebuild from plan'}
      </button>
      <p className="tiny">
        Rebuilding keeps anything you added by hand and replaces the rest.
      </p>
    </div>
  );
}

function Item({ item, onTick }) {
  const name = item.ingredients?.canonical_name ?? item.label ?? 'Item';
  const done = !!item.checked_at;

  return (
    <div className={`row ${done ? 'row-done' : ''}`} onClick={onTick}>
      <div className="row-name">
        {name}
        {item.source_recipe_ids?.length > 1 && (
          <span className="row-sub">For {item.source_recipe_ids.length} recipes</span>
        )}
      </div>
      <span className="num row-qty">
        {item.is_check_only ? 'check' : fmt(item.qty_to_buy, item.unit)}
      </span>
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
