import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function send() {
    if (!email.trim()) { setError('Enter your email address'); return; }
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) setError(error.message); else setSent(true);
  }

  return (
    <div className="main">
      <div className="center-card card card-pad stack">
        <div>
          <h1>Chop</h1>
          <p className="muted">Screenshot a recipe. Get a shopping list.</p>
        </div>

        {sent ? (
          <p className="ok">Check your email for a sign-in link.</p>
        ) : (
          <>
            <input
              className="field"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(null); }}
              onKeyDown={(e) => e.key === 'Enter' && send()}
            />
            {error && <p className="error">{error}</p>}
            <button className="btn btn-primary btn-block" onClick={send} disabled={busy}>
              {busy ? 'Sending…' : 'Send sign-in link'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
