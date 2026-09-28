import { useEffect, useRef, useState } from 'react';
import { getList, triage, mondayOf } from '../lib/supabase';

// Swipe belongs here, not in the aisle. This is a single linear
// pass at home: have it, don't need it, buy it. The in-store list
// stays a checklist you can scan and jump around.

export default function Triage({ household, go }) {
  const [items, setItems] = useState(null);
  const [i, setI] = useState(0);
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const [leaving, setLeaving] = useState(null);
  const [counts, setCounts] = useState({ have: 0, skip: 0, keep: 0 });
  const [error, setError] = useState(null);
  const start = useRef(null);

  useEffect(() => {
    getList(household.id, mondayOf())
      .then((d) => setItems((d?.items ?? []).filter(
        (x) => !x.checked_at && !x.triaged_at)))
      .catch((e) => setError(e.message));
  }, [household.id]);

  if (error) return <p className="error">{error}</p>;
  if (!items) return <p className="muted">Loading…</p>;

  if (!items.length || i >= items.length) {
    const total = counts.have + counts.skip + counts.keep;
    return (
      <div className="stack">
        <h1>All sorted</h1>
        {total > 0 ? (
          <div className="card card-pad">
            <p style={{ margin: 0 }}>
              <strong>{counts.keep}</strong> to buy ·{' '}
              <strong>{counts.have}</strong> already had ·{' '}
              <strong>{counts.skip}</strong> skipped
            </p>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              Anything you already had is now in the pantry.
            </p>
          </div>
        ) : (
          <p className="empty">Nothing left to sort.</p>
        )}
        <button className="btn btn-accent" onClick={() => go('/shop')}>
          Go shopping
        </button>
      </div>
    );
  }

  const item = items[i];
  const name = item.ingredients?.canonical_name ?? item.label ?? 'Item';
  const verdict = verdictFor(drag);

  async function commit(v) {
    setLeaving(v);
    setCounts((c) => ({ ...c, [v]: c[v] + 1 }));
    try { await triage(item.id, v); } catch (e) { setError(e.message); }
    setTimeout(() => {
      setLeaving(null);
      setDrag({ x: 0, y: 0, active: false });
      setI((n) => n + 1);
    }, 180);
  }

  function onDown(e) {
    const p = point(e);
    start.current = p;
    setDrag({ x: 0, y: 0, active: true });
  }

  function onMove(e) {
    if (!start.current) return;
    const p = point(e);
    setDrag({ x: p.x - start.current.x, y: p.y - start.current.y, active: true });
  }

  function onUp() {
    if (!start.current) return;
    start.current = null;
    const v = verdictFor(drag);
    if (v) commit(v); else setDrag({ x: 0, y: 0, active: false });
  }

  const style = leaving
    ? { transform: leaveTransform(leaving), opacity: 0, transition: 'all 180ms ease-out' }
    : {
        transform: `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x / 22}deg)`,
        transition: drag.active ? 'none' : 'transform 180ms var(--ease)',
      };

  return (
    <div className="stack">
      <div className="row-between">
        <h1>Sort the list</h1>
        <span className="num">{items.length - i} left</span>
      </div>

      <p className="muted">
        Quick pass before you go. Swipe or tap.
      </p>

      <div className="swipe-stage">
        {items[i + 1] && (
          <div className="swipe-card behind">
            <span className="swipe-name">
              {items[i + 1].ingredients?.canonical_name ?? items[i + 1].label}
            </span>
          </div>
        )}

        <div className="swipe-card"
          style={style}
          onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
          onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}>

          <span className={`swipe-stamp have ${verdict === 'have' ? 'on' : ''}`}>Got it</span>
          <span className={`swipe-stamp skip ${verdict === 'skip' ? 'on' : ''}`}>Skip</span>
          <span className={`swipe-stamp keep ${verdict === 'keep' ? 'on' : ''}`}>Buy</span>

          <span className="swipe-cat">{item.ingredients?.category ?? 'other'}</span>
          <span className="swipe-name">{name}</span>
          <span className="num-lg">
            {item.is_check_only ? 'some' : fmt(item.qty_to_buy, item.unit)}
          </span>
          {item.source_recipe_ids?.length > 0 && (
            <span className="tiny">
              For {item.source_recipe_ids.length} recipe
              {item.source_recipe_ids.length > 1 ? 's' : ''} this week
            </span>
          )}
        </div>
      </div>

      <div className="swipe-actions">
        <button className="btn" onClick={() => commit('skip')}>Don’t need</button>
        <button className="btn btn-accent" onClick={() => commit('keep')}>Buy it</button>
        <button className="btn" onClick={() => commit('have')}>Got it</button>
      </div>

      <p className="tiny">
        Left don’t need · up buy it · right already have it.
        “Got it” puts it straight in the pantry.
      </p>
    </div>
  );
}

function point(e) {
  const t = e.touches?.[0] ?? e.changedTouches?.[0] ?? e;
  return { x: t.clientX, y: t.clientY };
}

function verdictFor({ x, y }) {
  if (y < -90 && Math.abs(x) < 110) return 'keep';
  if (x > 110) return 'have';
  if (x < -110) return 'skip';
  return null;
}

function leaveTransform(v) {
  if (v === 'keep') return 'translateY(-460px)';
  if (v === 'have') return 'translateX(460px) rotate(18deg)';
  return 'translateX(-460px) rotate(-18deg)';
}

function fmt(qty, unit) {
  if (qty == null) return '';
  if (unit === 'each') return Math.ceil(qty).toString();
  if (qty >= 1000) return `${Math.round(qty / 100) / 10} ${unit === 'g' ? 'kg' : 'L'}`;
  if (qty >= 100) return `${Math.round(qty / 5) * 5} ${unit}`;
  if (qty >= 10) return `${Math.round(qty)} ${unit}`;
  return `${Math.round(qty * 10) / 10} ${unit}`;
}
