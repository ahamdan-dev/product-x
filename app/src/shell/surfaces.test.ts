import { describe, it, expect } from 'vitest';
import {
  SURFACES, DEFAULT_SURFACE, resolveRoute, isSurface, surfaceDef, cycleSurface,
  baseHash, panelSlugOf, withPanel, PANEL_SEGMENT,
  type SurfaceId,
} from './surfaces';
import {
  PANELS, panelById, panelBySlug, panelSurfaceId, initialGeometry, type PanelId,
} from './panels';
import { getPivotOptions } from '../imagine/pivots';
import { SUBJECTS } from '../content/subjects';
import { useApp } from '../state/store';

/** The real district list, read from the store's seeded state — the same source the panel reads. */
const DISTRICTS = useApp.getState().districts;

describe('the three-surface constraint', () => {
  it('is exactly three surfaces — Today, Map, Together', () => {
    // NORTH-STAR: three surfaces only. If this fails, either the product law changed or a tab was
    // smuggled in as a surface. Both need a human decision, which is the point of asserting it.
    expect(SURFACES.map(s => s.id)).toEqual(['today', 'map', 'together']);
  });

  it('gives every surface a question it answers', () => {
    for (const s of SURFACES) {
      expect(s.question.length, s.id).toBeGreaterThan(0);
      expect(s.question.endsWith('?'), `${s.id}: "${s.question}"`).toBe(true);
    }
  });

  it('has a unique hash per surface', () => {
    const hashes = SURFACES.map(s => s.hash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});

describe('routing', () => {
  it('resolves each surface hash to its own id', () => {
    for (const s of SURFACES) expect(resolveRoute(s.hash)).toBe(s.id);
  });

  it('matches the companion window by prefix, since it appends its own state', () => {
    expect(resolveRoute('#/companion')).toBe('companion');
    expect(resolveRoute('#/companion?state=talking')).toBe('companion');
  });

  it('lands unknown and empty hashes on Today, never on the Map', () => {
    // An unrecognised deep link should open the surface that tells you what to do, not the one that
    // costs the most to render.
    for (const h of ['', '#', '#/', '#/nope', '#/MAP', '#/todayy']) {
      expect(resolveRoute(h), h).toBe(DEFAULT_SURFACE);
    }
    expect(DEFAULT_SURFACE).toBe('today');
  });

  it('separates the companion overlay from the surfaces', () => {
    expect(isSurface('companion')).toBe(false);
    for (const s of SURFACES) expect(isSurface(s.id)).toBe(true);
  });

  it('has a definition for every id the type allows', () => {
    const ids: SurfaceId[] = ['today', 'map', 'together'];
    for (const id of ids) expect(surfaceDef(id).id).toBe(id);
  });
});

describe('the panel layer is a second layer, not a fourth surface', () => {
  it('keeps every panel out of the surface list', () => {
    // The whole point of the secondary layer. If a panel id ever shows up as a surface, the
    // three-surface law has been broken by the back door.
    const surfaceIds: string[] = SURFACES.map(s => s.id);
    for (const p of PANELS) expect(surfaceIds, p.id).not.toContain(p.id);
  });

  it('addresses a panel as a suffix of a surface, never as a sibling', () => {
    // A panel hash must always still name the surface it sits on — so there is no hash meaning
    // "the Library instead of a surface".
    for (const p of PANELS) {
      const hash = withPanel('#/today', p.slug);
      expect(hash.startsWith('#/today'), hash).toBe(true);
      expect(resolveRoute(hash), hash).toBe('today');
    }
  });

  it('gives every panel a unique id, slug and store id', () => {
    expect(new Set(PANELS.map(p => p.id)).size).toBe(PANELS.length);
    expect(new Set(PANELS.map(p => p.slug)).size).toBe(PANELS.length);
    expect(new Set(PANELS.map(p => panelSurfaceId(p.id))).size).toBe(PANELS.length);
  });

  it('namespaces store ids so they cannot collide with the subject cards Today opens', () => {
    // The store keys default geometry on the segment before the colon, so an un-namespaced
    // 'settings' would be one collision away from inheriting an unrelated panel's size.
    for (const p of PANELS) expect(panelSurfaceId(p.id)).toBe(`panel:${p.id}`);
  });

  it('states a purpose for every panel', () => {
    // A panel that cannot say what it does without overclaiming should not ship — same check the
    // surfaces get on their question.
    for (const p of PANELS) {
      expect(p.purpose.length, p.id).toBeGreaterThan(0);
      expect(p.label.length, p.id).toBeGreaterThan(0);
    }
  });

  it('has a definition for every id the type allows, by id and by slug', () => {
    const ids: PanelId[] = ['activity', 'library', 'settings', 'sims', 'imagine', 'companion'];
    expect(new Set(ids)).toEqual(new Set(PANELS.map(p => p.id)));
    for (const id of ids) {
      const def = panelById(id);
      expect(def.id).toBe(id);
      expect(panelBySlug(def.slug)?.id).toBe(id);
    }
  });
});

describe('panel hash mechanics', () => {
  it('strips the panel suffix to find the surface', () => {
    expect(baseHash('#/map/panel/settings')).toBe('#/map');
    expect(baseHash('#/today')).toBe('#/today');
  });

  it('resolves a panel deep link to the surface it is overlaid on, not to the default', () => {
    // This is the regression that matters: before the suffix was stripped, every panel deep link
    // fell through the exact-match and silently landed on Today.
    expect(resolveRoute('#/map/panel/settings')).toBe('map');
    expect(resolveRoute('#/together/panel/library')).toBe('together');
    expect(resolveRoute('#/today/panel/activity')).toBe('today');
  });

  it('reads the slug back out of a hash', () => {
    expect(panelSlugOf('#/map/panel/settings')).toBe('settings');
    expect(panelSlugOf('#/today')).toBeNull();
  });

  it('treats a truncated panel link as no panel rather than as an empty one', () => {
    expect(panelSlugOf(`#/today${PANEL_SEGMENT}`)).toBeNull();
  });

  it('round-trips every real panel on every real surface', () => {
    for (const s of SURFACES) {
      for (const p of PANELS) {
        const hash = withPanel(s.hash, p.slug);
        expect(resolveRoute(hash), hash).toBe(s.id);
        expect(panelSlugOf(hash), hash).toBe(p.slug);
        expect(panelBySlug(panelSlugOf(hash)!)?.id, hash).toBe(p.id);
      }
    }
  });

  it('drops the suffix when there is no panel, so the hash never names a closed panel', () => {
    expect(withPanel('#/today/panel/library', null)).toBe('#/today');
    expect(withPanel('#/today', null)).toBe('#/today');
  });

  it('replaces rather than stacks when switching panels on the same surface', () => {
    // Composing from an already-suffixed hash must not produce '#/today/panel/a/panel/b'.
    expect(withPanel('#/today/panel/library', 'settings')).toBe('#/today/panel/settings');
  });

  it('ignores an unknown slug instead of treating it as an error', () => {
    // A stale link should land you on a working surface, not on a dead end.
    expect(resolveRoute('#/today/panel/nope')).toBe('today');
    expect(panelBySlug('nope')).toBeUndefined();
  });

  it('still lands a hash that is only a panel suffix on the default surface', () => {
    expect(resolveRoute('#/panel/library')).toBe(DEFAULT_SURFACE);
  });
});

describe('panel geometry always lands fully on screen', () => {
  // The one failure this product cannot ship: a panel extending past the viewport has no reachable
  // close button on the side that is off screen.
  const VIEWPORTS: Array<[number, number]> = [
    [1900, 1100], [1600, 1000], [1280, 800], [1024, 768], [768, 600], [480, 640], [480, 400],
  ];

  it('fits inside every viewport from 1900px down to 480px', () => {
    for (const p of PANELS) {
      for (const [vw, vh] of VIEWPORTS) {
        const g = initialGeometry(p, vw, vh);
        const where = `${p.id} @ ${vw}x${vh}`;
        expect(g.x, where).toBeGreaterThanOrEqual(0);
        expect(g.y, where).toBeGreaterThanOrEqual(0);
        expect(g.x + g.width, where).toBeLessThanOrEqual(vw);
        expect(g.y + g.height, where).toBeLessThanOrEqual(vh);
      }
    }
  });

  it('never collapses a panel to an unusable size', () => {
    for (const p of PANELS) {
      for (const [vw, vh] of VIEWPORTS) {
        const g = initialGeometry(p, vw, vh);
        expect(g.width, `${p.id} @ ${vw}x${vh}`).toBeGreaterThan(0);
        expect(g.height, `${p.id} @ ${vw}x${vh}`).toBeGreaterThan(0);
      }
    }
  });

  it('never exceeds the panel’s own declared size when there is room', () => {
    for (const p of PANELS) {
      const g = initialGeometry(p, 1900, 1200);
      expect(g.width, p.id).toBe(p.width);
      expect(g.height, p.id).toBe(p.height);
    }
  });

  it('opens below the chrome so the surface nav is never covered', () => {
    for (const p of PANELS) {
      // Roomy window: the panel should be pushed clear of the nav and the dock, not overlapping them.
      expect(initialGeometry(p, 1600, 1000).y, p.id).toBeGreaterThanOrEqual(16);
    }
  });
});

describe('keyboard cycling', () => {
  it('steps forward and back', () => {
    expect(cycleSurface('today', 1)).toBe('map');
    expect(cycleSurface('map', 1)).toBe('together');
    expect(cycleSurface('map', -1)).toBe('today');
  });

  it('wraps at both ends rather than dead-ending', () => {
    expect(cycleSurface('together', 1)).toBe('today');
    expect(cycleSurface('today', -1)).toBe('together');
  });

  it('handles a delta larger than the ring', () => {
    // Guards the double-modulo: a negative dividend keeps its sign in JS.
    expect(cycleSurface('today', 3)).toBe('today');
    expect(cycleSurface('today', -4)).toBe('together');
    expect(cycleSurface('today', 4)).toBe('map');
  });
});

/**
 * The pivot chip labels.
 *
 * `getPivotOptions` is pure and cannot reach the store, so its `label` is the subject *summary* — a full
 * sentence. That is correct for the module and wrong for a chip: rendered directly it forced every pivot
 * to become a full-width stacked card, which is what the first capture showed. The panel therefore
 * resolves district names itself and passes a resolver down. These assert the two halves of that contract.
 */
describe('pivot options are addressed by id, so a host can rename them', () => {
  it('returns an id that is a real district, not just display text', () => {
    // The resolver is keyed by `opt.id`, so if these ids were ever labels the chips would silently
    // fall back to sentences for every pivot.
    const ids = new Set(DISTRICTS.map(d => d.id));
    for (const subj of SUBJECTS) {
      for (const opt of getPivotOptions(subj.id)) {
        expect(ids.has(opt.id), `${subj.id} pivots to unknown district ${opt.id}`).toBe(true);
      }
    }
  });

  it('every pivot id can be resolved to a short display name', () => {
    // "Short" is the whole point: a chip must be a name, not a sentence. The longest real district
    // label is "Cell & Molecular" at 16 characters, so 40 is a generous ceiling that still fails if
    // someone starts feeding summaries back in.
    for (const subj of SUBJECTS) {
      for (const opt of getPivotOptions(subj.id)) {
        const label = DISTRICTS.find(d => d.id === opt.id)?.label;
        expect(label, opt.id).toBeTruthy();
        expect(label!.length, `${opt.id} label too long for a chip`).toBeLessThan(40);
        expect(label!.includes('.'), `${opt.id} label is a sentence, not a name`).toBe(false);
      }
    }
  });

  it('the summary it falls back to is a real sentence, so the fallback is still readable', () => {
    // If no resolver is supplied the chip shows `opt.label`. That path must stay coherent.
    for (const opt of getPivotOptions('cell')) {
      expect(opt.label.length).toBeGreaterThan(0);
      expect(opt.reason.length).toBeGreaterThan(0);
    }
  });
});
