/**
 * Click-through for the main window — the live wiring.
 *
 * The rule for "do we own this pixel?" lives in `passthrough.ts` and is pure and unit-tested. This file
 * only does the parts that need a real window: sample the pointer, ask the rule, and cross the IPC
 * boundary when the answer changes.
 *
 * The window sits in ignore-mouse-events mode with `forward: true`, which passes clicks through to
 * whatever is underneath while still delivering mouse *moves*. Those forwarded moves are what let us
 * notice the pointer arriving on a card and turn interactivity back on before the click lands.
 */

import { useEffect } from 'react';
import { ownsPoint } from './passthrough';

interface PassthroughApi {
  setWorldInteractive: (interactive: boolean) => Promise<void>;
}

function api(): PassthroughApi | null {
  const px = (window as unknown as { px?: Partial<PassthroughApi> }).px;
  return px && typeof px.setWorldInteractive === 'function' ? (px as PassthroughApi) : null;
}

/**
 * Enable click-through for the lifetime of the component.
 *
 * A no-op outside Electron — the preload bridge is absent in a browser and in tests — so the same code
 * path runs everywhere rather than being guarded at the call site.
 */
export function usePassthrough(enabled = true): void {
  useEffect(() => {
    const px = api();
    if (!enabled || !px) return;

    // Tracked locally so the IPC boundary is crossed only on an actual change. Sending the same value on
    // every pointer move would put a round trip on the input path.
    let owned: boolean | null = null;
    let frame = 0;

    const apply = (next: boolean) => {
      if (next === owned) return;
      owned = next;
      void px.setWorldInteractive(next);
    };

    const sample = (x: number, y: number) => apply(ownsPoint(document, x, y));

    const onMove = (e: PointerEvent) => {
      // One hit test per frame. Pointer moves arrive faster than the screen updates, and reacting faster
      // than a frame is invisible.
      if (frame) return;
      const { clientX, clientY } = e;
      frame = requestAnimationFrame(() => {
        frame = 0;
        sample(clientX, clientY);
      });
    };

    /**
     * Re-sample when the UI changes shape under a stationary pointer.
     *
     * Opening a panel, switching surfaces, or a lazy surface finishing its load all move content under a
     * cursor that has not moved, and with no pointer event there is nothing to trigger a re-test — the
     * window would stay passed-through over a card that is now sitting under the cursor, and the first
     * click on it would go to the desktop. Sampling the last known position closes that gap.
     */
    let lastX = -1;
    let lastY = -1;
    const track = (e: PointerEvent) => { lastX = e.clientX; lastY = e.clientY; };
    const resample = () => { if (lastX >= 0) sample(lastX, lastY); };

    // Leaving the window hands the clicks back to the desktop. Without this the window stays live after
    // the pointer exits over one of our surfaces.
    const onLeave = () => apply(false);

    // Start passed-through: at first paint the pointer is wherever the user left it, and assuming it is
    // over us would block a click the app has no reason to claim.
    apply(false);

    const observer = new MutationObserver(() => {
      // Coalesced into the frame loop for the same reason as pointer moves: a panel opening produces a
      // burst of mutations and one re-test per burst is enough.
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; resample(); });
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['hidden', 'class', 'style'] });

    window.addEventListener('pointermove', track, { passive: true, capture: true });
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('pointermove', track, { capture: true });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      // Hand the window back usable. Leaving it click-through on unmount would strand it unclickable if
      // the shell ever remounts.
      void px.setWorldInteractive(true);
    };
  }, [enabled]);
}
