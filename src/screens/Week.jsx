import { useEffect, useMemo, useState } from 'react';
import {
  getPlan, planMeal, unplanMeal, markCooked, listRecipes,
  getPantry, cookFromStock, autoPlan,
  buildList, getList, listTotal, addManualItem,
  mondayOf, isoDate,
} from '../lib/supabase';

// Planning the week and writing the shopping list are one act,
// so they live on one screen. The list is the consequence of the
// plan and sits directly beneath it. The shop itself is separate
// — see Shop.jsx — because that happens later, one-handed.

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const FILTERS = [
  ['all',          'All'],
  ['ready',        'Nothing missing'],
  ['high-protein', 'High protein'],
  ['pre-training', 'Pre-training'],
  ['vegetarian',   'Vegetarian'],
  ['quick',        'Quick'],
];

export default function Week({ household, go, onAdd }) {
  const [weekOf, setWeekOf] = useState(mondayOf());
  const [plan, setPlan] = useState(null);
  const [recipes, setRecipes] = useState([]);
  const [ready, setReady] = useState(new Set());
  const [list, setList] = useState(null);
  const [total, setTotal] = useState(null);
  const [picking, setPicking] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState('');
  const [error, setError] = useState(null);

  async function load() {
    try {
      const [p, r, l] = await Promise.all([
        getPlan(household.id, weekOf),
        listRecipes(),
        getList(household.id, weekOf),
      ]);
      setPlan(p); setRecipes(r); setList(l);
      if (l?.list?.id) listTotal(l.list.id).then(setTotal).catch(() => {});
      else setTotal(null);
    } catch (e) { setError(e.message); }
  }

  useEffect(() => { load(); }, [weekOf]);

  useEffect(() => {
    (async () => {
      try {
        const pantry = await getPantry(household.id);
        const ids = pantry.map((p) => p.ingredient_id);
        if (!ids.length) return;
        const rows = await cookFromStock(household.id, ids);
        setReady(new Set(rows.filter((r) => r.make_tonight).map((r) => r.recipe_id)));
      } catch { /* not fatal */ }
    })();
  }, [household.id]);

  const days = DAYS.map((label, i) => {
    const d = new Date(weekOf);
    d.setDate(d.getDate() + i);
    return { label, date: isoDate(d), num: d.getDate() };
  });

  const plannedIds = useMemo(
    () => new Set((plan ?? []).map((m) => m.recipe_id)), [plan]);

  const candidates = useMemo(() => recipes.filter((r) => {
    if (q.trim() && !r.title.toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (filter === 'all') return true;
    if (filter === 'ready') return ready.has(r.id);
    if (r.tags?.includes(filter)) return true;
    const m = r.macros_per_serve;
    if (!m) return false;
    if (filter === 'high-protein') return m.protein_g >= 30;
    if (filter === 'pre-training') return m.carb_g >= 60 && m.fat_g <= 20 && (m.fibre_g ?? 0) <= 8;
    return false;
  }), [recipes, q, filter, ready]);

  async function add(recipeId) {
    await planMeal(household.id, picking, recipeId, null);
    setPicking(null); setQ('');
    load();
  }

  function surprise(forDate) {
    const date = forDate ?? picking;
    const pool = candidates.filter((r) => !plannedIds.has(r.id));
    const best = pool.filter((r) => ready.has(r.id));
    const from = best.length ? best : pool.length ? pool : candidates;
    if (!from.length) return;
    const pick = from[Math.floor(Math.random() * from.length)];
    planMeal(household.id, date, pick.id, null).then(() => {
      setPicking(null); load();
    });
  }

  async function fill(nights) {
    setBusy(true); setError(null);
    try {
      const added = await autoPlan(household.id, weekOf, nights,
        ['all', 'ready'].includes(filter) ? null : filter);
      if (added === 0) setError('Nothing left to add — the library is thin.');
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function makeList() {
    setBusy(true); setError(null);
    try { await buildList(household.id, weekOf); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (error) return <p className="error">{error}</p>;
  if (!plan) return <p className="muted">Loading…</p>;

  // ---- recipe picker -----------------------------------------
  if (picking) {
    const day = days.find((d) => d.date === picking);
    return (
      <div className="stack">
        <button className="btn btn-quiet" style={{ alignSelf: 'flex-start' }}
          onClick={() => { setPicking(null); setQ(''); }}>← Back</button>

        <div className="row-between">
          <h2>{day?.label} {day?.num}</h2>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" onClick={() => surprise()}
              disabled={!candidates.length}>Surprise me</button>
            <button className="btn btn-accent" onClick={onAdd}>+ New</button>
          </div>
        </div>

        <input className="field" autoFocus
          placeholder={`Search ${recipes.length} recipes`}
          value={q} onChange={(e) => setQ(e.target.value)} />

        <div className="chiprow">
          {FILTERS.map(([v, label]) => (
            <button key={v} className="chip" aria-pressed={filter === v}
              onClick={() => setFilter(v)}>{label}</button>
          ))}
        </div>

        {candidates.length === 0 ? (
          <div className="empty">
            <p>Nothing matches.</p>
            <button className="btn btn-accent" onClick={onAdd}>Find something new</button>
          </div>
        ) : (
          <div className="list">
            {candidates.map((r) => (
              <div className="row" key={r.id} onClick={() => add(r.id)}>
                <div className="row-name">
                  {r.title}
                  <span className="row-sub">
                    {r.servings ? `Serves ${r.servings}` : 'Serves —'}
                    {r.macros_per_serve?.protein_g
                      ? ` · ${Math.round(r.macros_per_serve.protein_g)}g protein` : ''}
                    {plannedIds.has(r.id) ? ' · already this week' : ''}
                  </span>
                </div>
                {ready.has(r.id) && <span className="badge badge-hot">ready</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ---- the week ----------------------------------------------
  const filled = plan.length;
  const todo = list?.items.filter((i) => !i.checked_at) ?? [];
  const today = isoDate(new Date());

  return (
    <div className="stack">
      <div className="row-between">
        <h1>The week</h1>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn-quiet" onClick={() => shift(-7)}>←</button>
          <span className="num" style={{ alignSelf: 'center' }}>
            {weekOf.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
          </span>
          <button className="btn btn-quiet" onClick={() => shift(7)}>→</button>
        </div>
      </div>

      {filled < 5 && (
        <div className="fillbar">
          <span className="muted">Fill the empty nights</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-accent" onClick={() => fill(5)} disabled={busy}>
              {busy ? '…' : '5 nights'}
            </button>
            <button className="btn" onClick={() => fill(7)} disabled={busy}>Every night</button>
          </div>
        </div>
      )}

      <div className="daylist">
        {days.map((d) => {
          const meals = plan.filter((m) => m.date === d.date);
          return (
            <div key={d.date} className={`dayrow ${d.date === today ? 'today' : ''}`}>
              <span className="dayrow-label">
                {d.label}<span className="dayrow-num">{d.num}</span>
              </span>

              {meals.length ? meals.map((m) => (
                <div className="dayrow-meal" key={m.id}>
                  <button className="dayrow-title"
                    onClick={() => go(`/recipe/${m.recipe_id}`)}>
                    {m.recipes?.title}
                    {m.cooked_at && <span className="dayrow-done">cooked</span>}
                  </button>
                  {!m.cooked_at && (
                    <button className="btn btn-quiet dayrow-act"
                      onClick={() => go(`/cook/${m.recipe_id}`)}>Cook</button>
                  )}
                  <button className="btn btn-quiet dayrow-act"
                    onClick={async () => { await unplanMeal(m.id); load(); }}>×</button>
                </div>
              )) : (
                <div className="dayrow-meal empty-day">
                  <button className="dayrow-add" onClick={() => setPicking(d.date)}>
                    Add dinner
                  </button>
                  <button className="btn btn-quiet dayrow-act"
                    title="Pick one for me" onClick={() => surprise(d.date)}>✳</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ---- the list that falls out of it -------------------- */}
      <hr className="cut" />

      <div className="row-between">
        <h2>Shopping</h2>
        {list && <span className="num">{todo.length} to get</span>}
      </div>

      {!list ? (
        <div className="card card-pad">
          <p className="muted" style={{ margin: '0 0 12px' }}>
            {filled
              ? 'Build the list from what you just planned.'
              : 'Plan a few nights first, then build the list.'}
          </p>
          <button className="btn btn-accent" onClick={makeList} disabled={busy || !filled}>
            {busy ? 'Building…' : 'Build the list'}
          </button>
        </div>
      ) : (
        <>
          {total && total.known > 0 && (
            <div className="total-card">
              <div>
                <span className="tiny">Estimated</span>
                <div className="num-lg">${Number(total.known).toFixed(2)}</div>
              </div>
              <span className="tiny" style={{ textAlign: 'right' }}>
                {total.unpriced > 0 ? `${total.unpriced} unpriced` : 'from your receipts'}
              </span>
            </div>
          )}

          <div className="searchbar">
            <input className="field" placeholder="Add something else"
              value={manual} onChange={(e) => setManual(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && manual.trim()) {
                  await addManualItem(list.list.id, manual.trim());
                  setManual(''); load();
                }
              }} />
          </div>

          <div className="listpreview">
            {todo.slice(0, 8).map((i) => (
              <span className="pill" key={i.id}>
                {i.ingredients?.canonical_name ?? i.label}
              </span>
            ))}
            {todo.length > 8 && <span className="pill muted">+{todo.length - 8} more</span>}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-accent" onClick={() => go('/shop')}>
              Go shopping →
            </button>
            {todo.length > 3 && (
              <button className="btn" onClick={() => go('/triage')}>Sort it first</button>
            )}
            <button className="btn btn-quiet" onClick={makeList} disabled={busy}>
              Rebuild
            </button>
          </div>
        </>
      )}
    </div>
  );

  function shift(n) {
    const d = new Date(weekOf);
    d.setDate(d.getDate() + n);
    setWeekOf(d);
    setPlan(null);
  }
}
