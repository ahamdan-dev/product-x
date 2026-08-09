/**
 * Entry point. Tokens first, so the very first paint already has the palette — importing CSS after
 * the component tree means one frame of unstyled content, which on a transparent always-on-top
 * window looks like a flash of garbage on the user's desktop.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import { App } from './App';
import { useApp } from './state/store';

const host = document.getElementById('root');
if (!host) throw new Error('#root missing from index.html');

/**
 * Store handle for the screenshot harness and for driving states by hand while designing.
 * Deliberately kept in production too: this is a local desktop app, there is no untrusted page to
 * defend against, and being able to put the world into an exact state without clicking through the UI
 * is what makes visual review possible at all.
 */
declare global {
  // eslint-disable-next-line no-var
  var __x: ReturnType<typeof useApp.getState>;
}
globalThis.__x = useApp.getState();
useApp.subscribe(s => { globalThis.__x = s; });

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
