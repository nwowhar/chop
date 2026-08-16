import { useRef, useState } from 'react';
import { uploadImages, createImportJob, runParse, generateRecipe, importUrl } from '../lib/supabase';

export default function Import({ household, go }) {
  const fileInput = useRef(null);
  const [files, setFiles] = useState([]);
  const [asOne, setAsOne] = useState(false);
  const [hint, setHint] = useState('');
  const [theme, setTheme] = useState('');
  const [dish, setDish] = useState('');
  const [url, setUrl] = useState('');
  const [jobs, setJobs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function pick(e) {
    const chosen = Array.from(e.target.files ?? []);
    setFiles((f) => [...f, ...chosen.map((file) => ({
      file, url: URL.createObjectURL(file), key: crypto.randomUUID(),
    }))]);
    setError(null);
    e.target.value = '';
  }

  function remove(key) {
    setFiles((f) => {
      const hit = f.find((x) => x.key === key);
      if (hit) URL.revokeObjectURL(hit.url);
      return f.filter((x) => x.key !== key);
    });
  }

  async function start() {
    if (!files.length) { setError('Add at least one screenshot'); return; }
    setBusy(true); setError(null);

    // asOne: every image is a scroll of the same post -> one job.
    // otherwise each image is its own recipe -> one job each.
    const groups = asOne ? [files] : files.map((f) => [f]);
    // A hint names one dish, so it only applies when there's one recipe
    const useHint = groups.length === 1 ? hint : '';
    const running = groups.map((g, i) => ({
      key: `${Date.now()}-${i}`,
      count: g.length,
      status: 'uploading',
      stage: null,
      result: null,
      error: null,
    }));
    setJobs((j) => [...running, ...j]);
    setFiles([]);
    setHint('');

    // Two at a time. Firing six screenshots at once burns straight
    // through the per-minute Gemini limit and they all 429 together.
    const LANES = 2;
    let cursor = 0;

    const worker = async () => {
      while (cursor < groups.length) {
        const i = cursor++;
        const group = groups[i];
        await runOne(group, i);
      }
    };

    async function runOne(group, i) {
      const key = running[i].key;
      const patch = (p) => setJobs((j) => j.map((x) => (x.key === key ? { ...x, ...p } : x)));

      try {
        const paths = await uploadImages(household.id, group.map((g) => g.file));
        patch({ status: 'parsing', stage: null });

        const jobId = await createImportJob(household.id, paths, useHint, theme);
        const result = await runParse(jobId, (stage) => patch({ stage }));

        patch({ status: 'done', result });
      } catch (e) {
        patch({ status: 'failed', error: e.message });
      } finally {
        group.forEach((g) => URL.revokeObjectURL(g.url));
      }
    }

    await Promise.all(Array.from({ length: Math.min(LANES, groups.length) }, worker));

    setBusy(false);
  }

  async function generate() {
    if (!dish.trim()) { setError('Type a dish name'); return; }
    setBusy(true); setError(null);

    const key = `gen-${Date.now()}`;
    setJobs((j) => [{ key, count: 0, status: 'parsing', stage: null,
                      result: null, error: null }, ...j]);
    const patch = (p) => setJobs((j) => j.map((x) => (x.key === key ? { ...x, ...p } : x)));

    try {
      const result = await generateRecipe(household.id, dish.trim(), theme,
        (stage) => patch({ stage }));
      patch({ status: 'done', result });
      setDish('');
    } catch (e) {
      patch({ status: 'failed', error: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function fromUrl() {
    if (!/^https?:\/\//i.test(url.trim())) { setError('Paste a full link'); return; }
    setBusy(true); setError(null);

    const key = `url-${Date.now()}`;
    setJobs((j) => [{ key, count: 0, status: 'parsing', stage: null,
                      result: null, error: null }, ...j]);
    const patch = (p) => setJobs((j) => j.map((x) => (x.key === key ? { ...x, ...p } : x)));

    try {
      const result = await importUrl(household.id, url.trim(), (stage) => patch({ stage }));
      patch({ status: 'done', result });
      setUrl('');
    } catch (e) {
      patch({ status: 'failed', error: e.message });
    } finally {
      setBusy(false);
    }
  }

  const themes = [
    ['', 'Any'],
    ['high-protein', 'High protein'],
    ['pre-training', 'Pre-training'],
    ['vegetarian', 'Vegetarian'],
    ['quick', 'Under 30 min'],
    ['crowd', 'Feeds a crowd'],
  ];

  const ThemePicker = () => (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {themes.map(([v, label]) => (
        <button key={v} className="chip" aria-pressed={theme === v}
          onClick={() => setTheme(v)}>{label}</button>
      ))}
    </div>
  );

  return (
    <div className="stack">
      <div>
        <h1>Import</h1>
        <p className="muted">
          Screenshot the caption on Instagram. Tap “more” first so nothing is cut off.
        </p>
      </div>

      <div className="dropzone" onClick={() => fileInput.current?.click()}>
        <p style={{ margin: 0 }}>Choose screenshots</p>
        <p className="tiny" style={{ marginTop: 4 }}>PNG or JPG, several at once</p>
        <input ref={fileInput} type="file" accept="image/*" multiple
          onChange={pick} style={{ display: 'none' }} />
      </div>

      {files.length === 0 && (
        <>
          <div className="cut-label">Or paste a link</div>
          <div className="card card-pad stack-s">
            <div className="searchbar">
              <input className="field" placeholder="https://www.recipetineats.com/…"
                value={url} onChange={(e) => { setUrl(e.target.value); setError(null); }}
                onKeyDown={(e) => e.key === 'Enter' && fromUrl()} />
              <button className="btn btn-primary" onClick={fromUrl} disabled={busy}>
                Import
              </button>
            </div>
            <p className="tiny">
              Most recipe sites publish their recipes as structured data, so this
              pulls the real ingredients, method and photo. Stays private to your
              kitchen.
            </p>
          </div>

          <div className="cut-label">Or just ask</div>
          <div className="card card-pad stack-s">
            <input className="field" placeholder="Chicken katsu curry"
              value={dish} onChange={(e) => { setDish(e.target.value); setError(null); }}
              onKeyDown={(e) => e.key === 'Enter' && generate()} />
            <ThemePicker />
            <button className="btn btn-primary btn-block" onClick={generate} disabled={busy}>
              {busy ? 'Writing…' : 'Add recipe'}
            </button>
            <p className="tiny">
              Writes the standard version of a known dish and files it like any
              other recipe. Marked “generated” so you know nobody cooked it first.
            </p>
          </div>
        </>
      )}

      {files.length > 0 && (
        <>
          <div className="thumbs">
            {files.map((f) => (
              <div className="thumb" key={f.key}>
                <img src={f.url} alt="" />
                <button className="thumb-x" onClick={() => remove(f.key)} aria-label="Remove">×</button>
              </div>
            ))}
          </div>

          {files.length > 1 && (
            <label className="row-between card card-pad" style={{ cursor: 'pointer' }}>
              <span>
                These are one recipe
                <span className="row-sub">
                  Tick when they’re overlapping scrolls of the same post
                </span>
              </span>
              <input type="checkbox" checked={asOne}
                onChange={(e) => setAsOne(e.target.checked)} />
            </label>
          )}

          {(files.length === 1 || asOne) && (
            <div className="stack-s">
              <input className="field" placeholder="Dish name (optional)"
                value={hint} onChange={(e) => setHint(e.target.value)} />
              <ThemePicker />
              <p className="tiny">
                Worth filling in when the title is cut off, or the recipe is
                only spoken in the video. It also helps the AI tell a ground
                spice from the fresh herb.
              </p>
            </div>
          )}

          {error && <p className="error">{error}</p>}

          <button className="btn btn-primary btn-block" onClick={start} disabled={busy}>
            {busy ? 'Working…'
              : asOne ? 'Import as 1 recipe'
              : `Import ${files.length} recipe${files.length > 1 ? 's' : ''}`}
          </button>
        </>
      )}

      {jobs.length > 0 && (
        <div className="list">
          {jobs.map((j) => (
            <div className="job" key={j.key}>
              {(j.status === 'uploading' || j.status === 'parsing') && <span className="spinner" />}
              <div style={{ flex: 1, minWidth: 0 }}>
                {j.status === 'uploading' && <span className="muted">Uploading…</span>}
                {j.status === 'parsing' && (
                  <span className="muted">
                    {j.stage === 'writing' ? 'Saving…' : 'Reading the recipe…'}
                  </span>
                )}
                {j.status === 'failed' && <span style={{ color: 'var(--alert)' }}>{j.error}</span>}
                {j.status === 'done' && (
                  <>
                    <span>{j.result.title}</span>
                    <span className="row-sub">
                      {j.result.ingredients} ingredients, {j.result.sections} section
                      {j.result.sections > 1 ? 's' : ''}
                      {j.result.title_inferred && ' · title guessed'}
                      {j.result.steps_origin !== 'extracted' && ' · steps reconstructed'}
                      {j.result.unmatched?.length > 0 &&
                        ` · ${j.result.unmatched.length} unmatched`}
                    </span>
                  </>
                )}
              </div>
              {j.status === 'done' && (
                <button className="btn btn-quiet"
                  onClick={() => go(`/recipe/${j.result.recipe_id}`)}>Open</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
