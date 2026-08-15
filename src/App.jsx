import { useEffect, useState } from 'react';
import { supabase, getHousehold } from './lib/supabase';
import Login from './screens/Login';
import Onboarding from './screens/Onboarding';
import Import from './screens/Import';
import Discover from './screens/Discover';
import Recipes from './screens/Recipes';
import Recipe from './screens/Recipe';
import Cook from './screens/Cook';
import Plan from './screens/Plan';
import Shopping from './screens/Shopping';
import Pantry from './screens/Pantry';
import Side from './components/Side';

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

  // Cook mode takes the whole screen — no chrome in the kitchen
  if (route.name === 'cook') {
    return <Cook id={route.id} household={household} go={go} />;
  }

  let screen;
  switch (route.name) {
    case 'recipe':   screen = <Recipe id={route.id} household={household} go={go} />; break;
    case 'discover': screen = <Discover household={household} go={go} />; break;
    case 'import':   screen = <Import household={household} go={go} />; break;
    case 'plan':     screen = <Plan household={household} go={go} />; break;
    case 'shopping': screen = <Shopping household={household} />; break;
    case 'pantry':   screen = <Pantry household={household} go={go} />; break;
    default:         screen = <Recipes household={household} go={go} />;
  }

  return (
    <div className="app">
      <Side route={route} go={go} household={household} />
      <main className="panel">{screen}</main>
    </div>
  );
}

function readRoute() {
  const p = window.location.pathname;
  const r = p.match(/^\/recipe\/([0-9a-f-]+)$/i);
  if (r) return { name: 'recipe', id: r[1] };
  const c = p.match(/^\/cook\/([0-9a-f-]+)$/i);
  if (c) return { name: 'cook', id: c[1] };
  if (p.startsWith('/discover')) return { name: 'discover' };
  if (p.startsWith('/import'))   return { name: 'import' };
  if (p.startsWith('/plan'))     return { name: 'plan' };
  if (p.startsWith('/shopping')) return { name: 'shopping' };
  if (p.startsWith('/pantry'))   return { name: 'pantry' };
  return { name: 'recipes' };
}

function Splash() {
  return (
    <div className="splash">
      <span className="mark">
        <i className="mark-slash" />
        <span className="mark-text" style={{ fontSize: 46 }}>Chop!</span>
      </span>
    </div>
  );
}
