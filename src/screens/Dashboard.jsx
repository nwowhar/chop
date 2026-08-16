import { useEffect, useState } from 'react';
import { getDashboard, getWeeklyPick, generateRecipe, planMeal, isoDate } from '../lib/supabase';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function Dashboard({ household, go }) {
  const [d, setD] = useState(null);
  const [picks, setPicks] = useState(null);
  const [adding, setAdding] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getDashboard(household.id).then(setD).catch((e) => setError(e.message));
    getWeeklyPick(household.id).then(setPicks).catch(() => setPicks([]));
  }, [household.id]);

  if (error) return <p className="error">{error}</p>;
  if (!d) return <p className="muted">Loading…</p>;

  const planned = d.plan.filter((m) => !m.cooked_at);
  const cooked = d.plan.filter((m) => m.cooked_at);
  const todo = d.list?.items.filter((i) => !i.checked_at) ?? [];
  const expiring = d.pantry.filter((p) => p.freshness === 'soon' || p.freshness === 'expired');

  const emptyWeek = d.plan.length === 0;

  async function tryIt(sug) {
    setAdding(sug.title);
    try {
      const r = await generateRecipe(household.id, sug.title, sug.tags?.[0] ?? '');
      go(`/recipe/${r.recipe_id}`);
    } catch (e) { setError(e.message); setAdding(null); }
  }

  return (
    <div className="stack">
      <div>
        <h1>{greeting()}</h1>
        <p className="muted">
          {new Date().toLocaleDateString('en-AU',
            { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {/* --- the week ------------------------------------------ */}
      <section>
        <div className="row-between">
          <span className="eyebrow">This week</span>
          <button className="btn btn-quiet" onClick={() => go('/plan')}>
            {emptyWeek ? 'Plan it' : 'Edit'}
          </button>
        </div>

        {emptyWeek ? (
          <div className="card card-pad hatch" style={{ marginTop: 8 }}>
            <strong>Nothing planned yet.</strong>
            <p className="muted" style={{ margin: '4px 0 12px' }}>
              Put a few dinners on the calendar and the shopping list writes itself.
            </p>
            <button className="btn btn-primary" onClick={() => go('/plan')}>
              Plan the week
            </button>
          </div>
        ) : (
          <div className="week-strip">
            {DAYS.map((label, i) => {
              const date = new Date(d.week);
              date.setDate(date.getDate() + i);
              const iso = isoDate(date);
              const meals = d.plan.filter((m) => m.date === iso);
              const today = iso === isoDate(new Date());
              return (
                <div key={iso} className={`daycell ${today ? 'today' : ''} ${meals.length ? 'full' : ''}`}
                  onClick={() => go(meals.length ? `/recipe/${meals[0].recipe_id}` : '/plan')}>
                  <span className="daycell-day">{label}</span>
                  <span className="daycell-meal">
                    {meals.length ? meals[0].recipes?.title : '—'}
                  </span>
                  {meals[0]?.cooked_at && <span className="daycell-tick">✓</span>}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* --- status row ---------------------------------------- */}
      <div className="stat-row">
        <button className="stat" onClick={() => go('/shopping')}>
          <span className="num-lg">{todo.length}</span>
          <span className="tiny">to buy</span>
        </button>
        <button className="stat" onClick={() => go('/pantry')}>
          <span className="num-lg">{d.pantry.length}</span>
          <span className="tiny">in the pantry</span>
        </button>
        <button className="stat" onClick={() => go('/library')}>
          <span className="num-lg">{d.recipes.length}</span>
          <span className="tiny">recipes</span>
        </button>
        <button className="stat" onClick={() => go('/plan')}>
          <span className="num-lg">{cooked.length}</span>
          <span className="tiny">cooked</span>
        </button>
      </div>

      {/* --- use it up ----------------------------------------- */}
      {expiring.length > 0 && (
        <div className="card card-pad" style={{ background: 'var(--amber-wash)' }}>
          <div className="row-between">
            <div>
              <strong>{expiring.length} thing{expiring.length > 1 ? 's' : ''} on the way out</strong>
              <p className="muted" style={{ margin: '3px 0 0' }}>
                {expiring.slice(0, 5).map((e) => e.canonical_name).join(', ')}
              </p>
            </div>
            <button className="btn" onClick={() => go('/pantry')}>Use them</button>
          </div>
        </div>
      )}

      {/* --- cook tonight -------------------------------------- */}
      {d.tonight.length > 0 && (
        <section>
          <div className="cut-label">Could cook tonight</div>
          <p className="tiny" style={{ marginTop: -6, marginBottom: 10 }}>
            Nothing missing — you have everything for these.
          </p>
          <div className="list">
            {d.tonight.map((t) => (
              <div className="row" key={t.recipe_id} onClick={() => go(`/recipe/${t.recipe_id}`)}>
                <div className="row-name">{t.title}</div>
                <span className="badge badge-hot">ready</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* --- weekly picks -------------------------------------- */}
      <section>
        <div className="cut-label">Worth a go this week</div>
        {picks === null ? (
          <p className="muted">Thinking of something…</p>
        ) : picks.length === 0 ? (
          <p className="tiny">No suggestions right now. Try the Find tab.</p>
        ) : (
          <div className="picks">
            {picks.map((s, i) => (
              <div className={`pick pick-c${i % 3}`} key={s.title}>
                <div>
                  <h3>{s.title}</h3>
                  <p className="pick-why">{s.why}</p>
                </div>
                <div className="pick-foot">
                  <span className="num">{s.minutes} min</span>
                  <button className="btn" onClick={() => tryIt(s)} disabled={!!adding}>
                    {adding === s.title ? 'Writing…' : 'Try it'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-accent" onClick={() => go('/discover')}>Find a recipe</button>
        <button className="btn" onClick={() => go('/import')}>Import a screenshot</button>
      </div>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 11) return 'Morning';
  if (h < 15) return 'Afternoon';
  if (h < 18) return 'What’s for dinner?';
  return 'Evening';
}
