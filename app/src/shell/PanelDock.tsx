/**
 * The summon dock — the secondary layer.
 *
 * One frosted pill under the surface nav. Closed, it is a single button; open, it is a menu of the six
 * utility panels with an honest line each. It is not a tab bar and must never look like one: the three
 * surfaces get a segmented control at the top of the window, and this sits below and behind them in
 * visual weight, because a utility that shouts as loudly as "What should I do next?" is a hierarchy
 * error.
 *
 * ── Why a menu and not six always-visible icons ────────────────────────────────────────────────
 *
 * "ICON CLUTTER" is on the user's own list of what cheapens the product, and six icons parked over a
 * transparent overlay is six pieces of permanent furniture on the student's desktop. So at rest this
 * costs one control. The trade is one extra click, and the mitigation is that the keyboard path has no
 * extra click at all.
 *
 * ── Keyboard ───────────────────────────────────────────────────────────────────────────────────
 *
 * A real menu button: `aria-expanded` + `aria-controls`, arrow keys to move through items, Home/End to
 * jump, Enter/Space to open a panel, Escape to close the menu, and focus returned to the trigger on
 * close so the tab order does not collapse to the top of the document. Alt+P toggles the dock from
 * anywhere. Open items are marked `aria-pressed`, so a screen reader can tell "open Library" from
 * "Library is already open" — which is the difference between a toggle and a launcher.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { PANELS, type PanelId } from './panels';
import './panelDock.css';

interface Props {
  /** Which panels are currently open, so the menu can toggle rather than blindly re-open. */
  openPanels: readonly PanelId[];
  onToggle: (id: PanelId) => void;
  /** Close every open panel. Rendered only when there is something to close. */
  onCloseAll: () => void;
}

export function PanelDock({ openPanels, onToggle, onCloseAll }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  /** Move focus among the menu items by offset, wrapping — same ring behaviour as the surface nav. */
  const focusItem = useCallback((index: number) => {
    const items = rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-dock-item]');
    if (!items || items.length === 0) return;
    const n = items.length;
    items[((index % n) + n) % n]?.focus();
  }, []);

  // Open the menu and land focus on the first item, after React has committed it.
  const openMenu = useCallback(() => {
    setOpen(true);
    requestAnimationFrame(() => focusItem(0));
  }, [focusItem]);

  /**
   * Alt+P from anywhere. Alt rather than a bare letter because the Library's notes field and the
   * Imagine cards take typed input, and a bare shortcut would fire mid-sentence.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        setOpen(v => {
          if (!v) requestAnimationFrame(() => focusItem(0));
          return !v;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusItem]);

  // Dismiss on outside pointer-down. `pointerdown` rather than `click` so the menu is already gone by
  // the time the click lands on whatever the user was actually reaching for.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-dock-item]') ?? [],
    );
    const current = items.indexOf(document.activeElement as HTMLButtonElement);

    if (e.key === 'Escape')     { e.preventDefault(); close(true); return; }
    if (e.key === 'ArrowDown')  { e.preventDefault(); focusItem(current + 1); return; }
    if (e.key === 'ArrowUp')    { e.preventDefault(); focusItem(current - 1); return; }
    if (e.key === 'Home')       { e.preventDefault(); focusItem(0); return; }
    if (e.key === 'End')        { e.preventDefault(); focusItem(items.length - 1); }
  };

  return (
    <div className="x-dock" ref={rootRef}>
      <div className="x-dock__bar x-glass x-glass--thick">
        <button
          ref={triggerRef}
          type="button"
          className="x-dock__trigger"
          aria-expanded={open}
          aria-controls={menuId}
          aria-haspopup="menu"
          onClick={() => (open ? close(false) : openMenu())}
          onKeyDown={e => {
            // ArrowDown from the trigger is the standard way into a menu button's menu.
            if (e.key === 'ArrowDown' && !open) { e.preventDefault(); openMenu(); }
          }}
        >
          {/* Drawn glyph, not emoji — three stacked panels, which is what the menu contains. */}
          <svg className="x-dock__glyph" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M2 3.5h10M2 7h10M2 10.5h6" />
          </svg>
          <span className="x-dock__triggerLabel">Panels</span>
          {/* Count, not a dot: "how many things are on my screen" is the useful number here. */}
          {openPanels.length > 0 && (
            <span className="x-dock__count x-mono" aria-label={`${openPanels.length} open`}>
              {openPanels.length}
            </span>
          )}
        </button>

        {/* The global escape hatch. "ANYTHING THAT CAN POP UP SHOULD ALWAYS BE ABLE TO BE CLOSED":
            each panel has its own close button, and this closes all of them at once, so a screen
            covered in panels is one click from clear. Absent when there is nothing to close. */}
        {openPanels.length > 0 && (
          <button type="button" className="x-dock__clear" onClick={onCloseAll}>
            Close all
          </button>
        )}
      </div>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Utility panels"
          className="x-dock__menu x-glass x-glass--thick"
          onKeyDown={onMenuKeyDown}
        >
          {PANELS.map(p => {
            const isOpen = openPanels.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                role="menuitem"
                data-dock-item
                aria-pressed={isOpen}
                className={isOpen ? 'x-dock__item is-open' : 'x-dock__item'}
                onClick={() => { onToggle(p.id); close(true); }}
              >
                <span className="x-dock__itemHead">
                  <span className="x-dock__itemLabel">{p.label}</span>
                  {/* Only shown when true, so it carries information rather than decorating a row. */}
                  {isOpen && <span className="x-dock__itemState x-eyebrow">Open</span>}
                </span>
                <span className="x-dock__itemPurpose">{p.purpose}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
