/**
 * Surface — the one floating container every panel in the product uses.
 *
 * Implements the user's standing rule in full:
 *   "ANYTHING THAT CAN POP UP ON A USER'S SCREEN SHOULD ALWAYS BE ABLE TO BE EITHER MINIMIZED OR
 *    CLOSED OUT. THOSE ARE ALWAYS SOMEWHERE CONSISTENT AS WELL, DON'T ALWAYS HAVE TO BE VISIBLE,
 *    BUT IF A MOUSE HOVERS OVER IT THEY ARE. THE COMPANION AND ANY CONTAINERS THAT OPEN ARE ALSO
 *    RESIZABLE AND MOVEABLE AROUND SCREEN"
 *
 * Built once, centrally, because the rule is absolute — a panel that forgets its close button is a
 * contract violation, and the only way to guarantee none forget is to make it structurally
 * impossible to render a panel without them.
 *
 * Details that matter:
 *   - Controls are hidden at rest at opacity 0, revealed on hover AND on keyboard focus-within. A
 *     hover-only reveal is inaccessible; focus-within fixes it without adding visible chrome.
 *   - Drag uses pointer capture, so the drag survives the pointer leaving the header. Dragging by
 *     the body is deliberately not allowed — text selection matters more.
 *   - Resize is from three edges plus the corner, not just the corner. Corner-only resize is a
 *     desktop-app tell that the developer stopped at the minimum.
 *   - Position is clamped to keep at least a grabbable strip on screen. A surface dragged off the
 *     top-left and lost forever is the classic floating-window bug.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../state/store';
import './surface.css';

export interface SurfaceProps {
  id: string;
  title: string;
  /** Short category above the title. Encodes a real category, never decoration. */
  eyebrow?: string;
  children: ReactNode;
  /** Extra controls, placed left of minimize/close. */
  actions?: ReactNode;
  /** Frosted glass is only correct over live content. Solid for panels over solid ground. */
  glass?: boolean;
  minWidth?: number;
  minHeight?: number;
}

type ResizeEdge = 'e' | 's' | 'se' | 'w' | 'sw';

/** Keep this much of the surface reachable no matter how far it's dragged. */
const KEEP_ON_SCREEN = 72;

export function Surface({
  id, title, eyebrow, children, actions,
  glass = true, minWidth = 280, minHeight = 180,
}: SurfaceProps) {
  const s = useApp(st => st.surfaces[id]);
  const move = useApp(st => st.moveSurface);
  const resize = useApp(st => st.resizeSurface);
  const raise = useApp(st => st.raiseSurface);
  const close = useApp(st => st.closeSurface);
  const toggleMin = useApp(st => st.toggleMinimize);

  const ref = useRef<HTMLElement>(null);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState<ResizeEdge | null>(null);

  // Live geometry during a gesture, so we don't write to the store on every pointer event.
  const gesture = useRef({ px: 0, py: 0, x: 0, y: 0, w: 0, h: 0 });

  const clampPosition = useCallback((x: number, y: number, w: number) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      x: Math.max(KEEP_ON_SCREEN - w, Math.min(x, vw - KEEP_ON_SCREEN)),
      y: Math.max(0, Math.min(y, vh - 40)),
    };
  }, []);

  const onHeaderPointerDown = useCallback((e: React.PointerEvent) => {
    // Never start a drag from a control — that would make the close button feel broken.
    if ((e.target as HTMLElement).closest('[data-surface-control]')) return;
    if (e.button !== 0 || !s) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { px: e.clientX, py: e.clientY, x: s.x, y: s.y, w: s.width, h: s.height };
    setDragging(true);
    raise(id);
  }, [s, id, raise]);

  const onResizePointerDown = useCallback((edge: ResizeEdge) => (e: React.PointerEvent) => {
    if (e.button !== 0 || !s) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { px: e.clientX, py: e.clientY, x: s.x, y: s.y, w: s.width, h: s.height };
    setResizing(edge);
    raise(id);
  }, [s, id, raise]);

  useEffect(() => {
    if (!dragging && !resizing) return;

    const onMove = (e: PointerEvent) => {
      const g = gesture.current;
      const dx = e.clientX - g.px;
      const dy = e.clientY - g.py;

      if (dragging) {
        const { x, y } = clampPosition(g.x + dx, g.y + dy, g.w);
        move(id, x, y);
        return;
      }

      if (!resizing) return;
      let w = g.w, h = g.h, x = g.x;
      if (resizing.includes('e')) w = Math.max(minWidth, g.w + dx);
      if (resizing.includes('s')) h = Math.max(minHeight, g.h + dy);
      if (resizing.includes('w')) {
        // Dragging the west edge moves the origin and inverts the delta — get this wrong and the
        // panel walks across the screen while resizing.
        w = Math.max(minWidth, g.w - dx);
        x = g.x + (g.w - w);
      }
      resize(id, w, h);
      if (x !== g.x) move(id, x, g.y);
    };

    const onUp = () => { setDragging(false); setResizing(null); };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, resizing, id, move, resize, clampPosition, minWidth, minHeight]);

  // A surface must never end up off-screen after the window shrinks.
  useEffect(() => {
    if (!s) return;
    const onResizeWindow = () => {
      const { x, y } = clampPosition(s.x, s.y, s.width);
      if (x !== s.x || y !== s.y) move(id, x, y);
    };
    window.addEventListener('resize', onResizeWindow);
    return () => window.removeEventListener('resize', onResizeWindow);
  }, [s, id, move, clampPosition]);

  // Escape closes the focused surface. Standard, and expected.
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(id); }
  }, [close, id]);

  if (!s || !s.open) return null;

  const collapsed = s.minimized;

  return (
    <section
      ref={ref}
      className={[
        'x-surface',
        glass ? 'is-glass' : 'is-solid',
        collapsed ? 'is-collapsed' : '',
        dragging || resizing ? 'is-gesturing' : '',
      ].filter(Boolean).join(' ')}
      style={{
        left: s.x,
        top: s.y,
        width: s.width,
        height: collapsed ? undefined : s.height,
        zIndex: 40 + s.order,
      }}
      onPointerDownCapture={() => raise(id)}
      onKeyDown={onKeyDown}
      aria-label={title}
      tabIndex={-1}
    >
      <header
        className="x-surface__bar"
        onPointerDown={onHeaderPointerDown}
        onDoubleClick={() => toggleMin(id)}
      >
        <div className="x-surface__id">
          {eyebrow && <span className="x-eyebrow">{eyebrow}</span>}
          <h2 className="x-surface__title">{title}</h2>
        </div>

        {/* Consistent position, every surface: top-right, inset. Hidden until hover or focus. */}
        <div className="x-surface__controls">
          {actions}
          <button
            data-surface-control
            className="x-surface__ctl"
            onClick={() => toggleMin(id)}
            title={collapsed ? 'Expand' : 'Minimize'}
            aria-label={collapsed ? 'Expand' : 'Minimize'}
          >
            {/* Drawn glyphs, not emoji — the checklist forbids emoji as iconography. */}
            <svg viewBox="0 0 12 12" aria-hidden="true">
              {collapsed
                ? <path d="M2.5 7.25 6 3.75l3.5 3.5" />
                : <path d="M2.5 6h7" />}
            </svg>
          </button>
          <button
            data-surface-control
            className="x-surface__ctl x-surface__ctl--close"
            onClick={() => close(id)}
            title="Close"
            aria-label="Close"
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </button>
        </div>
      </header>

      {!collapsed && <div className="x-surface__body">{children}</div>}

      {/* Three edges plus the corner. Corner-only resize is a half-finished tell. */}
      {!collapsed && (
        <>
          <span className="x-surface__grip x-surface__grip--e"  onPointerDown={onResizePointerDown('e')}  />
          <span className="x-surface__grip x-surface__grip--w"  onPointerDown={onResizePointerDown('w')}  />
          <span className="x-surface__grip x-surface__grip--s"  onPointerDown={onResizePointerDown('s')}  />
          <span className="x-surface__grip x-surface__grip--se" onPointerDown={onResizePointerDown('se')} />
          <span className="x-surface__grip x-surface__grip--sw" onPointerDown={onResizePointerDown('sw')} />
        </>
      )}
    </section>
  );
}
