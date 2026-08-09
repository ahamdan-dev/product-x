/**
 * Which edges stretch, and by how much IN MILLIMETRES? The absolute-units second opinion.
 *
 *   node tools/edge_forensics.mjs app/public/companions/companion-a.glb [clip]
 *
 * Runs under plain `node` from the repo root -- no Electron, no dev server, no GPU. That is the point of
 * keeping it: every other surviving harness needs `cd app && npx electron ...` and a live Vite server on
 * port 5301, so when the shipping pipeline is the thing under suspicion this is the one measurement that
 * shares none of its machinery. It parses the GLB off disk and skins on the CPU.
 *
 * ══ WHAT IT MEASURES ═════════════════════════════════════════════════════════════════════════
 *
 * For every UNIQUE edge in the mesh (de-duplicated by sorted vertex-index pair, so an edge shared by two
 * triangles is measured once, not twice): its bind length, its worst length across 13 samples of the clip,
 * and the growth between them -- reported in millimetres and as a fraction of body height. Then the top
 * twelve by absolute growth, and separately the top twelve by RATIO, side by side.
 *
 * ══ WHY IT EXISTS: RATIOS LIE ON LOW-POLY MESHES ═════════════════════════════════════════════
 *
 * This harness was written to settle a specific confusion, and the confusion is a permanent property of
 * these assets rather than a one-off, which is why the tool outlives the investigation.
 *
 * A bare edge-length ratio cannot distinguish two completely different things:
 *
 *   * a REAL tear -- vertices swung about a distant pivot, moving centimetres to metres;
 *   * a NEAR-DEGENERATE edge at bind -- two nearly-coincident vertices at a UV or material seam, which
 *     low-poly game meshes have by the hundred. Bind length is a few microns, so any pose separates them
 *     into a huge RATIO while the absolute displacement stays invisible.
 *
 * These meshes have 4 mm armpit edges at bind. One reaching 17 mm is a 4.27x ratio and 0.7% of body
 * height -- completely invisible. Judging on ratios flagged eleven clips as torn whose captures showed
 * intact human figures. Judging on absolute growth against body height put the same clips at 2%-7% and
 * the known-broken Blender export at 107%, three orders of magnitude apart. Printing BOTH columns is what
 * makes that distinction visible instead of something the reader has to already know.
 *
 * Weight sums were checked when this was written and are exactly 1.0 for every vertex in all files, so
 * dropped skin influences (FBXLoader warns it deletes the 5th and beyond) are ruled out as a cause here.
 *
 * ══ NOTE ON THESE ASSETS ═════════════════════════════════════════════════════════════════════
 *
 * Both shipping GLBs are NON-INDEXED: FBXLoader hands back non-indexed geometry and GLTFExporter writes
 * what it is given. The `idx ? ... : ...` branches below are therefore not defensive padding -- the
 * else-branch is the one that actually runs, and every triangle contributes three fresh vertex indices.
 * De-duplication by index pair consequently finds far fewer shared edges than it would on an indexed
 * mesh; that is expected, not a bug.
 *
 * ══ THE VERDICT LINE ═════════════════════════════════════════════════════════════════════════
 *
 * Under 2% of body height it reports nothing visible as a tear. For reference, the sound rigs measure
 * 0.68% worst growth on idle1 over 49 frames (`tools/hip_tear.cjs`), so 2% is deliberately loose enough
 * that ordinary limb deformation does not trip it while the known defect exceeds it 50x.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/*
 * three is a dependency of `app/`, not of the repo root, and this file now lives in `tools/` -- which is
 * outside `app/`, so Node's resolver walks up from here and never finds it. A bare `import 'three'` fails
 * with ERR_MODULE_NOT_FOUND: Cannot find package 'three'. This was verified, not assumed: it is exactly
 * what broke when the file moved out of `app/`.
 *
 * So resolve through an explicit file URL into app/node_modules. Dynamic import is required because the
 * path has to be computed at runtime from import.meta.url; a static import cannot take a variable.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const THREE_DIR = path.join(HERE, '..', 'app', 'node_modules', 'three');
const threeUrl = (rel) => pathToFileURL(path.join(THREE_DIR, rel)).href;

const THREE = await import(threeUrl('build/three.module.js'));
const { GLTFLoader } = await import(threeUrl('examples/jsm/loaders/GLTFLoader.js'));

/*
 * GLTFLoader reaches for browser globals while decoding the embedded texture. Only geometry and skinning
 * are measured here, so the image path is stubbed rather than served by a headless canvas.
 */
globalThis.self = globalThis;
if (!globalThis.URL.createObjectURL) globalThis.URL.createObjectURL = () => 'blob:stub';
if (!globalThis.createImageBitmap) globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });

const file = process.argv[2];
const clipName = process.argv[3] || null;
if (!file) {
  console.error('usage: node tools/edge_forensics.mjs <glb> [clip]');
  console.error('   eg: node tools/edge_forensics.mjs app/public/companions/companion-a.glb idle1');
  process.exit(2);
}

const buf = readFileSync(file);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

new GLTFLoader().parse(ab, '', (gltf) => {
  let mesh = null;
  gltf.scene.traverse(o => { if (o.isSkinnedMesh && !mesh) mesh = o; });
  if (!mesh) { console.error('no skinned mesh'); process.exit(1); }

  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const idx = geo.index;
  const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);

  /** Every unique edge in the mesh, as a sorted vertex-index pair. */
  const edgeSet = new Map();
  for (let t = 0; t < triCount; t++) {
    const a = idx ? idx.getX(t * 3) : t * 3;
    const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const key = p < q ? `${p}_${q}` : `${q}_${p}`;
      if (!edgeSet.has(key)) edgeSet.set(key, [Math.min(p, q), Math.max(p, q)]);
    }
  }
  const edges = [...edgeSet.values()];

  const v = new THREE.Vector3();
  /** Skinned world position of one vertex. The matrixWorld multiply is required: applyBoneTransform
   *  returns the result pre-multiplied by bindMatrixInverse, which matrixWorld cancels exactly. */
  const skinned = (i, into) => {
    into.fromBufferAttribute(pos, i);
    mesh.applyBoneTransform(i, into);
    return into.applyMatrix4(mesh.matrixWorld);
  };

  const lengths = () => {
    const p = new THREE.Vector3(), q = new THREE.Vector3();
    return edges.map(([a, b]) => skinned(a, p).distanceTo(skinned(b, q)));
  };

  gltf.scene.updateMatrixWorld(true);
  const bind = lengths();

  const clip = (clipName && gltf.animations.find(c => c.name === clipName)) || gltf.animations[0];
  const mixer = new THREE.AnimationMixer(mesh);
  mixer.clipAction(clip).reset().play();

  // Worst frame per edge across the clip, not a single sample.
  const SAMPLES = 12;
  const worst = bind.slice();
  for (let s = 0; s <= SAMPLES; s++) {
    mixer.setTime(clip.duration * (s / SAMPLES));
    gltf.scene.updateMatrixWorld(true);
    const now = lengths();
    for (let i = 0; i < now.length; i++) if (now[i] > worst[i]) worst[i] = now[i];
  }

  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) box.expandByPoint(skinned(i, p));
  const height = box.getSize(new THREE.Vector3()).y;

  const rows = edges.map((e, i) => ({
    e, bind: bind[i], posed: worst[i],
    ratio: bind[i] > 1e-9 ? worst[i] / bind[i] : Infinity,
    grow: worst[i] - bind[i],
  }));

  console.log(`=== ${file}  clip "${clip.name}" ===`);
  console.log(`unique edges ${edges.length}   triangles ${triCount}   ` +
    `index ${idx ? 'present' : 'ABSENT (non-indexed, as expected for these assets)'}`);
  console.log(`figure height ${height.toFixed(4)} m   ` +
    `coverage: EVERY unique edge, ${SAMPLES + 1} frames of the clip`);

  const degenerate = rows.filter(r => r.bind < 1e-4);
  console.log(`\nnear-degenerate at bind (< 0.1 mm): ${degenerate.length} edges` +
    `  -- these produce huge RATIOS from tiny absolute motion`);

  console.log('\nby ABSOLUTE growth (the quantity a viewer can actually see):');
  const byGrow = rows.slice().sort((a, b) => b.grow - a.grow).slice(0, 12);
  console.log('  edge            bind mm    posed mm    growth mm    ratio');
  for (const r of byGrow) {
    console.log(`  ${`${r.e[0]}-${r.e[1]}`.padEnd(15)} ${(r.bind * 1000).toFixed(2).padStart(8)} ` +
      `${(r.posed * 1000).toFixed(2).padStart(11)} ${(r.grow * 1000).toFixed(2).padStart(12)} ` +
      `${(Number.isFinite(r.ratio) ? r.ratio.toFixed(1) + 'x' : 'inf').padStart(8)}`);
  }

  console.log('\nby RATIO (what an earlier gate judged on, and why it produced false positives):');
  const byRatio = rows.slice().filter(r => Number.isFinite(r.ratio)).sort((a, b) => b.ratio - a.ratio).slice(0, 12);
  console.log('  edge            bind mm    posed mm    growth mm    ratio');
  for (const r of byRatio) {
    console.log(`  ${`${r.e[0]}-${r.e[1]}`.padEnd(15)} ${(r.bind * 1000).toFixed(3).padStart(8)} ` +
      `${(r.posed * 1000).toFixed(2).padStart(11)} ${(r.grow * 1000).toFixed(2).padStart(12)} ` +
      `${r.ratio.toFixed(1)}x`.padStart(8));
  }

  // The honest summary: how much visible displacement exists, as a fraction of body height.
  const maxGrow = Math.max(...rows.map(r => r.grow));
  console.log(`\nlargest absolute edge growth: ${(maxGrow * 1000).toFixed(2)} mm ` +
    `= ${(maxGrow / height * 100).toFixed(2)}% of body height`);
  console.log(maxGrow / height < 0.02
    ? 'CONCLUSION: no edge grows more than 2% of body height. Nothing here is visible as a tear; the large\n' +
      '            ratios come from near-degenerate seam edges, not from displaced geometry.'
    : 'CONCLUSION: edges grow by a visible fraction of the body. This is a real deformation defect.');
}, (e) => { console.error('parse failed', e); process.exit(1); });
