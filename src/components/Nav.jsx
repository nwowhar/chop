import { useState } from 'react';
import { supabase } from '../lib/supabase';

const TABS = [
  ['recipes',  '/',         'Recipes'],
  ['plan',     '/plan',     'Week'],
  ['shopping', '/shopping', 'Shop'],
  ['pantry',   '/pantry',   'Pantry'],
  ['import',   '/import',   'Import'],
];

export default function Nav({ route, go, household }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <nav className="nav">
        <span className="nav-brand mark"><i className="mark-slash" /><span className="mark-text">Chop!</span></span>
        {TABS.map(([name, path, label]) => (
          <button key={name} className="nav-link"
            aria-current={route.name === name ? 'page' : undefined}
            onClick={() => go(path)}>{label}</button>
        ))}
        <button className="nav-link" onClick={() => setOpen(!open)} aria-label="Account">···</button>
      </nav>

      {open && (
        <div className="card card-pad stack-s" style={{ margin: 'var(--s-3) var(--s-4)' }}>
          <div>
            <span className="eyebrow">{household.name}</span>
            <p className="muted" style={{ marginTop: 4 }}>
              Invite code: <span className="num">{household.invite_code}</span>
            </p>
          </div>
          <button className="btn btn-quiet" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      )}
    </>
  );
}
