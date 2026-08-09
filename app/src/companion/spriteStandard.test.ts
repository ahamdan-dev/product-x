import { describe, it, expect } from 'vitest';
import {
  GRID, FRAME_COUNT, MASTER_FPS, ALLOWED_FRAME_SIZES, validateSheet, validateSpriteZipManifest,
  frameDurationMs, frameAt, cellPosition, classifyImport, type ImageLike,
} from './spriteStandard';

interface Box { x: number; y: number; w: number; h: number; tint?: number }

/**
 * Build a synthetic sheet. `frame(i)` returns the boxes making up the character in cell i, so a
 * test can move the ground line, blank a frame, or duplicate one, and nothing else changes.
 *
 * Boxes rather than one rectangle, because the validator measures the fraction of the character's
 * own pixels that move between frames. A fixture animated by a 1px width change is not a fixture
 * for "a real cycle" — it is below any sane duplicate threshold, and building the test that way
 * would only prove the threshold was tuned to the fixture.
 */
function makeSheet(cell: number, frame: (i: number) => Box | Box[] | null): ImageLike {
  const size = cell * GRID;
  const data = new Uint8Array(size * size * 4);   // fully transparent
  for (let i = 0; i < FRAME_COUNT; i++) {
    const spec = frame(i);
    if (!spec) continue;
    const boxes = Array.isArray(spec) ? spec : [spec];
    const ox = (i % GRID) * cell;
    const oy = Math.floor(i / GRID) * cell;
    for (const box of boxes) {
      for (let y = box.y; y < box.y + box.h; y++) {
        for (let x = box.x; x < box.x + box.w; x++) {
          if (x < 0 || y < 0 || x >= cell || y >= cell) continue;
          const p = ((oy + y) * size + (ox + x)) * 4;
          data[p] = box.tint ?? 120;
          data[p + 1] = 90;
          data[p + 2] = 70;
          data[p + 3] = 255;
        }
      }
    }
  }
  return { width: size, height: size, data };
}

/**
 * A conforming sheet: fixed ground line, fixed centre, every frame visibly different.
 *
 * The per-frame difference is a *width* change, not just a tint change, because the validator
 * measures the fraction of the character's pixels that moved. A pure recolour of the whole body is
 * not what real animation looks like, and a fixture that relied on it would be testing the wrong
 * thing. Widths cycle through 25 distinct values so no two frames coincide.
 *
 * The step is a *fraction of the cell*, not a flat pixel count. `validateSheet` reports a ratio
 * (changed pixels / character footprint), so a flat 1px step is 1-of-12 columns at 64px but only
 * 1-of-69 at 384px — the same fixture would then read as real motion when small and as duplicate
 * frames when large. That is a property of the fixture, not of the measure: real animation moves
 * proportionally to the character. Scaling the step keeps the ratio constant (~10% at every
 * allowed size), which is what makes the scale-invariance test below meaningful.
 */
function goodSheet(cell = 64): ImageLike {
  const groundY = cell - Math.max(4, Math.round(cell * 0.06));
  const h = Math.round(cell * 0.62);
  const baseW = Math.max(12, Math.round(cell * 0.18));
  const step = Math.max(1, Math.round(cell * 0.02));
  return makeSheet(cell, i => {
    const w = baseW + i * step;                // 25 distinct footprints
    return {
      x: Math.round(cell / 2 - w / 2),         // centre held: pivot is fixed
      y: groundY - h,                          // ground line held
      w,
      h,
      tint: 40 + i * 8,
    };
  });
}

describe('the locked standard, as constants', () => {
  it('is a 5×5 grid of exactly 25 frames', () => {
    expect(GRID).toBe(5);
    expect(FRAME_COUNT).toBe(25);
  });

  it('plays the master at 24 FPS', () => {
    expect(MASTER_FPS).toBe(24);
    expect(frameDurationMs()).toBeCloseTo(41.666, 2);
  });

  it('allows 384 default, 512 hero, 768 exceptional', () => {
    expect([...ALLOWED_FRAME_SIZES]).toEqual([384, 512, 768]);
  });
});

describe('loop playback flows 25 → 1', () => {
  it('starts at frame 1 and advances one cell per master frame', () => {
    expect(frameAt(0)).toBe(0);
    expect(frameAt(frameDurationMs() * 1.5)).toBe(1);
    expect(frameAt(frameDurationMs() * 24.5)).toBe(24);
  });

  it('wraps from 25 straight back to 1 without holding a frame', () => {
    const d = frameDurationMs();
    expect(frameAt(d * 25)).toBe(0);
    expect(frameAt(d * 25.5)).toBe(0);
    expect(frameAt(d * 26.5)).toBe(1);
  });

  it('maps cells onto a 500% background without gaps', () => {
    expect(cellPosition(0)).toEqual({ xPct: 0, yPct: 0 });
    expect(cellPosition(4)).toEqual({ xPct: 100, yPct: 0 });
    expect(cellPosition(24)).toEqual({ xPct: 100, yPct: 100 });
    expect(cellPosition(6)).toEqual({ xPct: 25, yPct: 25 });
  });
});

describe('a conforming sheet passes', () => {
  it('accepts a well-formed sheet with no errors', () => {
    const r = validateSheet(goodSheet(384));
    expect(r.issues.filter(i => i.severity === 'error')).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.frameSize).toBe(384);
  });

  it('accepts the hero and exceptional sizes silently', () => {
    for (const size of [512, 768]) {
      const r = validateSheet(goodSheet(size));
      expect(r.ok).toBe(true);
      expect(r.issues.filter(i => i.rule === 'frame-size')).toEqual([]);
    }
  });
});

describe('the loop-seam clause: frame 25 must never duplicate frame 1', () => {
  it('rejects a sheet whose last frame repeats the first', () => {
    const cell = 64;
    const w0 = 12;
    // Frame 25 (index 24) is a byte-for-byte copy of frame 1 — the classic
    // "25 frames plus a closing duplicate" export that causes the pause.
    const sheet = makeSheet(cell, i => {
      const w = i === 24 ? w0 : w0 + i;
      return { x: Math.round(cell / 2 - w / 2), y: 16, w, h: 40, tint: i === 24 ? 40 : 40 + i * 8 };
    });
    const r = validateSheet(sheet);
    const seam = r.issues.find(i => i.rule === 'loop-seam');
    expect(seam?.severity).toBe('error');
    expect(seam?.message).toMatch(/Frame 25 is identical to frame 1/);
    // The message must carry the measurement and the reason, not just a verdict.
    expect(seam?.message).toMatch(/% of the character's pixels differ/);
    expect(seam?.message).toMatch(/visible pause/);
    expect(r.ok).toBe(false);
  });

  it('says nothing about the seam when the frames genuinely differ', () => {
    expect(validateSheet(goodSheet()).issues.find(i => i.rule === 'loop-seam')).toBeUndefined();
  });

  /** Frame 10 (index 9) is an exact copy of frame 4 (index 3). */
  const withInteriorDupe = (cell = 64): ImageLike => makeSheet(cell, i => {
    const src = i === 9 ? 3 : i;
    const w = 12 + src;
    return { x: Math.round(cell / 2 - w / 2), y: 16, w, h: 40, tint: 40 + src * 8 };
  });

  it('finds interior duplicate pairs under deep compare, and names them', () => {
    const r = validateSheet(withInteriorDupe(), { deepCompare: true });
    const dup = r.issues.find(i => i.rule === 'duplicate-frames');
    expect(dup?.message).toMatch(/4=10/);
    expect(r.ok).toBe(false);
  });

  it('does not run the O(n²) scan unless asked', () => {
    expect(validateSheet(withInteriorDupe()).issues.find(i => i.rule === 'duplicate-frames'))
      .toBeUndefined();
  });

  it('does not flag a legitimately-animating sheet at any allowed frame size', () => {
    // The duplicate measure must be scale-invariant: the same motion at 384 and 768 must both pass.
    for (const size of [384, 512, 768]) {
      const r = validateSheet(goodSheet(size), { deepCompare: true });
      expect(r.issues.filter(i => i.severity === 'error'), `at ${size}px`).toEqual([]);
    }
  });
});

describe('identical ground line and pivot across every frame', () => {
  it('rejects a drifting ground line and names the measurement', () => {
    const cell = 384;
    // Frame 13 was re-rendered from a camera 9px lower — the whole body shifts down.
    const sheet = makeSheet(cell, i => {
      const w = 70 + i;
      return {
        x: Math.round(cell / 2 - w / 2),
        y: 100 + (i === 12 ? 9 : 0),
        w, h: 238, tint: 40 + i * 8,
      };
    });
    const r = validateSheet(sheet);
    const g = r.issues.find(i => i.rule === 'ground-line');
    expect(g?.severity).toBe('error');
    expect(g?.message).toMatch(/ground line moves by 9px/);
    expect(g?.message).toMatch(/[Ff]rame 13/);
    expect(r.ok).toBe(false);
  });

  it('tolerates a foot lifting within 1.5% of the frame', () => {
    const cell = 384;
    const sheet = makeSheet(cell, i => {
      const w = 70 + i;
      return {
        x: Math.round(cell / 2 - w / 2),
        y: 100, w,
        h: 238 - (i % 2 === 0 ? 0 : 3),      // 3px < 1.5% of 384
        tint: 40 + i * 8,
      };
    });
    expect(validateSheet(sheet).issues.find(i => i.rule === 'ground-line')).toBeUndefined();
  });

  it('warns, not errors, on horizontal drift — arms legitimately swing', () => {
    const cell = 384;
    const sheet = makeSheet(cell, i => ({
      x: 150 + (i < 12 ? 0 : 30), y: 100, w: 70 + i, h: 238, tint: 40 + i * 8,
    }));
    const r = validateSheet(sheet);
    const p = r.issues.find(i => i.rule === 'pivot');
    expect(p?.severity).toBe('warning');
    expect(r.ok).toBe(true);
  });
});

describe('grid, size and alpha', () => {
  it('rejects a sheet that does not divide into 5×5, and suggests a real size', () => {
    // 1922 is not a multiple of 5, so the grid cannot be cut at all.
    const r = validateSheet({ width: 1922, height: 1922, data: new Uint8Array(1922 * 1922 * 4) });
    const g = r.issues.find(i => i.rule === 'grid');
    expect(g?.severity).toBe('error');
    expect(g?.message).toMatch(/does not divide into a 5×5 grid/);
    // The error has to tell the user what size to export, not just that theirs is wrong.
    expect(g?.message).toMatch(/1920×1920/);
    expect(r.ok).toBe(false);
    // Nothing downstream should be guessed once the grid is unknown.
    expect(r.frameSize).toBeNull();
  });

  it('rejects a non-square sheet', () => {
    const r = validateSheet({ width: 1920, height: 960, data: new Uint8Array(1920 * 960 * 4) });
    expect(r.issues.some(i => i.rule === 'grid' && i.severity === 'error')).toBe(true);
  });

  it('warns on an off-standard frame size but still plays it', () => {
    const r = validateSheet(goodSheet(200));
    const f = r.issues.find(i => i.rule === 'frame-size');
    expect(f?.severity).toBe('warning');
    expect(f?.message).toMatch(/200px/);
    expect(r.ok).toBe(true);
  });

  it('rejects a baked-in background, explaining what the user will see', () => {
    const cell = 64;
    const sheet = makeSheet(cell, () => ({ x: 0, y: 0, w: cell, h: cell, tint: 120 }));
    const r = validateSheet(sheet);
    const a = r.issues.find(i => i.rule === 'alpha');
    expect(a?.severity).toBe('error');
    expect(a?.message).toMatch(/solid rectangle/);
    expect(r.ok).toBe(false);
  });

  it('rejects data too short to be RGBA', () => {
    const r = validateSheet({ width: 320, height: 320, data: new Uint8Array(320 * 320 * 3) });
    expect(r.issues.some(i => i.rule === 'alpha' && /RGBA/.test(i.message))).toBe(true);
    expect(r.ok).toBe(false);
  });

  it('names the empty cells when the sheet is short of 25 frames', () => {
    const sheet = makeSheet(64, i =>
      i >= 20 ? null : { x: 26, y: 16, w: 12, h: 40, tint: 40 + i * 8 });
    const r = validateSheet(sheet);
    const c = r.issues.find(i => i.rule === 'frame-count');
    expect(c?.message).toMatch(/21, 22, 23, 24, 25/);
    expect(r.ok).toBe(false);
  });
});

describe('import classification and ZIP shape', () => {
  it('accepts the three model formats and ZIP, and is honest about anything else', () => {
    expect(classifyImport('buddy.glb')).toBe('model');
    expect(classifyImport('buddy.GLTF')).toBe('model');
    expect(classifyImport('buddy.fbx')).toBe('model');
    expect(classifyImport('sheets.zip')).toBe('sprite-zip');
    expect(classifyImport('buddy.blend')).toBe('unknown');
  });

  it('rejects a ZIP with no sheets in it', () => {
    const r = validateSpriteZipManifest(['readme.txt', 'buddy.blend']);
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.rule === 'container' && /no PNG/.test(i.message))).toBe(true);
  });

  it('accepts a ZIP of sheets and lists what it will ignore', () => {
    const r = validateSpriteZipManifest([
      'idle.png', 'walk.png', 'celebrate.png', 'manifest.json', 'source.blend',
    ]);
    expect(r.ok).toBe(true);
    expect(r.issues.some(i => /source\.blend/.test(i.message))).toBe(true);
  });

  it('warns when no idle sheet is present, since that is where the companion lives', () => {
    const r = validateSpriteZipManifest(['walk.png', 'run.png']);
    expect(r.ok).toBe(true);
    expect(r.issues.some(i => /idle/.test(i.message))).toBe(true);
  });
});
