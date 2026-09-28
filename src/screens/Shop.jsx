import { useEffect, useRef, useState } from 'react';
import {
  getList, toggleItem, haveAlready, listTotal, subscribeList,
  mondayOf, supabase,
} from '../lib/supabase';

// In-store mode. Deliberately bare: big targets, aisle order,
// nothing to read. You are holding a trolley with one hand.
// No planning, no editing, no navigation.

const AISLES = [
  ['produce', 'Produce'], ['bakery', 'Bakery'], ['meat', 'Meat'],
  ['seafood', 'Seafood'], ['dairy', 'Dairy'], ['frozen', 'Frozen'],
  ['pantry', 'Pantry'], ['spice', 'Spices'], ['drinks', 'Drinks'],
  ['household', 'Other'],
];

export default function Shop({ household, go }) {
  const [data, setData] = useState(null);
  const [total, setTotal] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState(null);
  const chan = useRef(null);

  async function load() {
    try {
      const d = await getList(household.id, mondayOf());
      setData(d);
      if (d?.list?.id) listTotal(d.list.id).then(setTotal).catch(() => {});
    } catch (e) { setError(e.message); }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!data?.list?.id) return;
    chan.current = subscribeList(data.list.id, load);
    return () => { if (chan.current) supabase.removeChannel(chan.current); };
  }, [data?.list?.id]);

  // the screen stays on while you're walking around
  useEffect(() => {
    let released = false;
    let lock = null;
    navigator.wakeLock?.request('screen')
      .then((s) => { if (released) s.release(); else lock = s; })
      .catch(() => {});
    return () => { released = true; lock?.release?.().catch(() => {}); };
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  if (!data.items.length) {
    return (
      <div className="empty">
        <p>No list for this week.</p>
        <button className="btn btn-accent" onClick={() => go('/week')}>
          Build one
        </button>
      </div>
    );
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

  const todo = data.items.filter((i) => !i.checked_at);
  const done = data.items.filter((i) => i.checked_at);
  const pct = Math.round((done.length / data.items.length) * 100);

  const groups = AISLES
    .map(([key, label]) => ({
      key, label,
      items: todo.filter((i) => (i.ingredients?.category ?? 'household') === key),
    }))
    .filter((g) => g.items.length);

  const loose = todo.filter((i) => !i.ingredients);

  return (
    <div className="shop">
      <div className="shop-head">
        <button className="btn btn-quiet" onClick={() => go('/week')}>← Week</button>
        <span className="num">{todo.length} left</span>
        {total?.known > 0 && (
          <span className="num shop-total">${Number(total.known).toFixed(0)}</span>
        )}
      </div>

      <div className="progress"><span className="progress-fill" style={{ width: `${pct}%` }} /></div>

      {groups.map((g) => (
        <section key={g.key}>
          <div className="cut-label">{g.label}</div>
          <div className="list">
            {g.items.map((i) => (
              <Row key={i.id} item={i} onTick={() => tick(i)} onHave={() => have(i)} />
            ))}
          </div>
        </section>
      ))}

      {loose.length > 0 && (
        <section>
          <div className="cut-label">Added by hand</div>
          <div className="list">
            {loose.map((i) => (
              <Row key={i.id} item={i} onTick={() => tick(i)} onHave={() => have(i)} />
            ))}
          </div>
        </section>
      )}

      {todo.length === 0 && (
        <div className="card card-pad" style={{ background: 'var(--green-wash)' }}>
          <strong>That's the lot.</strong>
          <p className="muted" style={{ margin: '4px 0 12px' }}>
            Everything you ticked is now in the kitchen.
          </p>
          <button className="btn btn-accent" onClick={() => go('/')}>Done</button>
        </div>
      )}

      {done.length > 0 && (
        <section>
          <button className="btn btn-quiet" onClick={() => setShowDone(!showDone)}>
            {showDone ? 'Hide' : 'Show'} {done.length} in the trolley
          </button>
          {showDone && (
            <div className="list" style={{ marginTop: 'var(--s-2)' }}>
              {done.map((i) => <Row key={i.id} item={i} onTick={() => tick(i)} />)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Row({ item, onTick, onHave }) {
  const name = item.ingredients?.canonical_name ?? item.label ?? 'Item';
  const done = !!item.checked_at;

  return (
    <div className={`row shop-row ${done ? 'row-done' : ''}`}>
      <button className={`tickbox ${done ? 'on' : ''}`} onClick={onTick}
        aria-label={done ? 'Put back' : 'In the trolley'}>{done ? '✓' : ''}</button>

      <div className="row-name" onClick={onTick}>{name}</div>

      <span className="num row-qty">
        {item.is_check_only ? 'some' : fmt(item.qty_to_buy, item.unit)}
      </span>

      {!done && onHave && (
        <button className="btn btn-quiet have-btn" onClick={onHave}
          title="Already at home">have</button>
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
