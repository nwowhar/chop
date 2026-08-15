import { useState } from 'react';
import { createHousehold, joinHousehold } from '../lib/supabase';

export default function Onboarding({ onDone }) {
  const [mode, setMode] = useState('create');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    if (!value.trim()) {
      setError(mode === 'create' ? 'Give your household a name' : 'Enter the invite code');
      return;
    }
    setBusy(true); setError(null);
    try {
      const hh = mode === 'create'
        ? await createHousehold(value.trim())
        : await joinHousehold(value);
      onDone(hh);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="main">
      <div className="center-card card card-pad stack">
        <div>
          <h2>{mode === 'create' ? 'Set up your kitchen' : 'Join a kitchen'}</h2>
          <p className="muted">
            {mode === 'create'
              ? 'Recipes, pantry and shopping list are shared with everyone in it.'
              : 'Ask whoever set it up for the invite code.'}
          </p>
        </div>

        <input
          className="field"
          placeholder={mode === 'create' ? 'The Smiths' : 'a1b2c3d4'}
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />

        {error && <p className="error">{error}</p>}

        <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>
          {busy ? 'Working…' : mode === 'create' ? 'Create kitchen' : 'Join'}
        </button>

        <button className="btn btn-quiet btn-block"
          onClick={() => { setMode(mode === 'create' ? 'join' : 'create'); setValue(''); setError(null); }}>
          {mode === 'create' ? 'I have an invite code' : 'Create a new one instead'}
        </button>
      </div>
    </div>
  );
}
