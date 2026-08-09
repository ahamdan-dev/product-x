/**
 * The world window's controls. Everything the camera contract exposes, and nothing else.
 *
 * Placement follows the user's rule: controls live in one consistent place, are not always visible,
 * and appear on hover. They sit bottom-center — reachable, out of the board's sightline, and
 * symmetric so neither the Home nor the Vault corner is favored.
 *
 * There is no free-orbit control and no zoom slider, because the rig does not have those concepts.
 * Exposing a slider that secretly snaps to three values would be a lie told in UI.
 */

import { useEffect } from 'react';
import { useApp } from '../state/store';
import { YAW_PRESETS, type FramingId } from '../world/camera';
import type { ThemePreference } from './useTheme';
import './worldChrome.css';

const FRAMING_LABELS: Record<FramingId, string> = {
  board: 'Board',
  district: 'District',
  close: 'Close',
};

export interface WorldChromeProps {
  themePreference: ThemePreference;
  onCycleTheme: () => void;
  /** Null when hand tracking isn't available in this build. */
  handsEnabled?: boolean;
  onToggleHands?: () => void;
}

export function WorldChrome({
  themePreference, onCycleTheme, handsEnabled, onToggleHands,
}: WorldChromeProps) {
  const preset = useApp(s => s.preset);
  const framing = useApp(s => s.framing);
  const setPreset = useApp(s => s.setPreset);
  const setFraming = useApp(s => s.setFraming);
  const focusedDistrict = useApp(s => s.focusedDistrict);
  const focusDistrict = useApp(s => s.focusDistrict);

  // Keyboard is the primary path for anyone who uses this daily. Arrow keys rotate, +/- change
  // framing, Escape steps back out. Same verbs as the buttons, so nothing is keyboard-only.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      const order = YAW_PRESETS.map(p => p.id);
      const i = order.indexOf(preset);

      switch (e.key) {
        case 'ArrowLeft':
          setPreset(order[(i - 1 + order.length) % order.length]!);
          break;
        case 'ArrowRight':
          setPreset(order[(i + 1) % order.length]!);
          break;
        case '+': case '=':
          setFraming(framing === 'board' ? 'district' : 'close');
          break;
        case '-': case '_':
          setFraming(framing === 'close' ? 'district' : 'board');
          break;
        case 'Escape':
          // Step out one level, then clear focus. Escape should always undo the last narrowing.
          if (framing === 'close') setFraming('district');
          else if (framing === 'district') { setFraming('board'); focusDistrict(null); }
          else if (focusedDistrict) focusDistrict(null);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preset, framing, focusedDistrict, setPreset, setFraming, focusDistrict]);

  return (
    <div className="x-chrome" role="toolbar" aria-label="World view controls">
      {/* Compass. Four corners, always all four visible, because knowing where you *aren't* is
          half of orientation. */}
      <div className="x-chrome__group x-chrome__compass">
        {YAW_PRESETS.map(p => (
          <button
            key={p.id}
            type="button"
            className={`x-chip ${preset === p.id ? 'is-active' : ''}`}
            aria-pressed={preset === p.id}
            onClick={() => setPreset(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="x-chrome__rule" aria-hidden="true" />

      {/* Framing. Three discrete steps, shown as three — matching the rig exactly. */}
      <div className="x-chrome__group">
        {(Object.keys(FRAMING_LABELS) as FramingId[]).map(f => (
          <button
            key={f}
            type="button"
            className={`x-chip ${framing === f ? 'is-active' : ''}`}
            aria-pressed={framing === f}
            onClick={() => setFraming(f)}
          >
            {FRAMING_LABELS[f]}
          </button>
        ))}
      </div>

      <div className="x-chrome__rule" aria-hidden="true" />

      <div className="x-chrome__group">
        {onToggleHands && (
          <button
            type="button"
            className={`x-chip x-chip--icon ${handsEnabled ? 'is-active' : ''}`}
            aria-pressed={!!handsEnabled}
            title={handsEnabled ? 'Hand tracking on — camera in use' : 'Turn on hand tracking'}
            onClick={onToggleHands}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              {/* Four fingers and a thumb. Drawn, not an icon-font glyph. */}
              <path d="M5 9V4.2a1 1 0 0 1 2 0V8" />
              <path d="M7 8V3.4a1 1 0 0 1 2 0V8" />
              <path d="M9 8V4a1 1 0 0 1 2 0v4.6" />
              <path d="M11 8.6V6.4a1 1 0 0 1 2 0V10a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8.4" />
            </svg>
            <span className="x-chip__label">Hands</span>
          </button>
        )}

        <button
          type="button"
          className="x-chip x-chip--icon"
          title={`Theme: ${themePreference}`}
          onClick={onCycleTheme}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            {themePreference === 'dark' ? (
              <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" />
            ) : themePreference === 'light' ? (
              <>
                <circle cx="8" cy="8" r="3" />
                <path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1" />
              </>
            ) : (
              <>
                <circle cx="8" cy="8" r="5.5" />
                <path d="M8 2.5v11" />
              </>
            )}
          </svg>
          <span className="x-chip__label">{themePreference}</span>
        </button>
      </div>
    </div>
  );
}
