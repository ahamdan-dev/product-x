/**
 * Validation for a custom companion import, against the user's LOCKED sprite standard.
 *
 * NORTH-STAR §9, verbatim:
 *
 *   > 1 sheet = 1 animation + 1 camera angle + 1 character configuration + exactly 25 unique
 *   > seamless frames in a 5×5 transparent RGBA grid, 384×384/frame default, 512 hero, 768
 *   > exceptional close-up, identical character scale/pivot/ground line/camera/lighting across
 *   > every frame, 60 FPS app render / 24 FPS master sprite playback, loop flows 25 → 1 and frame
 *   > 25 must never duplicate frame 1 (that causes a visible pause).
 *
 * Two of those clauses are the interesting ones because they are checkable from pixels rather than
 * from a manifest:
 *
 *   - "frame 25 must never duplicate frame 1" — comparable directly, and the *reason* is stated in
 *     the standard (a visible pause), so this is a real defect and not a style nit.
 *   - "identical pivot / ground line" — the opaque bounding box of every frame must share a ground
 *     line and a horizontal centre. A sheet whose character drifts vertically will bob when looped.
 *
 * Errors are returned as human-readable sentences with the measured numbers in them. "Invalid
 * sprite sheet" tells a user nothing; "frame 25 is identical to frame 1 (mean difference 0.4/255)"
 * tells them exactly what to re-export.
 */

/** The locked grid. Not configurable — it is the standard. */
export const GRID = 5;
export const FRAME_COUNT = GRID * GRID;   // 25
/** Master playback rate, inside a 60 FPS app. */
export const MASTER_FPS = 24;
/** Allowed per-frame edge lengths: default, hero, exceptional close-up. */
export const ALLOWED_FRAME_SIZES = [384, 512, 768] as const;

export type Severity = 'error' | 'warning';

export interface Issue {
  severity: Severity;
  /** Which clause of the standard this is about. Lets the UI group by rule. */
  rule:
    | 'grid'
    | 'frame-size'
    | 'alpha'
    | 'frame-count'
    | 'loop-seam'
    | 'duplicate-frames'
    | 'ground-line'
    | 'pivot'
    | 'empty-frame'
    | 'container';
  message: string;
}

export interface SheetReport {
  ok: boolean;
  /** Per-frame edge length, if it could be determined. */
  frameSize: number | null;
  issues: Issue[];
}

/** Minimal image description, so this module is testable without a browser. */
export interface ImageLike {
  width: number;
  height: number;
  /** RGBA, row-major, length = width * height * 4. */
  data: Uint8Array | Uint8ClampedArray;
}

function err(rule: Issue['rule'], message: string): Issue {
  return { severity: 'error', rule, message };
}
function warn(rule: Issue['rule'], message: string): Issue {
  return { severity: 'warning', rule, message };
}

/** Opaque-pixel bounds of one cell, plus its alpha coverage. */
interface FrameStats {
  index: number;
  /** null when the frame has no pixel above the alpha floor at all. */
  bounds: { left: number; right: number; top: number; bottom: number } | null;
  opaqueCount: number;
}

/** Pixels below this alpha are treated as background. 8/255 tolerates export dithering. */
const ALPHA_FLOOR = 8;

function frameStats(img: ImageLike, cell: number, index: number): FrameStats {
  const cx = (index % GRID) * cell;
  const cy = Math.floor(index / GRID) * cell;
  let left = cell, right = -1, top = cell, bottom = -1, opaque = 0;

  for (let y = 0; y < cell; y++) {
    const rowBase = ((cy + y) * img.width + cx) * 4;
    for (let x = 0; x < cell; x++) {
      const a = img.data[rowBase + x * 4 + 3] ?? 0;
      if (a <= ALPHA_FLOOR) continue;
      opaque++;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  return {
    index,
    bounds: right < 0 ? null : { left, right, top, bottom },
    opaqueCount: opaque,
  };
}

/**
 * How much two cells differ, as the FRACTION OF THE CHARACTER'S PIXELS that changed.
 *
 * The obvious implementation — mean absolute RGBA difference over the whole cell — is wrong here,
 * and wrong in a way that only shows up on real assets. It is normalized by cell area, so the same
 * character animating the same amount scores ~36× lower on a 384px frame than on a 64px one. A
 * legitimately-animating 384px sheet then trips the duplicate check while a coarse test fixture
 * passes it. Normalizing against the character's own footprint instead makes the measure
 * scale-invariant, which is the only way one threshold can serve 384, 512 and 768px sheets.
 */
function diffFraction(img: ImageLike, cell: number, a: number, b: number): number {
  const ax = (a % GRID) * cell, ay = Math.floor(a / GRID) * cell;
  const bx = (b % GRID) * cell, by = Math.floor(b / GRID) * cell;

  let changed = 0;
  let footprint = 0;

  for (let y = 0; y < cell; y++) {
    const ra = ((ay + y) * img.width + ax) * 4;
    const rb = ((by + y) * img.width + bx) * 4;
    for (let x = 0; x < cell; x++) {
      const pa = ra + x * 4, pb = rb + x * 4;
      const aa = img.data[pa + 3] ?? 0, ab = img.data[pb + 3] ?? 0;
      const inEither = aa > ALPHA_FLOOR || ab > ALPHA_FLOOR;
      if (inEither) footprint++;
      // 12/255 ignores export dithering and JPEG-ish ringing without ignoring real motion.
      const d = Math.max(
        Math.abs((img.data[pa] ?? 0) - (img.data[pb] ?? 0)),
        Math.abs((img.data[pa + 1] ?? 0) - (img.data[pb + 1] ?? 0)),
        Math.abs((img.data[pa + 2] ?? 0) - (img.data[pb + 2] ?? 0)),
        Math.abs(aa - ab),
      );
      if (d > 12) changed++;
    }
  }

  // Two empty cells are identical; that is a frame-count problem, reported elsewhere.
  if (footprint === 0) return 0;
  return changed / footprint;
}

/**
 * Below this fraction of changed pixels, two frames are the same picture for playback purposes.
 * 2% allows for a re-encode; a real animation step moves far more than that.
 */
export const DUPLICATE_THRESHOLD = 0.02;

/**
 * Validate one sprite sheet.
 *
 * `deepCompare` runs the O(n²) all-pairs duplicate scan. It is off by default because on a 768px
 * hero sheet that is 25×24/2 = 300 cell comparisons over 590k pixels each — fine for an import
 * that the user is waiting on, wasteful for a bulk pass.
 */
export function validateSheet(img: ImageLike, opts: { deepCompare?: boolean } = {}): SheetReport {
  const issues: Issue[] = [];

  // ── Grid and frame size ──────────────────────────────────────────────────
  if (img.width !== img.height) {
    issues.push(err('grid',
      `The sheet must be square to hold a 5×5 grid; this one is ${img.width}×${img.height}.`));
  }
  if (img.width % GRID !== 0 || img.height % GRID !== 0) {
    issues.push(err('grid',
      `The sheet is ${img.width}×${img.height}, which does not divide into a 5×5 grid. ` +
      `Expected a multiple of 5 on both axes — for example 1920×1920 for 384px frames.`));
    return { ok: false, frameSize: null, issues };
  }

  const cell = Math.floor(img.width / GRID);
  const cellH = Math.floor(img.height / GRID);
  if (cell !== cellH) {
    issues.push(err('frame-size',
      `Frames must be square. This sheet gives ${cell}×${cellH} per frame.`));
  }

  if (!ALLOWED_FRAME_SIZES.includes(cell as (typeof ALLOWED_FRAME_SIZES)[number])) {
    issues.push(warn('frame-size',
      `Frame size is ${cell}px. The standard is 384px (default), 512px (hero) or 768px ` +
      `(exceptional close-up). A ${cell}px frame will still play, but it will not match the ` +
      `other companions on screen.`));
  }

  if (img.data.length < img.width * img.height * 4) {
    issues.push(err('alpha',
      `The image data is ${img.data.length} bytes, short of the ` +
      `${img.width * img.height * 4} needed for RGBA. The sheet must be RGBA with a real alpha ` +
      `channel, not RGB or an indexed palette.`));
    return { ok: false, frameSize: cell, issues };
  }

  // ── Per-frame stats ──────────────────────────────────────────────────────
  const stats: FrameStats[] = [];
  for (let i = 0; i < FRAME_COUNT; i++) stats.push(frameStats(img, cell, i));

  const empties = stats.filter(s => s.bounds === null);
  if (empties.length > 0) {
    issues.push(err('frame-count',
      `The standard requires exactly 25 filled frames. ` +
      `${empties.length === 1 ? 'Frame' : 'Frames'} ` +
      `${empties.map(s => s.index + 1).join(', ')} ` +
      `${empties.length === 1 ? 'is' : 'are'} empty — every cell of the 5×5 grid must hold a frame.`));
  }

  // A fully opaque sheet means the background was baked in; it will render as a rectangle.
  const totalPixels = cell * cell;
  const fullyOpaque = stats.filter(s => s.opaqueCount >= totalPixels * 0.995);
  if (fullyOpaque.length >= FRAME_COUNT / 2) {
    issues.push(err('alpha',
      `${fullyOpaque.length} of 25 frames have no transparent pixels, so the background is baked ` +
      `into the sheet. Export with a transparent background or the companion will render as a ` +
      `solid rectangle over the desktop.`));
  }

  const filled = stats.filter((s): s is FrameStats & { bounds: NonNullable<FrameStats['bounds']> } =>
    s.bounds !== null);

  // ── Ground line and pivot ────────────────────────────────────────────────
  // "identical character scale/pivot/ground line ... across every frame". Tolerance is 1.5% of the
  // frame — tight enough to catch a re-render at a different camera height, loose enough to allow
  // a foot lifting during a walk cycle.
  if (filled.length >= 2) {
    const tol = Math.max(2, Math.round(cell * 0.015));

    const bottoms = filled.map(s => s.bounds.bottom);
    const bMin = Math.min(...bottoms), bMax = Math.max(...bottoms);
    if (bMax - bMin > tol) {
      // Name the frame furthest from the MEDIAN, not the first frame holding an extreme. When one
      // frame was re-rendered at a different camera height, every other frame ties for the other
      // extreme, so "first match" reports frame 1 and sends the user to re-export the wrong cell.
      const sorted = [...bottoms].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
      let worst = filled[0]!;
      for (const s of filled) {
        if (Math.abs(s.bounds.bottom - median) > Math.abs(worst.bounds.bottom - median)) worst = s;
      }
      issues.push(err('ground-line',
        `The ground line moves by ${bMax - bMin}px across the sheet (tolerance ${tol}px at ` +
        `${cell}px frames). Frame ${worst.index + 1} is the outlier. Every frame must be ` +
        `rendered from an identical camera with the character's feet on the same line, or the ` +
        `companion will bob as it loops.`));
    }

    const centres = filled.map(s => (s.bounds.left + s.bounds.right) / 2);
    const cMin = Math.min(...centres), cMax = Math.max(...centres);
    // Horizontal drift gets 3× the tolerance: arms swinging legitimately widen the box.
    if (cMax - cMin > tol * 3) {
      issues.push(warn('pivot',
        `The character's horizontal centre drifts by ${Math.round(cMax - cMin)}px across the ` +
        `sheet. If this is not intentional motion, re-export with a fixed pivot so the companion ` +
        `does not slide sideways as it loops.`));
    }
  }

  // ── The loop seam: frame 25 must never duplicate frame 1 ─────────────────
  if (filled.length === FRAME_COUNT) {
    const seam = diffFraction(img, cell, FRAME_COUNT - 1, 0);
    if (seam < DUPLICATE_THRESHOLD) {
      issues.push(err('loop-seam',
        `Frame 25 is identical to frame 1 (only ${(seam * 100).toFixed(1)}% of the character's ` +
        `pixels differ). The standard forbids this because the loop flows 25 → 1, so a duplicated ` +
        `frame plays the same picture twice and reads as a visible pause. Drop frame 25 and ` +
        `re-space the cycle over 25 unique frames.`));
    }

    if (opts.deepCompare) {
      const dupes: string[] = [];
      for (let a = 0; a < FRAME_COUNT && dupes.length < 6; a++) {
        for (let b = a + 1; b < FRAME_COUNT && dupes.length < 6; b++) {
          if (a === 0 && b === FRAME_COUNT - 1) continue;   // already reported as the seam
          if (diffFraction(img, cell, a, b) < DUPLICATE_THRESHOLD) dupes.push(`${a + 1}=${b + 1}`);
        }
      }
      if (dupes.length > 0) {
        issues.push(err('duplicate-frames',
          `The standard requires 25 *unique* frames, but these pairs are the same picture: ` +
          `${dupes.join(', ')}. Re-space the animation so every cell advances the motion.`));
      }
    }
  }

  return { ok: !issues.some(i => i.severity === 'error'), frameSize: cell, issues };
}

/** Frame duration at the master rate, ms. One frame at 24 FPS ≈ 41.67ms. */
export function frameDurationMs(): number {
  return 1000 / MASTER_FPS;
}

/**
 * Which cell should be showing at time t. Loops 25 → 1, never holding a frame.
 *
 * The epsilon is not defensive noise. 1000/24 is not representable in binary, so a caller that
 * computes a frame boundary as `k * frameDurationMs()` — the natural thing to do, and what the
 * cycle length 25*d is — can land a hair *below* the boundary: 25*d evaluates to 1041.666…65,
 * whose exact quotient is 24.999999999999996. Flooring that yields 24, so the loop holds frame 25
 * for one extra tick, which is exactly the visible pause the standard exists to prevent. Nudging up
 * by 1e-9 fixes every exact boundary (verified over 100k cycles) while changing no integer-ms
 * result.
 */
export function frameAt(elapsedMs: number): number {
  const i = Math.floor(((elapsedMs + 1e-9) * MASTER_FPS) / 1000) % FRAME_COUNT;
  return i < 0 ? i + FRAME_COUNT : i;
}

/** CSS background-position for a cell on a sheet, in percent. */
export function cellPosition(index: number): { xPct: number; yPct: number } {
  const col = index % GRID;
  const row = Math.floor(index / GRID);
  // With background-size: 500% 500%, each step is 25% of the *background* box, not 20%.
  return { xPct: (col * 100) / (GRID - 1), yPct: (row * 100) / (GRID - 1) };
}

/** File extensions a custom 3D companion may arrive as. */
export const MODEL_EXTENSIONS = ['glb', 'gltf', 'fbx'] as const;

export type ImportKind = 'model' | 'sprite-zip' | 'unknown';

export function classifyImport(filename: string): ImportKind {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if ((MODEL_EXTENSIONS as readonly string[]).includes(ext)) return 'model';
  if (ext === 'zip') return 'sprite-zip';
  return 'unknown';
}

/**
 * Validate the *shape* of a sprite ZIP before any pixels are decoded — one sheet per animation,
 * named so the app can map it onto a clip.
 */
export function validateSpriteZipManifest(entries: readonly string[]): SheetReport {
  const issues: Issue[] = [];
  const pngs = entries.filter(e => e.toLowerCase().endsWith('.png'));

  if (pngs.length === 0) {
    issues.push(err('container',
      `The ZIP contains no PNG files. A sprite import must contain one transparent RGBA PNG per ` +
      `animation, each a 5×5 grid of 25 frames.`));
  }

  const nonPng = entries.filter(e =>
    !e.toLowerCase().endsWith('.png') &&
    !e.toLowerCase().endsWith('.json') &&
    !e.endsWith('/'));
  if (nonPng.length > 0) {
    issues.push(warn('container',
      `Ignoring ${nonPng.length} file${nonPng.length === 1 ? '' : 's'} that ${nonPng.length === 1 ? 'is' : 'are'} ` +
      `neither a PNG sheet nor a JSON manifest: ${nonPng.slice(0, 4).join(', ')}` +
      `${nonPng.length > 4 ? '…' : ''}.`));
  }

  // One sheet = one animation, so an idle sheet is the minimum viable import.
  const hasIdle = pngs.some(p => /idle/i.test(p));
  if (pngs.length > 0 && !hasIdle) {
    issues.push(warn('container',
      `No sheet is named for an idle animation. The companion spends most of its life at rest, so ` +
      `include an "idle" sheet — otherwise it will hold whichever animation loaded first.`));
  }

  return { ok: !issues.some(i => i.severity === 'error'), frameSize: null, issues };
}
