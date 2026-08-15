import { useRef, useState } from 'react';
import { uploadImages, createImportJob, runParse } from '../lib/supabase';

export default function Import({ household, go }) {
  const fileInput = useRef(null);
  const [files, setFiles] = useState([]);
  const [asOne, setAsOne] = useState(false);
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

    await Promise.all(groups.map(async (group, i) => {
      const key = running[i].key;
      const patch = (p) => setJobs((j) => j.map((x) => (x.key === key ? { ...x, ...p } : x)));

      try {
        const paths = await uploadImages(household.id, group.map((g) => g.file));
        patch({ status: 'parsing', stage: null });

        const jobId = await createImportJob(household.id, paths);
        const result = await runParse(jobId, (stage) => patch({ stage }));

        patch({ status: 'done', result });
      } catch (e) {
        patch({ status: 'failed', error: e.message });
      } finally {
        group.forEach((g) => URL.revokeObjectURL(g.url));
      }
    }));

    setBusy(false);
  }

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
