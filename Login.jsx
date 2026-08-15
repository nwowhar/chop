import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [mode, setMode] = useState('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  async function submit() {
    if (!email.trim()) { setError('Enter your email address'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }

    setBusy(true); setError(null); setNotice(null);

    const fn = mode === 'in' ? 'signInWithPassword' : 'signUp';
    const { data, error } = await supabase.auth[fn]({
      email: email.trim(),
      password,
    });

    setBusy(false);

    if (error) { setError(error.message); return; }

    // signUp with confirmation on returns a user but no session
    if (mode === 'up' && !data.session) {
      setNotice('Check your email to confirm your account, then sign in.');
    }
  }

  return (
    <div className="main">
      <div className="center-card card card-pad stack">
        <div>
          <h1>Chop</h1>
          <p className="muted">Screenshot a recipe. Get a shopping list.</p>
        </div>

        <input
          className="field"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(null); }}
        />

        <input
          className="field"
          type="password"
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          placeholder="Password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(null); }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />

        {error && <p className="error">{error}</p>}
        {notice && <p className="ok">{notice}</p>}

        <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>
          {busy ? 'Working…' : mode === 'in' ? 'Sign in' : 'Create account'}
        </button>

        <button className="btn btn-quiet btn-block"
          onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(null); setNotice(null); }}>
          {mode === 'in' ? 'Create an account' : 'I already have an account'}
        </button>
      </div>
    </div>
  );
}
