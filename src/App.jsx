import { useEffect, useState } from 'react';
import { supabase, getHousehold } from './lib/supabase';
import Login from './screens/Login';
import Onboarding from './screens/Onboarding';
import Tonight from './screens/Tonight';
import Week from './screens/Week';
import Shop from './screens/Shop';
import Triage from './screens/Triage';
import Kitchen from './screens/Kitchen';
import Library from './screens/Library';
import Recipe from './screens/Recipe';
import Cook from './screens/Cook';
import Nav from './components/Nav';
import AddSheet from './components/AddSheet';

export default function App() {
  const [session, setSession] = useState(undefined);
  const [household, setHousehold] = useState(undefined);
  const [route, setRoute] = useState(readRoute());
  const [adding, setAdding] = useState(false);

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

  // Cook mode and shop mode take the whole screen. Both happen
  // with one hand somewhere else, so there is no room for chrome.
  if (route.name === 'cook') {
    return <Cook id={route.id} household={household} go={go} />;
  }

  const open = () => setAdding(true);
  const close = () => setAdding(false);

  let screen;
  switch (route.name) {
    case 'recipe':  screen = <Recipe id={route.id} household={household} go={go} />; break;
    case 'week':    screen = <Week household={household} go={go} onAdd={open} />; break;
    case 'shop':    screen = <Shop household={household} go={go} />; break;
    case 'triage':  screen = <Triage household={household} go={go} />; break;
    case 'kitchen': screen = <Kitchen household={household} go={go} />; break;
    case 'library': screen = <Library household={household} go={go} onAdd={open} />; break;
    default:        screen = <Tonight household={household} go={go} onAdd={open} />;
  }

  return (
    <div className={`app ${route.name === 'shop' ? 'app-bare' : ''}`}>
      {route.name !== 'shop' && (
        <Nav route={route} go={go} household={household} onAdd={open} />
      )}
      <main className="panel">{screen}</main>
      {adding && <AddSheet household={household} go={go} onClose={close} />}
    </div>
  );
}

function readRoute() {
  const p = window.location.pathname;

  const r = p.match(/^\/recipe\/([0-9a-f-]+)$/i);
  if (r) return { name: 'recipe', id: r[1] };
  const c = p.match(/^\/cook\/([0-9a-f-]+)$/i);
  if (c) return { name: 'cook', id: c[1] };

  if (p.startsWith('/week'))    return { name: 'week' };
  if (p.startsWith('/shop'))    return { name: 'shop' };
  if (p.startsWith('/triage'))  return { name: 'triage' };
  if (p.startsWith('/kitchen')) return { name: 'kitchen' };
  if (p.startsWith('/library')) return { name: 'library' };

  // old paths, so bookmarks and the PWA shortcut don't 404
  if (p.startsWith('/plan'))     return { name: 'week' };
  if (p.startsWith('/shopping')) return { name: 'shop' };
  if (p.startsWith('/pantry'))   return { name: 'kitchen' };

  return { name: 'tonight' };
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
