import { useState } from 'react';
import { supabase } from '../lib/supabase';

// Four places, organised by what you're doing rather than by
// which table the data lives in. Adding is an action, not a
// destination, so it sits in the corner of every screen.

const LINKS = [
  ['tonight', '/',        'Tonight'],
  ['week',    '/week',    'Week'],
  ['kitchen', '/kitchen', 'Kitchen'],
  ['library', '/library', 'Library'],
];

export default function Nav({ route, go, household, onAdd }) {
  const [menu, setMenu] = useState(false);

  return (
    <>
      <nav className="nav">
        <button className="nav-brand mark" onClick={() => go('/')}>
          <i className="mark-slash" />
          <span className="mark-text">Chop!</span>
        </button>

        <div className="nav-links">
          {LINKS.map(([name, path, label]) => (
            <button key={name} className="nav-link"
              aria-current={route.name === name ? 'page' : undefined}
              onClick={() => go(path)}>{label}</button>
          ))}
        </div>

        <div className="nav-foot">
          <button className="btn btn-accent nav-add" onClick={onAdd}>
            <span className="nav-add-plus">+</span>
            <span className="nav-add-word">Add</span>
          </button>
          <button className="nav-link nav-more" onClick={() => setMenu(!menu)}
            aria-label="Account">···</button>
        </div>
      </nav>

      {menu && (
        <div className="nav-menu card card-pad stack-s">
          <div>
            <span className="eyebrow">{household.name}</span>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Invite code <span className="num">{household.invite_code}</span>
            </p>
          </div>
          <button className="btn btn-quiet" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      )}
    </>
  );
}
