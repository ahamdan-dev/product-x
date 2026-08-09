import { describe, it, expect } from 'vitest';
import {
  resolveAssetUrl,
  parseCompanionManifest,
  attributionText,
  chooseClips,
  needsZUpToYUp,
  rotateZUpToYUp,
  normaliseUpright,
  assessRigIntegrity,
  checkImportSize,
  describeModelImport,
  placeRigInWindow,
  rectsToClipPath,
  MAX_IMPORT_BYTES,
  TEAR_THRESHOLD_RATIO,
  type PixelBox,
} from './glbSource';

describe('resolveAssetUrl', () => {
  // The packaged app runs over file:// with Vite's base './'. An absolute path silently discards
  // the base and 404s only in production, so this is the regression that matters most.
  it('resolves against a file:// base, as in the packaged Electron app', () => {
    const url = resolveAssetUrl('companions/companion-a.glb', 'file:///C:/app/dist/index.html');
    expect(url).toBe('file:///C:/app/dist/index.html'.replace('index.html', 'companions/companion-a.glb'));
  });

  it('resolves against an http base, as in vite dev', () => {
    expect(resolveAssetUrl('companions/companion-a.glb', 'http://localhost:5173/')).toBe(
      'http://localhost:5173/companions/companion-a.glb',
    );
  });

  it('strips a leading slash so the document base is never discarded', () => {
    // Without the strip this would resolve to file:///companions/... and fail in production.
    expect(resolveAssetUrl('/companions/a.glb', 'file:///C:/app/dist/index.html')).toBe(
      'file:///C:/app/dist/companions/a.glb',
    );
  });

  it('keeps a nested base path intact', () => {
    expect(resolveAssetUrl('companions/a.glb', 'http://host/sub/dir/index.html')).toBe(
      'http://host/sub/dir/companions/a.glb',
    );
  });
});

describe('parseCompanionManifest', () => {
  const good = {
    license: {
      pack: 'Free Animation Pack - City People Commons',
      author: 'Denys Almaral',
      license: 'CC BY 4.0',
      requires_attribution: true,
      source: 'https://denysalmaral.com/',
      notice: 'Character animations by Denys Almaral, licensed CC BY 4.0.',
    },
    targetHeight: 1.75,
    companions: [
      { id: 'companion-a', label: 'Ash', rig: 'male', file: 'companions/companion-a.glb', bytes: 723188,
        clips: [{ name: 'idle1' }, { name: 'celebrate' }] },
    ],
  };

  it('reads the licence, target height, companions and clip names', () => {
    const m = parseCompanionManifest(good);
    expect(m).not.toBeNull();
    expect(m!.license.author).toBe('Denys Almaral');
    expect(m!.license.license).toBe('CC BY 4.0');
    expect(m!.targetHeight).toBe(1.75);
    expect(m!.companions[0]!.label).toBe('Ash');
    expect(m!.companions[0]!.clips).toEqual(['idle1', 'celebrate']);
  });

  it('returns null for junk rather than throwing', () => {
    expect(parseCompanionManifest(null)).toBeNull();
    expect(parseCompanionManifest('nope')).toBeNull();
    expect(parseCompanionManifest({})).toBeNull();
    expect(parseCompanionManifest({ companions: [] })).toBeNull();
  });

  it('skips companion entries with no id or file instead of emitting a broken card', () => {
    const m = parseCompanionManifest({ ...good, companions: [{ label: 'Ghost' }, good.companions[0]] });
    expect(m!.companions).toHaveLength(1);
    expect(m!.companions[0]!.id).toBe('companion-a');
  });

  // Attribution is a legal obligation, so a missing licence block must not read as "no attribution
  // needed". It fails towards requiring it.
  it('defaults requiresAttribution to true when the licence block is absent', () => {
    const m = parseCompanionManifest({ companions: good.companions });
    expect(m!.license.requiresAttribution).toBe(true);
  });

  it('honours an explicit requires_attribution: false', () => {
    const m = parseCompanionManifest({
      ...good,
      license: { ...good.license, requires_attribution: false },
    });
    expect(m!.license.requiresAttribution).toBe(false);
  });
});

describe('attributionText', () => {
  it('prefers the notice the licence file ships', () => {
    expect(
      attributionText({
        pack: 'p', author: 'Denys Almaral', license: 'CC BY 4.0',
        requiresAttribution: true, source: '', notice: 'Character animations by Denys Almaral, licensed CC BY 4.0.',
      }),
    ).toBe('Character animations by Denys Almaral, licensed CC BY 4.0.');
  });

  it('still names author and licence when no notice is provided', () => {
    const t = attributionText({
      pack: '', author: 'Denys Almaral', license: 'CC BY 4.0',
      requiresAttribution: true, source: '', notice: '',
    });
    expect(t).toContain('Denys Almaral');
    expect(t).toContain('CC BY 4.0');
  });
});

describe('chooseClips', () => {
  it('picks idle1 and celebrate for the full rig', () => {
    const c = chooseClips(['idle1', 'idle2', 'walk', 'talk', 'celebrate', 'flourish', 'hype', 'dance']);
    expect(c.idle).toBe('idle1');
    expect(c.lively).toBe('celebrate');
  });

  // Companion B ships neither talk nor flourish; hard-coding either freezes that card.
  it('works for a rig missing talk and flourish', () => {
    const c = chooseClips(['idle1', 'idle2', 'walk', 'celebrate', 'hype', 'dance']);
    expect(c.idle).toBe('idle1');
    expect(c.lively).toBe('celebrate');
  });

  it('falls back to the first clip when nothing is named like an idle', () => {
    const c = chooseClips(['mystery_clip', 'hype']);
    expect(c.idle).toBe('mystery_clip');
    expect(c.lively).toBe('hype');
  });

  // A hover that plays the clip already playing looks like a broken control.
  it('never returns the idle clip as the reward clip', () => {
    const c = chooseClips(['walk']);
    expect(c.idle).toBe('walk');
    expect(c.lively).toBeNull();
  });

  it('handles an empty clip list', () => {
    expect(chooseClips([])).toEqual({ idle: null, lively: null });
  });
});

describe('rotateZUpToYUp', () => {
  // The shipped rigs' geometry is a T-pose lying in the XZ plane: 1.767 wide, 0.316 thick,
  // 1.760 long. Standing it up must move that 1.760 onto Y.
  it('turns the measured Z-up companion box into a standing figure', () => {
    const flat = { min: [-0.475, -0.001, -0.746] as const, max: [1.292, 0.315, 1.014] as const };
    const up = rotateZUpToYUp(flat);
    expect(up.max[1] - up.min[1]).toBeCloseTo(1.76, 3);   // height comes from source Z
    expect(up.max[2] - up.min[2]).toBeCloseTo(0.316, 3);  // depth comes from source Y
    expect(up.max[0] - up.min[0]).toBeCloseTo(1.767, 3);  // width is unchanged
  });

  it('is its own inverse when applied four times', () => {
    const b = { min: [-1, -2, -3] as const, max: [4, 5, 6] as const };
    const four = rotateZUpToYUp(rotateZUpToYUp(rotateZUpToYUp(rotateZUpToYUp(b))));
    expect(four.min).toEqual(b.min);
    expect(four.max).toEqual(b.max);
  });
});

describe('needsZUpToYUp', () => {
  /*
   * This exists because the rotation used to be unconditional, and the converter's own output then
   * got laid on its back. Both boxes below are measured, not invented: the first from
   * `tools/glb_shape_probe.cjs` against the shipped companion-a.glb, the second from the raw FBX.
   */
  it('leaves the converter\'s already-upright output alone', () => {
    // The shipped GLB's skinned bind box: 0.531 wide, 1.750 tall, 0.380 deep.
    expect(needsZUpToYUp({ min: [-0.266, 0, -0.19], max: [0.265, 1.75, 0.19] })).toBe(false);
  });

  it('stands up the Z-up authored FBX rig', () => {
    // A T-pose lying in the XZ plane: long along Z, thin along Y.
    expect(needsZUpToYUp({ min: [-0.475, -0.001, -0.746], max: [1.292, 0.315, 1.014] })).toBe(true);
  });

  it('is not fooled by a T-pose whose arm span exceeds its height', () => {
    // Companion A is 1.759 across and 1.750 tall. A "largest extent wins" test answers X here and
    // gets the answer wrong; ignoring X entirely is what makes this safe.
    expect(needsZUpToYUp({ min: [-0.88, 0, -0.19], max: [0.879, 1.75, 0.19] })).toBe(false);
  });

  it('does not rotate a figure whose Y and Z are equal', () => {
    // A tie means there is nothing to gain by rotating, so the cheaper answer is to leave it.
    expect(needsZUpToYUp({ min: [0, 0, 0], max: [1, 1, 1] })).toBe(false);
  });
});

describe('normaliseUpright', () => {
  it('puts the feet on y=0, centres X/Z, and scales to the target height', () => {
    const b = { min: [-0.878, 0.5, -0.157] as const, max: [0.878, 2.25, 0.157] as const };
    const n = normaliseUpright(b, 1.75);
    expect(n.measuredHeight).toBeCloseTo(1.75, 6);
    expect(n.scale).toBeCloseTo(1, 6);
    expect(n.translate[1]).toBeCloseTo(-0.5, 6);   // lowest point to the ground
    expect(n.translate[0]).toBeCloseTo(0, 6);      // already centred
  });

  it('scales a half-height import up to the target', () => {
    const n = normaliseUpright({ min: [0, 0, 0], max: [1, 0.875, 1] }, 1.75);
    expect(n.scale).toBeCloseTo(2, 6);
  });

  it('centres a figure that is off-axis', () => {
    const n = normaliseUpright({ min: [2, 0, 4], max: [4, 1.75, 6] }, 1.75);
    expect(n.translate[0]).toBeCloseTo(-3, 6);
    expect(n.translate[2]).toBeCloseTo(-5, 6);
  });

  it('does not divide by zero on a degenerate box', () => {
    const n = normaliseUpright({ min: [0, 1, 0], max: [0, 1, 0] }, 1.75);
    expect(Number.isFinite(n.scale)).toBe(true);
    expect(n.scale).toBe(1);
  });
});

describe('assessRigIntegrity', () => {
  // The measured failure: posing the shipped rigs stretches an edge to ~1.9 m on a 1.75 m figure.
  it('rejects the measured torn rig and names the numbers', () => {
    const r = assessRigIntegrity({ maxEdge: 1.93, restEdge: 0.18, subjectHeight: 1.75 });
    expect(r.animatable).toBe(false);
    expect(r.reason).toContain('1.93');
    expect(r.reason).toContain('1.75');
    expect(r.reason).toMatch(/skin weights do not match/i);
  });

  it('accepts a healthy rig whose edges stay short while posed', () => {
    const r = assessRigIntegrity({ maxEdge: 0.19, restEdge: 0.18, subjectHeight: 1.75 });
    expect(r.animatable).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('puts the boundary exactly at the documented ratio', () => {
    const h = 1.75;
    const limit = h * TEAR_THRESHOLD_RATIO;
    expect(assessRigIntegrity({ maxEdge: limit - 1e-6, restEdge: 0.1, subjectHeight: h }).animatable).toBe(true);
    expect(assessRigIntegrity({ maxEdge: limit + 1e-6, restEdge: 0.1, subjectHeight: h }).animatable).toBe(false);
  });

  it('refuses a rig with no measurable height rather than dividing by zero', () => {
    const r = assessRigIntegrity({ maxEdge: 1, restEdge: 1, subjectHeight: 0 });
    expect(r.animatable).toBe(false);
    expect(r.reason).toMatch(/no measurable height/i);
  });

  it('survives a zero rest edge without printing NaN or Infinity', () => {
    const r = assessRigIntegrity({ maxEdge: 2, restEdge: 0, subjectHeight: 1.75 });
    expect(r.animatable).toBe(false);
    expect(r.reason).not.toMatch(/NaN|Infinity/);
  });

  /**
   * The two shipped rigs, measured off the real GLBs through the exact pipeline the picker uses
   * (vertex -> applyBoneTransform -> world). Their geometry is authored Z-up while their skeletons
   * stand Y-up, so playing any clip shatters the mesh. These numbers are recorded here so that if
   * someone re-exports the assets, the change is caught by a failing test instead of being
   * discovered on stage.
   *
   * Companion A: height 1.778 m, rest edge 0.1486 m, idle1 posed edge 1.7499 m (11.8x).
   * Companion B: height 2.541 m, rest edge 0.1777 m, idle1 posed edge 1.0412 m (5.9x).
   */
  it('rejects both shipped companions at their measured values', () => {
    const ash = assessRigIntegrity({ maxEdge: 1.7499, restEdge: 0.1486, subjectHeight: 1.778 });
    expect(ash.animatable).toBe(false);
    expect(ash.reason).toContain('1.75');   // the stretched edge, rounded for display
    expect(ash.reason).toContain('12×');    // 1.7499 / 0.1486 rounds to 12

    const wren = assessRigIntegrity({ maxEdge: 1.0412, restEdge: 0.1777, subjectHeight: 2.541 });
    expect(wren.animatable).toBe(false);
    expect(wren.reason).toContain('1.04');
  });

  /**
   * The repaired-asset path. Once the bind space is fixed a posed edge sits near the rest edge, and
   * the picker must then animate without any code change — this is the assertion that proves the
   * suppression is a measurement result and not a hard-coded "these files are broken".
   */
  it('would animate the same rigs once their bind space is repaired', () => {
    const repaired = assessRigIntegrity({ maxEdge: 0.21, restEdge: 0.1486, subjectHeight: 1.778 });
    expect(repaired.animatable).toBe(true);
    expect(repaired.reason).toBeNull();
  });
});

describe('checkImportSize', () => {
  it('passes a normal rig', () => {
    expect(checkImportSize('companion-a.glb', 723188)).toBeNull();
  });

  it('passes a file exactly at the limit', () => {
    expect(checkImportSize('edge.glb', MAX_IMPORT_BYTES)).toBeNull();
  });

  it('rejects an oversized file, quoting both sizes and what to do', () => {
    const issue = checkImportSize('huge.glb', 60 * 1024 * 1024);
    expect(issue).not.toBeNull();
    expect(issue!.severity).toBe('error');
    expect(issue!.message).toContain('60.0 MB');
    expect(issue!.message).toContain('24.0 MB');
    expect(issue!.message).toMatch(/Decimate|fewer animations/);
  });
});

describe('describeModelImport', () => {
  const healthy = {
    hasSkinnedMesh: true,
    animationCount: 3,
    heightMeters: 1.8,
    restEdge: 0.12,
    maxPosedEdge: 0.15,
  };

  it('accepts a healthy skinned, animated rig', () => {
    const r = describeModelImport('good.glb', healthy, 1.75);
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('rejects a static mesh and says to enable skinning', () => {
    const r = describeModelImport('prop.glb', { ...healthy, hasSkinnedMesh: false }, 1.75);
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.message).toMatch(/no skinned mesh/i);
    expect(r.issues[0]!.message).toMatch(/skinning enabled/i);
  });

  it('rejects a rig with no clips and says to export an idle', () => {
    const r = describeModelImport('still.glb', { ...healthy, animationCount: 0 }, 1.75);
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => /no animation clips/i.test(i.message))).toBe(true);
    expect(r.issues.some(i => /idle loop/i.test(i.message))).toBe(true);
  });

  it('rejects an import whose bind is torn, reusing the integrity wording', () => {
    const r = describeModelImport('torn.glb', { ...healthy, maxPosedEdge: 1.93, heightMeters: 1.75 }, 1.75);
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => /skin weights do not match/i.test(i.message))).toBe(true);
  });

  // Scaling is not a failure — but a 100× unit error should be visible, not silent.
  it('warns without failing when an import needs extreme rescaling', () => {
    const r = describeModelImport('cm.glb', { ...healthy, heightMeters: 175 }, 1.75);
    expect(r.ok).toBe(true);
    const w = r.issues.find(i => i.severity === 'warning');
    expect(w).toBeDefined();
    expect(w!.message).toContain('175.00 m');
    expect(w!.message).toMatch(/export units/i);
  });

  it('does not nag about a height close to the target', () => {
    const r = describeModelImport('fine.glb', { ...healthy, heightMeters: 1.9 }, 1.75);
    expect(r.issues).toHaveLength(0);
  });

  it('reports every independent problem at once rather than stopping at the first', () => {
    const r = describeModelImport(
      'bad.glb',
      { hasSkinnedMesh: false, animationCount: 0, heightMeters: 1.75, restEdge: 0.1, maxPosedEdge: 0.1 },
      1.75,
    );
    expect(r.issues.filter(i => i.severity === 'error')).toHaveLength(2);
  });
});

describe('rectsToClipPath', () => {
  /*
   * The mask is what allows the shared canvas to be painted in FRONT of the cards, which is the fix
   * for the companions rendering as pale ghosts through 62%- and 68%-opaque card material.
   */
  it('masks the canvas to two well rectangles', () => {
    const css = rectsToClipPath([
      { left: 24, top: 16, width: 200, height: 250 },
      { left: 248, top: 16, width: 200, height: 250 },
    ]);
    expect(css).toBe(
      "path('M24.00 16.00h200.00v250.00h-200.00Z" + 'M248.00 16.00h200.00v250.00h-200.00Z' + "')",
    );
  });

  /*
   * THE REGRESSION THIS FUNCTION EXISTS TO NOT REPEAT.
   *
   * The first version emitted one `polygon()` holding both rectangles' corners. `polygon()` is a
   * SINGLE ring, so that is one eight-sided figure whose connecting edges run diagonally between the
   * two wells — and with `evenodd` those crossings punched a wedge out of the render. It looked
   * exactly like a torn rig: two straight cuts meeting near the male companion's hips, left thigh
   * apparently detached. Disjoint regions need subpaths, which only `path()` has.
   */
  it('emits disjoint subpaths, never one polygon ring spanning both wells', () => {
    const css = rectsToClipPath([
      { left: 0, top: 0, width: 100, height: 100 },
      { left: 200, top: 0, width: 100, height: 100 },
    ]);
    expect(css).not.toContain('polygon');
    // Two rectangles must be two closed subpaths — one `M` and one `Z` each.
    expect(css.match(/M/g)).toHaveLength(2);
    expect(css.match(/Z/g)).toHaveLength(2);
  });

  it('returns none rather than an empty path when there is nothing to show', () => {
    // `path('')` hides the canvas completely — which on screen is indistinguishable from WebGL
    // having failed.
    expect(rectsToClipPath([])).toBe('none');
  });

  it('emits unitless user-space coordinates, since path() rejects px', () => {
    const css = rectsToClipPath([{ left: 24, top: 16, width: 200, height: 250 }]);
    expect(css).not.toContain('px');
  });

  it('drops degenerate rectangles instead of emitting zero-area subpaths', () => {
    const css = rectsToClipPath([
      { left: 0, top: 0, width: 0, height: 250 },
      { left: 10, top: 10, width: 100, height: 100 },
    ]);
    expect(css).toBe("path('M10.00 10.00h100.00v100.00h-100.00Z')");
  });

  it('is none when every rectangle is degenerate', () => {
    expect(rectsToClipPath([{ left: 5, top: 5, width: 100, height: 0 }])).toBe('none');
  });
});

describe('placeRigInWindow', () => {
  // The real measured geometry: a 1600x1000 window, a 404px panel body, three 244x378 cards, and
  // the wells inside them. `wellH` is derived, not typed in, because picker.css gives the well
  // `aspect-ratio: 3 / 4` — a hand-written height here silently stops describing the real card, and
  // that is exactly how the horizontal-clipping bug survived its first round of tests.
  const camera = { fovDegrees: 30, distance: 4.2, height: 0.85 };
  const viewport: PixelBox = { left: 0, top: 0, width: 780, height: 378 };
  const wellW = 220;
  const wellH = (wellW * 4) / 3;
  const well = (left: number): PixelBox => ({ left, top: 12, width: wellW, height: wellH });

  it('centres a rig whose window is centred in the viewport', () => {
    const centred = well(viewport.width / 2 - wellW / 2);
    const p = placeRigInWindow(centred, viewport, camera, 1.75, 0.82, 0.14);
    expect(p.x).toBeCloseTo(0, 6);
  });

  it('places left and right windows symmetrically about the centre', () => {
    const left = placeRigInWindow(well(20), viewport, camera, 1.75, 0.82, 0.14);
    const right = placeRigInWindow(
      well(viewport.width - wellW - 20),
      viewport,
      camera,
      1.75,
      0.82,
      0.14,
    );
    expect(left.x).toBeLessThan(0);
    expect(right.x).toBeGreaterThan(0);
    expect(left.x).toBeCloseTo(-right.x, 6);
    // Same-sized windows must read at the same size wherever they sit.
    expect(left.scale).toBeCloseTo(right.scale, 6);
  });

  /**
   * The load-bearing property: a figure `subjectHeight` tall, drawn at the returned scale, must
   * occupy exactly `figureFill` of its window's height. Verified by projecting back to pixels.
   */
  it('scales the figure to the requested fraction of its window', () => {
    const fill = 0.82;
    const p = placeRigInWindow(well(30), viewport, camera, 1.75, fill, 0.14);
    const visibleHeight = 2 * camera.distance * Math.tan((camera.fovDegrees * Math.PI) / 360);
    const pxPerM = viewport.height / visibleHeight;
    const figurePx = 1.75 * p.scale * pxPerM;
    expect(figurePx).toBeCloseTo(wellH * fill, 4);
  });

  it('stands the figure on the window ground line', () => {
    const groundFraction = 0.14;
    const w = well(30);
    const p = placeRigInWindow(w, viewport, camera, 1.75, 0.82, groundFraction);
    const visibleHeight = 2 * camera.distance * Math.tan((camera.fovDegrees * Math.PI) / 360);
    const pxPerM = viewport.height / visibleHeight;
    // Invert the mapping: world Y back to a screen Y.
    const screenY = viewport.top + viewport.height / 2 + (camera.height - p.y) * pxPerM;
    expect(screenY).toBeCloseTo(w.top + w.height * (1 - groundFraction), 4);
  });

  it('scales with the window, so a larger card shows a larger figure', () => {
    const small = placeRigInWindow(well(30), viewport, camera, 1.75, 0.82, 0.14);
    const big = placeRigInWindow(
      { left: 30, top: 12, width: wellW, height: wellH * 1.5 },
      viewport,
      camera,
      1.75,
      0.82,
      0.14,
    );
    expect(big.scale).toBeCloseTo(small.scale * 1.5, 6);
  });

  it('is independent of viewport size for a proportionally scaled layout', () => {
    // Doubling every pixel dimension must not change what the user sees.
    const a = placeRigInWindow(well(30), viewport, camera, 1.75, 0.82, 0.14);
    const b = placeRigInWindow(
      { left: 60, top: 24, width: wellW * 2, height: wellH * 2 },
      { left: 0, top: 0, width: viewport.width * 2, height: viewport.height * 2 },
      camera,
      1.75,
      0.82,
      0.14,
    );
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.y).toBeCloseTo(a.y, 6);
    expect(b.scale).toBeCloseTo(a.scale, 6);
  });

  it('returns a neutral placement instead of NaN before the DOM is laid out', () => {
    const p = placeRigInWindow(well(0), { left: 0, top: 0, width: 0, height: 0 }, camera, 1.75, 0.82, 0.14);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
    expect(Number.isFinite(p.scale)).toBe(true);
    expect(p.scale).toBeGreaterThan(0);
  });

  it('refuses to divide by a zero subject height', () => {
    const p = placeRigInWindow(well(0), viewport, camera, 0, 0.82, 0.14);
    expect(Number.isFinite(p.scale)).toBe(true);
  });

  // ── Contain fit ───────────────────────────────────────────────────────────
  //
  // Height alone is the wrong constraint for these rigs. Their animation is suppressed, so they are
  // displayed in their bind pose — a T-pose — and companion A measures 1.757 m across a 1.750 m
  // height. Sized on height it rendered 241px wide inside a 220px well and lost its hands to the
  // card's edge, 11px per side. Whichever axis binds first has to win.

  /** Companion A's measured bind pose: as wide as it is tall, arms straight out. */
  const T_POSE_WIDTH = 1.757;

  it('narrows a wide subject so it fits its window horizontally', () => {
    const heightOnly = placeRigInWindow(well(30), viewport, camera, 1.75, 0.82, 0.14);
    const contained = placeRigInWindow(well(30), viewport, camera, 1.75, 0.82, 0.14, T_POSE_WIDTH);
    // The well is 220x250, so a square subject is width-constrained and must come down.
    expect(contained.scale).toBeLessThan(heightOnly.scale);

    const visibleHeight = 2 * camera.distance * Math.tan((camera.fovDegrees * Math.PI) / 360);
    const pxPerM = viewport.height / visibleHeight;
    // The regression itself: at the height-only scale the figure overflowed; now it does not.
    expect(T_POSE_WIDTH * heightOnly.scale * pxPerM).toBeGreaterThan(wellW);
    expect(T_POSE_WIDTH * contained.scale * pxPerM).toBeLessThanOrEqual(wellW);
  });

  it('fills exactly the requested fraction of the window on whichever axis binds', () => {
    const fill = 0.82;
    const p = placeRigInWindow(well(30), viewport, camera, 1.75, fill, 0.14, T_POSE_WIDTH);
    const visibleHeight = 2 * camera.distance * Math.tan((camera.fovDegrees * Math.PI) / 360);
    const pxPerM = viewport.height / visibleHeight;
    // Width binds here, so width — not height — lands on the mark, and height comes in under it.
    expect(T_POSE_WIDTH * p.scale * pxPerM).toBeCloseTo(wellW * fill, 4);
    expect(1.75 * p.scale * pxPerM).toBeLessThan(wellH * fill);
  });

  it('leaves a narrow subject sized by its height', () => {
    // A walking figure is roughly 0.6 m across. In a 220x250 well that is nowhere near binding, so
    // the fit must not quietly shrink an animated companion.
    const heightOnly = placeRigInWindow(well(30), viewport, camera, 1.75, 0.82, 0.14);
    const contained = placeRigInWindow(well(30), viewport, camera, 1.75, 0.82, 0.14, 0.6);
    expect(contained.scale).toBeCloseTo(heightOnly.scale, 10);
  });

  it('treats an unknown width as height-only rather than collapsing the figure', () => {
    // Width arrives a frame or two after layout. Until it does, 0 must mean "no constraint" — a
    // naive divide would return Infinity or 0 and either blank the card or fill the screen.
    const p = placeRigInWindow(well(30), viewport, camera, 1.75, 0.82, 0.14, 0);
    const heightOnly = placeRigInWindow(well(30), viewport, camera, 1.75, 0.82, 0.14);
    expect(p.scale).toBeCloseTo(heightOnly.scale, 10);
    expect(Number.isFinite(p.scale)).toBe(true);
  });

  it('keeps the figure on the ground line whichever axis constrained it', () => {
    // Position and scale are solved independently, and the fix must not disturb the standing point.
    const groundFraction = 0.14;
    const w = well(30);
    const p = placeRigInWindow(w, viewport, camera, 1.75, 0.82, groundFraction, T_POSE_WIDTH);
    const visibleHeight = 2 * camera.distance * Math.tan((camera.fovDegrees * Math.PI) / 360);
    const pxPerM = viewport.height / visibleHeight;
    const screenY = viewport.top + viewport.height / 2 + (camera.height - p.y) * pxPerM;
    expect(screenY).toBeCloseTo(w.top + w.height * (1 - groundFraction), 4);
    expect(p.x).toBeCloseTo(
      placeRigInWindow(w, viewport, camera, 1.75, 0.82, groundFraction).x,
      10,
    );
  });

  it('switches which axis binds as the window changes shape', () => {
    // The same subject in a tall narrow well vs. a wide short one. Proves the min() is live rather
    // than one branch that happens to be right for today's card.
    const visibleHeight = 2 * camera.distance * Math.tan((camera.fovDegrees * Math.PI) / 360);
    const pxPerM = viewport.height / visibleHeight;
    const fill = 0.82;

    const narrow = placeRigInWindow(
      { left: 30, top: 12, width: 120, height: 300 },
      viewport, camera, 1.75, fill, 0.14, T_POSE_WIDTH,
    );
    expect(T_POSE_WIDTH * narrow.scale * pxPerM).toBeCloseTo(120 * fill, 4);

    const wide = placeRigInWindow(
      { left: 30, top: 12, width: 400, height: 200 },
      viewport, camera, 1.75, fill, 0.14, T_POSE_WIDTH,
    );
    expect(1.75 * wide.scale * pxPerM).toBeCloseTo(200 * fill, 4);
  });
});
