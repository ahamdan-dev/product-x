/**
 * Crop and magnify a region of a PNG, so a defect seen at card size can be looked at properly.
 *
 *   cd app && npx electron ../tools/crop.cjs <in.png> <out.png> <x> <y> <w> <h> [scale]
 *
 * WHY THIS EXISTS
 *
 * The male companion appeared to have a tear at the hips in `_shots/picker-front.png`, where the
 * figure is about 350px tall. Every measurement since says the geometry is sound: `hip_tear.cjs`
 * walked every triangle edge over 49 frames of idle1 and found 0.68% worst growth, identical to the
 * source FBX, with the worst edges at the clavicles rather than the pelvis; the flat-white silhouette
 * and the textured close-up are both intact. So whatever is on screen is not deformation, and the
 * next honest step is to look at the actual pixels that started this instead of re-rendering a
 * different scene and comparing impressions.
 *
 * Electron's nativeImage does the crop and resize, which keeps this dependency-free — `sharp` is not
 * in the tree and adding a native module to look at a picture would be the wrong trade.
 */

const fs = require('fs');
const path = require('path');
const { app, nativeImage } = require('electron');

const [inPath, outPath, x, y, w, h, scale] = process.argv.slice(2);
if (!inPath || !outPath || !w || !h) {
  console.log('usage: npx electron ../tools/crop.cjs <in.png> <out.png> <x> <y> <w> <h> [scale]');
  process.exit(2);
}

const ROOT = path.join(__dirname, '..');
const abs = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));

app.whenReady().then(() => {
  const img = nativeImage.createFromPath(abs(inPath));
  const full = img.getSize();
  console.log(`source ${abs(inPath)}  ${full.width}x${full.height}`);

  const rect = {
    x: Math.max(0, Math.round(Number(x))),
    y: Math.max(0, Math.round(Number(y))),
    width: Math.min(Number(w), full.width - Number(x)),
    height: Math.min(Number(h), full.height - Number(y)),
  };
  const k = Number(scale || 2);
  const out = img.crop(rect).resize({
    width: Math.round(rect.width * k),
    height: Math.round(rect.height * k),
    quality: 'best',
  });

  fs.writeFileSync(abs(outPath), out.toPNG());
  const got = out.getSize();
  console.log(`cropped ${rect.x},${rect.y} ${rect.width}x${rect.height} at ${k}x -> ` +
    `${abs(outPath)}  ${got.width}x${got.height}`);
  app.exit(0);
});
