/**
 * Companion source resolution, rig normalisation, and import validation.
 *
 * Pure module — no React, no three.js, no DOM access at import time — so every decision the picker
 * makes about an asset is unit-testable in Node. The picker does the WebGL; this file does the
 * arithmetic and the judgement calls.
 *
 * Three problems are solved here, and each one is a real defect this code had to survive:
 *
 *  1. URL RESOLUTION. Production loads the renderer over `file://` via Electron's `loadFile`, and
 *     Vite is built with `base: './'`. An absolute `/companions/companion-a.glb` therefore resolves
 *     to the filesystem root and 404s in the packaged app while working perfectly in `vite dev`.
 *     Every asset URL must be resolved against `document.baseURI`.
 *
 *  2. AUTHORING BASIS. The shipped rigs' mesh geometry is authored Z-up (a T-pose lying in the XZ
 *     plane) while their skeletons stand Y-up. Standing the mesh up is a fixed change of basis, and
 *     the arithmetic for it lives in `rotateZUpToYUp` / `normaliseUpright`.
 *
 *  3. RIG INTEGRITY. A skinned mesh whose skin weights do not correspond to its skeleton does not
 *     fail loudly — it renders as a spray of stretched triangles. The only reliable tell is that
 *     posing it stretches triangle edges far beyond anything in the source mesh, so
 *     `assessRigIntegrity` turns a measured edge length into a decision about whether the animation
 *     is safe to show a room full of people.
 */

import type { Issue, SheetReport } from './spriteStandard';

// ── Asset URLs ──────────────────────────────────────────────────────────────

/**
 * Resolve a manifest-relative asset path against the document base.
 *
 * `new URL(rel, base)` is the whole implementation, but the guard matters: a leading slash makes
 * the path absolute and silently discards the base, which is exactly the bug that only appears in
 * the packaged build. Leading slashes are therefore stripped, not honoured.
 */
export function resolveAssetUrl(relativePath: string, baseUrl: string): string {
  const clean = relativePath.replace(/^\/+/, '');
  return new URL(clean, baseUrl).href;
}

// ── Manifest ────────────────────────────────────────────────────────────────

/** The licence block. CC BY 4.0 obliges us to name the author wherever the work is shown. */
export interface CompanionLicense {
  pack: string;
  author: string;
  license: string;
  requiresAttribution: boolean;
  source: string;
  notice: string;
}

export interface CompanionEntry {
  id: string;
  label: string;
  rig: string;
  /** Manifest-relative, e.g. `companions/companion-a.glb`. Resolve with `resolveAssetUrl`. */
  file: string;
  bytes: number;
  clips: string[];
}

export interface CompanionManifest {
  license: CompanionLicense;
  targetHeight: number;
  companions: CompanionEntry[];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Parse `public/companions/manifest.json` defensively.
 *
 * Returns `null` rather than throwing, and never invents a licence: if the licence block is
 * missing, `license` comes back with empty strings and `requiresAttribution` true, so the UI fails
 * towards showing an attribution slot rather than silently dropping a legal obligation.
 */
export function parseCompanionManifest(json: unknown): CompanionManifest | null {
  const root = asRecord(json);
  if (!root) return null;

  const rawCompanions = Array.isArray(root['companions']) ? root['companions'] : [];
  const companions: CompanionEntry[] = [];
  for (const raw of rawCompanions) {
    const c = asRecord(raw);
    if (!c) continue;
    const file = str(c['file']);
    const id = str(c['id']);
    if (!file || !id) continue;
    const rawClips = Array.isArray(c['clips']) ? c['clips'] : [];
    const clips: string[] = [];
    for (const rc of rawClips) {
      const clip = asRecord(rc);
      const name = clip ? str(clip['name']) : typeof rc === 'string' ? rc : '';
      if (name) clips.push(name);
    }
    companions.push({
      id,
      label: str(c['label'], id),
      rig: str(c['rig']),
      file,
      bytes: num(c['bytes'], 0),
      clips,
    });
  }
  if (companions.length === 0) return null;

  const lic = asRecord(root['license']);
  return {
    license: {
      pack: lic ? str(lic['pack']) : '',
      author: lic ? str(lic['author']) : '',
      license: lic ? str(lic['license']) : '',
      requiresAttribution: lic ? lic['requires_attribution'] !== false : true,
      source: lic ? str(lic['source']) : '',
      notice: lic ? str(lic['notice']) : '',
    },
    targetHeight: num(root['targetHeight'], 1.75),
    companions,
  };
}

/**
 * The single line of credit shown in the picker. Built from the manifest so the text cannot drift
 * from the licence that actually ships beside the files.
 */
export function attributionText(license: CompanionLicense): string {
  if (license.notice) return license.notice;
  const who = license.author || 'the original author';
  const what = license.license || 'its original licence';
  return `Character animations by ${who}, licensed ${what}.`;
}

// ── Clip selection ──────────────────────────────────────────────────────────

/** Clips that read as "at rest", best first. */
const IDLE_PREFERENCE = ['idle1', 'idle', 'idle2', 'talk', 'walk_slow'] as const;
/** Clips that read as "delighted", best first. A picker should reward a hover, not start a rave. */
const LIVELY_PREFERENCE = ['celebrate', 'flourish', 'hype', 'dance', 'jog', 'walk'] as const;

export interface ClipChoice {
  idle: string | null;
  lively: string | null;
}

/**
 * Choose the resting and the reward clip from whatever the file actually contains.
 *
 * Preference order, not assumption: companion B ships no `talk` and no `flourish`, so hard-coding
 * either would leave one card frozen. Falling back to the first available clip is deliberate — a
 * companion that moves is better than a companion that does not.
 */
export function chooseClips(available: readonly string[]): ClipChoice {
  const has = (n: string) => available.includes(n);
  const idle = IDLE_PREFERENCE.find(has) ?? available[0] ?? null;
  const lively = LIVELY_PREFERENCE.find(has) ?? null;
  return {
    idle: idle ?? null,
    // Never return the idle clip as the reward: a hover that changes nothing reads as a dead UI.
    lively: lively && lively !== idle ? lively : null,
  };
}

// ── Change of basis: Z-up authoring → Y-up world ────────────────────────────

export interface Bounds3 {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

/**
 * Rotate a bounding box +90° about X, which is the transform that stands a Z-up figure upright.
 *
 * The point mapping is (x, y, z) → (x, −z, y). Applied to a box that means the Y extent comes from
 * the source's Z extent (negated, so min/max swap) and the Z extent comes from the source's Y.
 */
export function rotateZUpToYUp(b: Bounds3): Bounds3 {
  return {
    min: [b.min[0], -b.max[2], b.min[1]],
    max: [b.max[0], -b.min[2], b.max[1]],
  };
}

/**
 * Does this figure already stand up, or is it authored lying down?
 *
 * `rotateZUpToYUp` must not be applied unconditionally, and that is a defect this code had rather
 * than a hypothetical. The source FBX rigs are authored Z-up, so a fixed +90° about X was correct for
 * them — but the converter now normalises its output to Y-up at 1.75 m, and the fixed rotation then
 * laid the finished companion on its back. Measured: the shipped GLB's skinned bind box is
 * 0.531 × 1.750 × 0.380, and after the rotation it read 0.531 × 0.380 × 1.750, so "height" became the
 * figure's depth and `normaliseUpright` scaled it 4.6× trying to make 0.38 m reach 1.75 m.
 *
 * The test is Y-extent against Z-extent, and X is deliberately not consulted. A humanoid's depth
 * (front to back) is always its smallest dimension, so whichever of Y/Z is larger is the one the
 * figure is long along:
 *
 *   * standing Y-up  → height on Y, depth on Z  → y > z
 *   * lying Z-up     → height on Z, depth on Y  → z > y
 *
 * Ignoring X is what makes this safe for a T-pose, where arm span (1.76 m) rivals or exceeds height
 * (1.75 m) and "largest extent wins" would answer X. Pass the SKINNED bind box: raw geometry bounds
 * describe the mesh before the skeleton has posed it, which for these files is a different shape
 * entirely (1.759 × 1.752 × 0.314 — genuinely ambiguous).
 */
export function needsZUpToYUp(b: Bounds3): boolean {
  return b.max[2] - b.min[2] > b.max[1] - b.min[1];
}

export interface UprightNormalisation {
  /** Uniform scale that takes the figure to `targetHeight`. */
  scale: number;
  /**
   * Translation applied BEFORE the scale, in source units: centres the figure on X/Z and puts its
   * lowest point at y = 0, so every companion shares one ground line and one pivot.
   */
  translate: readonly [number, number, number];
  /** Height before scaling — surfaced to the user so an import that gets resized says so. */
  measuredHeight: number;
}

/**
 * Derive the transform that makes an already-uprighted figure share the world's ground line,
 * centre, and height.
 *
 * Bounds-derived rather than authored: a custom import has no manifest to trust, and the stock
 * rigs' own manifest reports a height their geometry does not have. Measuring is the only thing
 * that works for both.
 */
export function normaliseUpright(b: Bounds3, targetHeight: number): UprightNormalisation {
  const height = b.max[1] - b.min[1];
  const centreX = (b.min[0] + b.max[0]) / 2;
  const centreZ = (b.min[2] + b.max[2]) / 2;
  // A degenerate box would otherwise produce Infinity and blank the card.
  const scale = height > 1e-6 ? targetHeight / height : 1;
  return {
    scale,
    translate: [-centreX, -b.min[1], -centreZ],
    measuredHeight: height,
  };
}

// ── Rig integrity ───────────────────────────────────────────────────────────

/**
 * Fraction of subject height that a single triangle edge may reach before the mesh is considered
 * torn. Source meshes here have a longest edge near 0.10 of height; a broken bind produces edges
 * beyond 1.0 of height. Anything past this threshold is not a stylisation, it is a defect.
 */
export const TEAR_THRESHOLD_RATIO = 0.18;

export interface RigIntegrity {
  /** True when the skeleton may be animated on screen. */
  animatable: boolean;
  /** Present when `animatable` is false: a sentence naming the measurement, for the console. */
  reason: string | null;
}

/**
 * Decide whether a posed skeleton is safe to show.
 *
 * `maxEdge` is the longest triangle edge measured while the clip plays; `restEdge` is the longest
 * edge in the unposed source mesh. Comparing the two separates a torn bind from a merely chunky
 * low-poly model, and reporting both numbers means the failure is diagnosable from the log rather
 * than guessed at.
 */
export function assessRigIntegrity(args: {
  maxEdge: number;
  restEdge: number;
  subjectHeight: number;
}): RigIntegrity {
  const { maxEdge, restEdge, subjectHeight } = args;
  if (!(subjectHeight > 1e-6)) {
    return { animatable: false, reason: 'The rig has no measurable height.' };
  }
  const limit = subjectHeight * TEAR_THRESHOLD_RATIO;
  if (maxEdge > limit) {
    const ratio = restEdge > 1e-6 ? maxEdge / restEdge : Infinity;
    return {
      animatable: false,
      reason:
        `Animating this rig stretches a triangle edge to ${maxEdge.toFixed(2)} m on a ` +
        `${subjectHeight.toFixed(2)} m figure (limit ${limit.toFixed(2)} m, ` +
        `${Number.isFinite(ratio) ? `${ratio.toFixed(0)}× its longest edge at rest` : 'no rest edge'}). ` +
        `The skin weights do not match the skeleton, so the animation is not shown.`,
    };
  }
  return { animatable: true, reason: null };
}

// ── Custom imports ──────────────────────────────────────────────────────────

/** A companion file above this size stalls the picker on a laptop. 24 MB is generous for a rig. */
export const MAX_IMPORT_BYTES = 24 * 1024 * 1024;

function err(rule: Issue['rule'], message: string): Issue {
  return { severity: 'error', rule, message };
}
function warn(rule: Issue['rule'], message: string): Issue {
  return { severity: 'warning', rule, message };
}

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * Size gate, shared by both import kinds. Separate from the format checks so the user is not told
 * their 60 MB file has the wrong grid.
 */
export function checkImportSize(fileName: string, bytes: number): Issue | null {
  if (bytes <= MAX_IMPORT_BYTES) return null;
  return err(
    'container',
    `"${fileName}" is ${mb(bytes)}, over the ${mb(MAX_IMPORT_BYTES)} limit. Decimate the mesh or ` +
      `export fewer animations — a companion rig is normally under 2 MB.`,
  );
}

export interface ModelFacts {
  /** Does the file contain a skinned mesh at all? A prop cannot be a companion. */
  hasSkinnedMesh: boolean;
  /** How many animation clips the file carries. */
  animationCount: number;
  /** Measured height in metres, after standing the figure upright. */
  heightMeters: number;
  /** Longest triangle edge at rest, and while posed — the tearing check. */
  restEdge: number;
  maxPosedEdge: number;
}

/**
 * Turn measurements of an imported 3D file into the same `SheetReport` shape the sprite validator
 * returns, so the picker renders one list of issues regardless of which kind of file arrived.
 *
 * Every message carries the measured number. "Invalid file" is the one thing this must never say:
 * the user is the only person who can fix their export, and they can only do that if they are told
 * what was actually wrong with it.
 */
export function describeModelImport(fileName: string, facts: ModelFacts, targetHeight: number): SheetReport {
  const issues: Issue[] = [];

  if (!facts.hasSkinnedMesh) {
    issues.push(
      err(
        'container',
        `"${fileName}" contains no skinned mesh. A companion needs a mesh bound to a skeleton — ` +
          `export with skinning enabled, not as a static mesh.`,
      ),
    );
  }

  if (facts.animationCount === 0) {
    issues.push(
      err(
        'container',
        `"${fileName}" contains no animation clips. The companion would stand perfectly still — ` +
          `export at least an idle loop.`,
      ),
    );
  }

  if (facts.hasSkinnedMesh && facts.animationCount > 0) {
    const integrity = assessRigIntegrity({
      maxEdge: facts.maxPosedEdge,
      restEdge: facts.restEdge,
      subjectHeight: facts.heightMeters,
    });
    if (!integrity.animatable && integrity.reason) {
      issues.push(err('container', integrity.reason));
    }
  }

  // Height is information, not a failure: we scale to fit, and the user should know we did.
  if (facts.heightMeters > 1e-6) {
    const ratio = facts.heightMeters / targetHeight;
    if (ratio < 0.5 || ratio > 2) {
      issues.push(
        warn(
          'container',
          `"${fileName}" measures ${facts.heightMeters.toFixed(2)} m tall and will be scaled to ` +
            `${targetHeight.toFixed(2)} m to match the other companions — a ${ratio.toFixed(1)}× ` +
            `change. If that looks wrong, check the export units.`,
        ),
      );
    }
  }

  return {
    ok: !issues.some(i => i.severity === 'error'),
    frameSize: null,
    issues,
  };
}

// ── Placing a rig inside its DOM window ─────────────────────────────────────

/** A pixel rectangle, as `getBoundingClientRect` reports it. */
export interface PixelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * A `clip-path` that shows ONLY the given rectangles, in the coordinate space of the element it is
 * applied to.
 *
 * This is what allows one shared canvas to be painted in FRONT of the cards. Behind them, the render
 * was strained through two translucent layers of card material — measured at roughly 208 of 255 for a
 * mid-grey limb, which is why both companions arrived as ghosts — and the card material cannot simply
 * be removed, because the frame is the design. Masking the canvas to the well rectangles gets the
 * figures at full strength while every pixel outside a well stays card.
 *
 * `path()`, NOT `polygon()`, and that is the whole point of this function.
 *
 * `polygon()` takes ONE ring of vertices — a single closed loop. Concatenating two rectangles' corners
 * into one `polygon()` does not produce two rectangles; it produces one eight-sided figure that walks
 * from the first well's bottom-left across to the second well's top-left and back, and `evenodd` then
 * carves out the wedge where those connecting edges cross. On screen that rendered as two clean
 * diagonal cuts through the male companion, meeting at a point near his hips, with the left thigh
 * apparently detached. I read that as a tear in the rig and spent a full forensic pass on the asset —
 * every triangle edge over 49 frames, GLB against source FBX, flat-white and textured pelvis
 * close-ups — which all came back clean at 0.68% growth, identical to the source. The geometry was
 * never wrong. The mask was.
 *
 * An SVG path has subpaths, so it can express disjoint regions honestly: one `M …h …v …h …Z` per
 * rectangle, filled `nonzero` (the default), which is what "show these rectangles" actually means.
 *
 * The one cost is units: `path()` takes bare user-space numbers, no `px`, and they are resolved
 * against the element's own coordinate space rather than its border box. That is exactly what the
 * caller measures — well boxes offset by the stage box — so the values go in unchanged, but a future
 * caller passing viewport coordinates would be silently wrong.
 *
 * Returns `'none'` for an empty list: an empty `path('')` hides the element entirely, which on screen
 * is indistinguishable from WebGL having failed.
 */
export function rectsToClipPath(rects: readonly PixelBox[]): string {
  const n = (v: number) => v.toFixed(2);
  const parts = rects
    .filter(r => r.width > 0 && r.height > 0)
    // Each rectangle is its own subpath, closed with Z. Relative h/v keep it compact and make the
    // width and height readable as themselves in the output.
    .map(r => `M${n(r.left)} ${n(r.top)}h${n(r.width)}v${n(r.height)}h-${n(r.width)}Z`);
  return parts.length === 0 ? 'none' : `path('${parts.join('')}')`;
}

/** Where a rig stands in world space, and how large it reads there. */
export interface RigPlacement {
  x: number;
  y: number;
  scale: number;
}

/** The fixed camera the picker frames every companion with. */
export interface CameraFraming {
  fovDegrees: number;
  distance: number;
  height: number;
}

/**
 * Convert a preview window's pixel box into the world transform that fills it.
 *
 * The picker draws every companion in ONE canvas stretched across the whole card row, so each rig
 * has to be positioned to land inside its own card's window. Hard-coding metres cannot do that: the
 * cards are a fluid `1fr` grid, so a spacing that lines up at one panel width is wrong at every
 * other one, and the canvas covers each card entirely — frame, label and all — so a figure sized to
 * the canvas is wrong vertically too.
 *
 * The conversion is the perspective camera's own geometry. At `distance`, a vertical `fovDegrees`
 * lens spans `2 · d · tan(fov/2)` metres, which fixes a metres-per-pixel ratio for the whole
 * viewport; from there a pixel offset from the viewport centre is a world offset. Screen Y grows
 * downward and world Y upward, hence the negation, and the result is biased by the camera's own
 * height because the camera is what the world is measured against.
 *
 * `figureFill` is the fraction of the window's height the figure should occupy, and `groundFraction`
 * is where the window's ground line sits, measured up from its bottom edge.
 *
 * The fit is CONTAIN, not height-only, which matters because of what these previews actually show.
 * A walking figure is far taller than it is wide, so height is the obvious constraint — but a rig
 * whose animation had to be suppressed is displayed in its bind pose, and a bind pose is a T-pose
 * with the arms straight out. Companion A then measures 1.757 m wide against 1.750 m tall, and
 * sizing on height alone pushed its hands 11 px outside a 220 px well: fingers sliced off at the
 * card's edge. `subjectWidth` therefore participates, and whichever axis binds first wins.
 */
export function placeRigInWindow(
  window: PixelBox,
  viewport: PixelBox,
  camera: CameraFraming,
  subjectHeight: number,
  figureFill: number,
  groundFraction: number,
  /** Widest extent of the subject, in the same units as `subjectHeight`. Omit for height-only. */
  subjectWidth = 0,
): RigPlacement {
  // A zero-sized viewport means the DOM has not been laid out yet. Returning a neutral placement
  // keeps this total rather than emitting NaN into a scene graph, where it would silently blank the
  // canvas instead of failing somewhere debuggable.
  if (viewport.width <= 0 || viewport.height <= 0 || subjectHeight <= 0) {
    return { x: 0, y: camera.height, scale: 1 };
  }

  const visibleHeight = 2 * camera.distance * Math.tan((camera.fovDegrees * Math.PI) / 360);
  const mPerPx = visibleHeight / viewport.height;

  const viewportCentreX = viewport.left + viewport.width / 2;
  const viewportCentreY = viewport.top + viewport.height / 2;
  const windowCentreX = window.left + window.width / 2;
  const groundPx = window.top + window.height * (1 - groundFraction);

  const scaleByHeight = (window.height * figureFill * mPerPx) / subjectHeight;
  const scaleByWidth =
    subjectWidth > 0 ? (window.width * figureFill * mPerPx) / subjectWidth : Infinity;

  return {
    x: (windowCentreX - viewportCentreX) * mPerPx,
    y: camera.height - (groundPx - viewportCentreY) * mPerPx,
    scale: Math.min(scaleByHeight, scaleByWidth),
  };
}
