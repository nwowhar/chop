import { useEffect, useRef, useState } from 'react';
import { getRecipe, markCookedByRecipe } from '../lib/supabase';

export default function Cook({ id, household, go }) {
  const [data, setData] = useState(null);
  const [i, setI] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const wake = useRef(null);

  useEffect(() => { getRecipe(id).then(setData).catch(() => {}); }, [id]);

  // keep the screen on — greasy hands, propped phone
  useEffect(() => {
    let released = false;
    navigator.wakeLock?.request('screen')
      .then((s) => { if (released) s.release(); else wake.current = s; })
      .catch(() => {});
    return () => { released = true; wake.current?.release?.().catch(() => {}); };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (!data) return <div className="splash"><span className="muted">Loading…</span></div>;

  const steps = data.steps;
  if (!steps.length) {
    return (
      <div className="main stack">
        <p className="empty">This recipe has no method saved.</p>
        <button className="btn" onClick={() => go(`/recipe/${id}`)}>Back</button>
      </div>
    );
  }

  const step = steps[i];
  const last = i === steps.length - 1;

  async function next() {
    if (!last) { setI(i + 1); return; }
    try { await markCookedByRecipe(household.id, id); } catch { /* not planned */ }
    go(`/recipe/${id}`);
  }

  return (
    <div style={{ padding: 'var(--s-4)', maxWidth: 720, margin: '0 auto' }}>
      <div className="cook">
        <div className="cook-head">
          <span>Cook mode · step {String(i + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}</span>
          <span className="cook-clock">{clock(elapsed)}</span>
        </div>

        <p className="cook-step" dangerouslySetInnerHTML={{ __html: emphasise(step.text) }} />

        <div className="cook-bars">
          {steps.map((_, n) => (
            <span key={n} className={`cook-bar ${n <= i ? 'on' : ''}`} />
          ))}
        </div>

        <div className="cook-actions">
          <button className="btn cook-back"
            onClick={() => (i === 0 ? go(`/recipe/${id}`) : setI(i - 1))}>←</button>
          <button className="btn btn-accent cook-next" onClick={next}>
            {last ? 'Done — mark as cooked' : 'Next step'}
          </button>
        </div>
      </div>

      <button className="btn btn-quiet btn-block" style={{ marginTop: 'var(--s-3)' }}
        onClick={() => go(`/recipe/${id}`)}>Leave cook mode</button>
    </div>
  );
}

// Times and temperatures get the amber treatment — they're what
// you glance back at from across the kitchen.
function emphasise(text) {
  const safe = text.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  return safe.replace(
    /(\d+(?:[–-]\d+)?\s?(?:min(?:ute)?s?|sec(?:ond)?s?|hours?|hrs?|°C|C\b|g\b|ml\b))/gi,
    '<em>$1</em>');
}

function clock(s) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
