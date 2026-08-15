import { useEffect, useState } from 'react';
import { supabase, getHousehold } from './lib/supabase';
import Login from './screens/Login';
import Onboarding from './screens/Onboarding';
import Import from './screens/Import';
import Recipes from './screens/Recipes';
import Recipe from './screens/Recipe';
import Plan from './screens/Plan';
import Shopping from './screens/Shopping';
import Pantry from './screens/Pantry';
import Nav from './components/Nav';

export default function App() {
  const [session, setSession] = useState(undefined);
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
    window.scrollTo(0, 0);
  }

  if (session === undefined) return <Splash />;
  if (!session) return <Login />;
  if (household === undefined) return <Splash />;
  if (!household) return <Onboarding onDone={setHousehold} />;

  let screen;
  switch (route.name) {
    case 'recipe':   screen = <Recipe id={route.id} go={go} />; break;
    case 'import':   screen = <Import household={household} go={go} />; break;
    case 'plan':     screen = <Plan household={household} go={go} />; break;
    case 'shopping': screen = <Shopping household={household} />; break;
    case 'pantry':   screen = <Pantry household={household} go={go} />; break;
    default:         screen = <Recipes go={go} />;
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
  if (p.startsWith('/plan')) return { name: 'plan' };
  if (p.startsWith('/shopping')) return { name: 'shopping' };
  if (p.startsWith('/pantry')) return { name: 'pantry' };
  return { name: 'recipes' };
}

function Splash() {
  return <div className="splash"><span className="mark"><i className="mark-slash" /><span className="mark-text" style={{ fontSize: 46 }}>Chop!</span></span></div>;
}
