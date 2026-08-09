/**
 * The surface switcher.
 *
 * Three surfaces, one segmented control, and the *question* each surface answers rendered under it.
 * The question is the honest reason a tab exists: "What should I do next?" is the product, and a
 * user who reads only the nav should already understand what the app is for.
 *
 * Built as a real ARIA tablist rather than three styled links, because this is a desktop app shell:
 * arrow keys must move between surfaces, and a screen reader has to announce "2 of 3" rather than
 * reading three unrelated buttons.
 *
 * Motion: the active pill is ONE element that slides, not three that fade. A sliding indicator
 * survives a mid-flight change of mind (click Map, then Together before it settles) — cross-fading
 * three separate backgrounds does not, and the visible artefact is two half-lit tabs.
 */

import { useCallback, useRef } from 'react';
import { SURFACES, cycleSurface, surfaceDef, type SurfaceId } from './surfaces';
import './surfaceNav.css';

interface Props {
  active: SurfaceId;
  onSelect: (id: SurfaceId) => void;
}

export function SurfaceNav({ active, onSelect }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  const index = SURFACES.findIndex(s => s.id === active);
  const activeIndex = index === -1 ? 0 : index;

  /** Move focus with selection, which is what a tablist is expected to do. */
  const focusTab = useCallback((id: SurfaceId) => {
    onSelect(id);
    // Focus after React commits, or we hand focus to the element that is about to be re-rendered.
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLButtonElement>(`[data-surface="${id}"]`)?.focus();
    });
  }, [onSelect]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (delta !== 0) {
      e.preventDefault();
      focusTab(cycleSurface(active, delta));
      return;
    }
    if (e.key === 'Home') { e.preventDefault(); focusTab(SURFACES[0]!.id); }
    if (e.key === 'End')  { e.preventDefault(); focusTab(SURFACES[SURFACES.length - 1]!.id); }
  };

  return (
    <header className="x-nav">
      <div
        className="x-nav__rail"
        role="tablist"
        aria-label="Surfaces"
        ref={listRef}
        onKeyDown={onKeyDown}
      >
        {/* The single sliding indicator. `--i` drives the transform so the browser animates one
            composited property and the label text never re-lays-out mid-slide. */}
        <span
          className="x-nav__pill"
          aria-hidden="true"
          style={{ '--i': activeIndex, '--n': SURFACES.length } as React.CSSProperties}
        />
        {SURFACES.map(s => {
          const selected = s.id === active;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              data-surface={s.id}
              aria-selected={selected}
              // Roving tabindex: one stop for the whole control, then arrow keys inside it.
              tabIndex={selected ? 0 : -1}
              className="x-nav__tab"
              onClick={() => onSelect(s.id)}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* The question the active surface answers. aria-live, because it changes meaning when the
          surface changes and a sighted user gets that for free from the animation. */}
      <p className="x-nav__question x-eyebrow" aria-live="polite">
        {surfaceDef(active).question}
      </p>
    </header>
  );
}
