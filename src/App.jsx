import { useEffect, useState } from 'react';
import { supabase, getHousehold } from './lib/supabase';
import Login from './screens/Login';
import Onboarding from './screens/Onboarding';
import Import from './screens/Import';
import Recipes from './screens/Recipes';
import Recipe from './screens/Recipe';
import Nav from './components/Nav';

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [household, setHousehold] = useState(undefined);
  const [route, setRoute] = useState(readRoute());

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setHousehold(session === null ? null : undefined); return; }
    getHousehold().then(setHousehold).catch(() => setHousehold(null));
  }, [session]);

  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function go(path) {
    window.history.pushState({}, '', path);
    setRoute(readRoute());
  }

  if (session === undefined) return <Splash />;
  if (!session) return <Login />;
  if (household === undefined) return <Splash />;
  if (!household) return <Onboarding onDone={setHousehold} />;

  let screen;
  if (route.name === 'recipe') {
    screen = <Recipe id={route.id} go={go} />;
  } else if (route.name === 'import') {
    screen = <Import household={household} go={go} />;
  } else {
    screen = <Recipes go={go} />;
  }

  return (
    <div className="shell">
      <Nav route={route} go={go} household={household} />
      <main className="main">{screen}</main>
    </div>
  );
}

function readRoute() {
  const p = window.location.pathname;
  const m = p.match(/^\/recipe\/([0-9a-f-]+)$/i);
  if (m) return { name: 'recipe', id: m[1] };
  if (p.startsWith('/import')) return { name: 'import' };
  return { name: 'recipes' };
}

function Splash() {
  return (
    <div className="splash">
      <span className="eyebrow">Chop</span>
    </div>
  );
}
