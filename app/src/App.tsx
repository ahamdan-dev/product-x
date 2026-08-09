/**
 * Route split. Two Electron windows load the same bundle and diverge on the hash:
 *   #/companion — the always-on-top, click-through, transparent companion
 *   everything else — the main window, which is the three-surface Shell
 *
 * One bundle, two roots. The alternative is two Vite entries, which doubles the build and guarantees
 * the two windows eventually drift out of sync on shared state and shared tokens.
 *
 * The main window renders `Shell`, not `WorldView`, because the Map is one of three surfaces rather
 * than the whole product — Today answers "what should I do next", the Map answers "what do I actually
 * know", Together answers "who am I learning with". `Shell` owns which one is showing and lazy-loads
 * the Map so its ~1 MB of three.js never blocks Today's first paint.
 *
 * `#/world` still resolves, straight to the Map surface, because the Electron menu and existing deep
 * links use it. That mapping lives in `shell/surfaces.ts`, so it is tested rather than assumed.
 */

import { useEffect, useState } from 'react';
import { Shell } from './shell/Shell';
import { CompanionView } from './views/CompanionView';

type Route = 'world' | 'companion';

function readRoute(): Route {
  return window.location.hash.startsWith('#/companion') ? 'companion' : 'world';
}

export function App() {
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // The companion window is transparent; the world window is not. This has to be set on <html> and
  // <body> or Chromium paints its default white behind the canvas and the transparency is lost.
  useEffect(() => {
    document.documentElement.dataset['route'] = route;
  }, [route]);

  return route === 'companion' ? <CompanionView /> : <Shell />;
}
