import { supabase } from '../lib/supabase';

export default function Nav({ route, go }) {
  return (
    <nav className="nav">
      <span className="nav-brand">Chop</span>
      <button className="nav-link" aria-current={route.name === 'recipes' ? 'page' : undefined}
        onClick={() => go('/')}>Recipes</button>
      <button className="nav-link" aria-current={route.name === 'import' ? 'page' : undefined}
        onClick={() => go('/import')}>Import</button>
      <button className="nav-link" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </nav>
  );
}
