/**
 * Theme. Three settings — light, dark, system — because a companion that sits on top of everything
 * you do all day has to match the desktop it lives on, and "system" is the only honest default.
 *
 * The resolved theme is written to `data-theme` on <html> so tokens.css owns every color, and it is
 * also returned so the 3D layer (which cannot read CSS variables) picks the same palette. One source,
 * two consumers — otherwise the canvas and the UI drift apart, which is instantly visible.
 */

import { useEffect, useState, useCallback } from 'react';
import type { Theme } from '../world/districtMaterial';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'x.theme';

function readPreference(): ThemePreference {
  // `?theme=` wins over storage. Two reasons this is a feature and not a test hook: a deep link into
  // a specific appearance is a legitimate thing for a desktop shell to support, and it is the only
  // way an offscreen capture can pin a theme deterministically — `localStorage.setItem` + reload
  // races the first paint, which is exactly how the dark-theme capture kept failing.
  try {
    const q = new URLSearchParams(window.location.search).get('theme');
    if (q === 'light' || q === 'dark' || q === 'system') return q;
  } catch {
    // Malformed query string. Fall through to storage.
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // Private mode or a locked-down profile. Not worth failing over.
  }
  return 'system';
}

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme(): {
  preference: ThemePreference;
  theme: Theme;
  setPreference: (p: ThemePreference) => void;
  cycle: () => void;
} {
  const [preference, setPref] = useState<ThemePreference>(readPreference);
  const [system, setSystem] = useState<Theme>(systemTheme);

  // Follow the OS live. A user flipping Windows to dark at sunset should not have to restart.
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setSystem(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const theme: Theme = preference === 'system' ? system : preference;

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  const setPreference = useCallback((p: ThemePreference) => {
    setPref(p);
    try { localStorage.setItem(STORAGE_KEY, p); } catch { /* see readPreference */ }
  }, []);

  // Light → dark → system → light. Deliberately includes system in the cycle so it stays reachable
  // from the keyboard without opening a menu.
  const cycle = useCallback(() => {
    setPreference(preference === 'light' ? 'dark' : preference === 'dark' ? 'system' : 'light');
  }, [preference, setPreference]);

  return { preference, theme, setPreference, cycle };
}
