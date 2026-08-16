import { useEffect, useState } from 'react';
import { supabase, getPantry } from '../lib/supabase';

const LINKS = [
  ['home',     '/',         'Home'],
  ['recipes',  '/library',  'Library'],
  ['discover', '/discover', 'Find'],
  ['plan',     '/plan',     'Week'],
  ['shopping', '/shopping', 'Shopping'],
  ['pantry',   '/pantry',   'Pantry'],
  ['import',   '/import',   'Import'],
];

export default function Side({ route, go, household }) {
  const [expiring, setExpiring] = useState([]);

  useEffect(() => {
    getPantry(household.id)
      .then((rows) => setExpiring(
        rows.filter((r) => r.freshness === 'soon' || r.freshness === 'expired')))
      .catch(() => {});
  }, [household.id, route.name]);

  return (
    <aside className="side">
      <button className="side-brand mark" onClick={() => go('/')}
        style={{ border: 0, background: 'none', cursor: 'pointer' }}>
        <i className="mark-slash" />
        <span className="mark-text" style={{ fontSize: 25 }}>Chop!</span>
      </button>

      {LINKS.map(([name, path, label]) => (
        <button key={name} className="side-link"
          aria-current={route.name === name ? 'page' : undefined}
          onClick={() => go(path)}>{label}</button>
      ))}

      <div className="side-foot">
        {expiring.length > 0 && (
          <div className="expiring" style={{ marginBottom: 'var(--s-2)' }}>
            <strong style={{ fontSize: 'var(--t-small)' }}>
              {expiring.length} thing{expiring.length > 1 ? 's' : ''} expiring
            </strong>
            <p className="tiny" style={{ margin: '3px 0 0' }}>
              {expiring.slice(0, 4).map((e) => e.canonical_name).join(', ')}
            </p>
          </div>
        )}
        <button className="side-link" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </div>
    </aside>
  );
}
