import { useRef, useState } from 'react';
import {
  uploadImages, createImportJob, runParse, generateRecipe,
  importUrl, scanReceipt, suggestRecipes,
} from '../lib/supabase';

// Everything that puts a recipe in the app, in one sheet. This
// used to be two screens and four scattered panels; picking the
// right door before you knew what you wanted was most of the
// friction.

const TABS = [
  ['ask',    'Ask'],
  ['shot',   'Screenshot'],
  ['link',   'Link'],
  ['docket', 'Receipt'],
];

const EXAMPLES = [
  'High protein, under 30 minutes',
  'Sticky bbq ribs',
  'Something with mince and rice',
  'Big carb load before a ride',
];

export default function AddSheet({ household, go, onClose }) {
  const [tab, setTab] = useState('ask');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  // ask
  const [query, setQuery] = useState('');
  const [picks, setPicks] = useState(null);

  // screenshot
  const shotInput = useRef(null);
  const [files, setFiles] = useState([]);
  const [asOne, setAsOne] = useState(false);
  const [hint, setHint] = useState('');

  // link
  const [url, setUrl] = useState('');

  function reset() {
    setError(null); setDone(null); setStage(null);
  }

  async function search() {
    if (!query.trim()) return;
    setBusy(true); reset(); setPicks(null);
    try { setPicks(await suggestRecipes(query)); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function take(sug) {
    setBusy(true); reset(); setStage('writing');
    try {
      const r = await generateRecipe(household.id, sug.title, sug.tags?.[0] ?? '',
        (s) => setStage(s));
      onClose();
      go(`/recipe/${r.recipe_id}`);
    } catch (e) { setError(e.message); setBusy(false); }
  }

  function pickFiles(e) {
    const chosen = Array.from(e.target.files ?? []);
    setFiles((f) => [...f, ...chosen.map((file) => ({
      file, url: URL.createObjectURL(file), key: crypto.randomUUID(),
    }))]);
    reset();
    e.target.value = '';
  }

  async function fromShots() {
    if (!files.length) { setError('Pick at least one screenshot'); return; }
    setBusy(true); reset();

    const groups = asOne ? [files] : files.map((f) => [f]);
    const useHint = groups.length === 1 ? hint : '';

    try {
      let last = null;
      // Two lanes. Firing six at once burns through the Gemini
      // per-minute limit and they all fail together.
      let cursor = 0;
      const worker = async () => {
        while (cursor < groups.length) {
          const group = groups[cursor++];
          const paths = await uploadImages(household.id, group.map((g) => g.file));
          const jobId = await createImportJob(household.id, paths, useHint, null);
          last = await runParse(jobId, (s) => setStage(s));
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(2, groups.length) }, worker));

      files.forEach((f) => URL.revokeObjectURL(f.url));
      setFiles([]); setHint('');

      if (groups.length === 1 && last?.recipe_id) {
        onClose();
        go(`/recipe/${last.recipe_id}`);
      } else {
        setDone(`${groups.length} recipes added`);
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function fromUrl() {
    if (!/^https?:\/\//i.test(url.trim())) { setError('Paste a full link'); return; }
    setBusy(true); reset();
    try {
      const r = await importUrl(household.id, url.trim(), (s) => setStage(s));
      onClose();
      go(`/recipe/${r.recipe_id}`);
    } catch (e) { setError(e.message); setBusy(false); }
  }

  async function fromReceipt(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); reset(); setStage('reading');
    try {
      const r = await scanReceipt(household.id, file);
      setDone(
        `${r.store ?? 'Receipt'} · ${r.matched} into the pantry` +
        (r.priced ? `, ${r.priced} prices learned` : ''));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); setStage(null); }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Add a recipe</h2>
          <button className="btn btn-quiet" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="sheet-tabs">
          {TABS.map(([v, label]) => (
            <button key={v} className="chip" aria-pressed={tab === v}
              onClick={() => { setTab(v); reset(); }}>{label}</button>
          ))}
        </div>

        <div className="sheet-body">
          {tab === 'ask' && (
            <div className="stack-s">
              <div className="searchbar">
                <input className="field" autoFocus
                  placeholder="What do you feel like?"
                  value={query} onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && search()} />
                <button className="btn btn-primary" onClick={search} disabled={busy}>
                  {busy && !stage ? '…' : 'Go'}
                </button>
              </div>

              {!picks && !busy && (
                <div className="chiprow">
                  {EXAMPLES.map((e) => (
                    <button key={e} className="chip"
                      onClick={() => { setQuery(e); setTimeout(search, 0); }}>{e}</button>
                  ))}
                </div>
              )}

              {picks?.map((s) => (
                <button className="pickrow" key={s.title} onClick={() => take(s)}
                  disabled={busy}>
                  <span>
                    <strong>{s.title}</strong>
                    <span className="row-sub">{s.why}</span>
                  </span>
                  <span className="num">{s.minutes}m</span>
                </button>
              ))}

              {picks?.length === 0 && (
                <p className="tiny">Nothing came back. Try describing it differently.</p>
              )}
            </div>
          )}

          {tab === 'shot' && (
            <div className="stack-s">
              <div className="dropzone" onClick={() => shotInput.current?.click()}>
                <p style={{ margin: 0 }}>Choose screenshots</p>
                <p className="tiny" style={{ marginTop: 4 }}>
                  Tap “more” on the caption first so nothing is cut off
                </p>
                <input ref={shotInput} type="file" accept="image/*" multiple
                  onChange={pickFiles} style={{ display: 'none' }} />
              </div>

              {files.length > 0 && (
                <>
                  <div className="thumbs">
                    {files.map((f) => (
                      <div className="thumb" key={f.key}>
                        <img src={f.url} alt="" />
                        <button className="thumb-x" aria-label="Remove"
                          onClick={() => setFiles((x) => x.filter((y) => y.key !== f.key))}>
                          ×
                        </button>
                      </div>
                    ))}
                  </div>

                  {files.length > 1 && (
                    <label className="row-between">
                      <span>These are one recipe
                        <span className="row-sub">Overlapping scrolls of the same post</span>
                      </span>
                      <input type="checkbox" checked={asOne}
                        onChange={(e) => setAsOne(e.target.checked)} />
                    </label>
                  )}

                  {(files.length === 1 || asOne) && (
                    <input className="field" placeholder="Dish name (optional)"
                      value={hint} onChange={(e) => setHint(e.target.value)} />
                  )}

                  <button className="btn btn-accent btn-block" onClick={fromShots}
                    disabled={busy}>
                    {busy ? label(stage) : `Import ${asOne ? 1 : files.length}`}
                  </button>
                </>
              )}
            </div>
          )}

          {tab === 'link' && (
            <div className="stack-s">
              <div className="searchbar">
                <input className="field" autoFocus
                  placeholder="https://www.recipetineats.com/…"
                  value={url} onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fromUrl()} />
                <button className="btn btn-primary" onClick={fromUrl} disabled={busy}>
                  {busy ? '…' : 'Get'}
                </button>
              </div>
              <p className="tiny">
                Most recipe sites publish structured data, so this pulls the real
                ingredients, method and photo.
              </p>
            </div>
          )}

          {tab === 'docket' && (
            <div className="stack-s">
              <label className="dropzone" style={{ cursor: 'pointer' }}>
                <p style={{ margin: 0 }}>Photograph the receipt</p>
                <p className="tiny" style={{ marginTop: 4 }}>
                  Stocks the pantry, ticks off your list, learns what things cost
                </p>
                <input type="file" accept="image/*" capture="environment"
                  onChange={fromReceipt} style={{ display: 'none' }} />
              </label>
            </div>
          )}

          {busy && stage && <p className="muted"><span className="spinner" /> {label(stage)}</p>}
          {error && <p className="error">{error}</p>}
          {done && <p className="ok">{done}</p>}
        </div>
      </div>
    </div>
  );
}

function label(stage) {
  if (stage === 'writing') return 'Saving…';
  if (stage === 'reading') return 'Reading…';
  return 'Working…';
}
