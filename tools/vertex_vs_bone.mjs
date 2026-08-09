/**
 * Is the GEOMETRY in the same space as the BIND SKELETON? The cause-level check.
 *
 *   node tools/vertex_vs_bone.mjs app/public/companions/companion-a.glb
 *
 * Runs under plain `node` from the repo root -- no Electron, no dev server, no GPU.
 *
 * ══ WHY THIS IS THE FIRST THING TO RUN ON A NEW OR RECONVERTED ASSET ═════════════════════════
 *
 * A physical invariant decides it, with no reference to axis conventions or exporter flags: a vertex is
 * skinned by the bone it is attached to, so it must lie NEAR that bone. A vertex on the left hand belongs
 * to `bip_L_Hand` and sits within a few centimetres of it. That is true of every correct skinned mesh
 * regardless of up-axis, unit scale, or rig -- which makes it the rare check that cannot be argued with.
 *
 * three.js skins as `v_world = boneMatrixWorld * boneInverse * v_local` (the mesh node's own transform is
 * applied and then cancelled by bindMatrixInverse, which is glTF's rule that a skinned mesh node's
 * transform is ignored). At bind pose `boneMatrixWorld * boneInverse` is the IDENTITY for every bone, so
 * the character renders at its RAW vertex coordinates. Therefore the raw coordinates must already live in
 * the same space as the bind skeleton.
 *
 * If they do not, bind pose still looks perfectly self-consistent -- every bone contributes the same
 * identity, so the mesh holds its shape -- and that is exactly why a bind-pose check, a GLB header parse,
 * and a height assertion can all pass on a fatally broken file. The moment a keyframe moves a bone, each
 * vertex is dragged around a bone that is nowhere near it, and the mesh explodes.
 *
 * This is the measurement that convicted the retired Blender pipeline: its exported bind skeleton stood
 * 1.38 m up the Y axis while its exported vertices lay 1.76 m along Z, and vertices sat a MEAN OF 1.64 m
 * from the bones driving them. Every other check that pipeline had passed. So this file exists to make
 * that class of defect a one-command question rather than a multi-day investigation.
 *
 * ══ WHAT GOOD LOOKS LIKE, AND WHY THE UNITS ARE RELATIVE ═════════════════════════════════════
 *
 * Distances are reported as a PERCENTAGE OF THE MESH'S OWN LONGEST SPAN, never in metres. That is not
 * decoration -- an absolute threshold is wrong on these files and a first version of this check that used
 * "mean < 0.1 m" reported the sound, shipping companion-a as a DEFECT.
 *
 * The reason is a permanent property of this pack: the raw vertex data is in the authored ~100x space
 * (companion-a's geometry spans 182 units) and the `companion_root` ancestor carries scale 0.0096 to bring
 * the figure to 1.75 m. So raw vertex-to-bone distances are ~14 UNITS, which is a correct 8% of the body,
 * and any metre-based threshold either fires on a good file or has to be hand-tuned per asset.
 *
 * Measured on the current shipping GLBs: "as authored" scores ~8% of span, and both rotated variants score
 * ~34% -- so as-authored wins by a factor of four. That is the signature of a file ALREADY CORRECTLY
 * ORIENTED. A genuinely mis-oriented file inverts that gap.
 *
 * Each rotation variant is scored with its OWN best-fit translation (the one that aligns vertex and bone
 * centroids). Without that, rotating geometry whose centre sits 91 units off the origin injects an enormous
 * translation and every rotated variant loses for a reason that has nothing to do with its orientation --
 * a correct rotation about the wrong origin still scores badly, which would make the comparison worthless.
 *
 * That last point is a permanent fact about these assets and the reason the up-axis variants are still
 * printed: `tools/fbx_to_glb.cjs` normalises its output to Y-up, so any consumer applying an
 * unconditional +90 degrees about X to "stand up a Z-up mesh" will lay these figures on their side. Up-axis
 * correction downstream must be CONDITIONAL (see `needsZUpToYUp` in the picker path). The three variants
 * below are how you re-confirm which orientation a given file is actually in.
 *
 * ══ WHAT IT DOES NOT COVER ═══════════════════════════════════════════════════════════════════
 *
 * Only the dominant (highest-weight) bone per vertex is considered, so this diagnoses SPACE, not weight
 * quality. A mesh with correct spaces and scrambled weights passes here. Use `tools/gpu_check.cjs` and
 * `tools/edge_forensics.mjs` for the deformation symptom.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/*
 * three is a dependency of `app/`, not of the repo root, and this file lives in `tools/` -- outside `app/`,
 * so Node's resolver walks up from here and never finds it. A bare `import 'three'` fails with
 * ERR_MODULE_NOT_FOUND. Verified, not assumed: it is what broke when the file moved out of `app/`.
 * Dynamic import is required because the path is computed at runtime from import.meta.url.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const THREE_DIR = path.join(HERE, '..', 'app', 'node_modules', 'three');
const threeUrl = (rel) => pathToFileURL(path.join(THREE_DIR, rel)).href;

const THREE = await import(threeUrl('build/three.module.js'));
const { GLTFLoader } = await import(threeUrl('examples/jsm/loaders/GLTFLoader.js'));

/* Only geometry is measured, so texture decode is stubbed rather than served by a headless canvas. */
globalThis.self = globalThis;
if (!globalThis.URL.createObjectURL) globalThis.URL.createObjectURL = () => 'blob:stub';
if (!globalThis.createImageBitmap) globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/vertex_vs_bone.mjs <glb>');
  console.error('   eg: node tools/vertex_vs_bone.mjs app/public/companions/companion-a.glb');
  process.exit(2);
}

const buf = readFileSync(file);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const r = (n) => +n.toFixed(4);

new GLTFLoader().parse(ab, '', (gltf) => {
  gltf.scene.updateMatrixWorld(true);

  gltf.scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const sk = o.skeleton;
    const geo = o.geometry;
    const pos = geo.attributes.position;
    const si = geo.attributes.skinIndex;
    const sw = geo.attributes.skinWeight;

    // Bind-pose world position of every bone, recovered from the file's own inverse bind matrices.
    const bindPos = sk.boneInverses.map((bi) =>
      new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(bi).invert()));

    // Candidate corrections to test against the raw geometry.
    const rotX = (deg) => new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(deg));
    const variants = [
      ['as authored          ', new THREE.Matrix4()],
      ['rotX -90 (Zup->Yup)  ', rotX(-90)],
      ['rotX +90             ', rotX(90)],
    ];

    /*
     * Dominant bone per vertex, resolved once: the highest-weight influence is the bone the vertex
     * mostly belongs to, and therefore the bone it must lie near.
     */
    const dom = new Int32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      let best = 0, bestW = -1;
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w > bestW) { bestW = w; best = si.getComponent(i, k); }
      }
      dom[i] = best;
    }

    /*
     * Scale reference: the mesh's own longest span. Everything below is a fraction of this, so the check
     * works on the pack's ~100x authored units and on metre-scale geometry without a per-asset threshold.
     */
    geo.computeBoundingBox();
    const gs = new THREE.Vector3(); geo.boundingBox.getSize(gs);
    const span = Math.max(gs.x, gs.y, gs.z) || 1;

    console.log(`\n=== ${file}  mesh=${o.name}  verts=${pos.count}  bones=${sk.bones.length} ===`);
    console.log(`index ${geo.index ? 'present' : 'ABSENT (non-indexed, as expected for these assets)'}`);
    console.log(`mesh longest span ${r(span)} units (raw authored units, NOT metres)`);
    console.log('Distance from each vertex to the bone that drives it, as % of that span.');
    console.log('EVERY vertex, no sampling. Each variant gets its own best-fit translation.');
    console.log('A correct skinned mesh: the winning variant is far below the others.\n');
    console.log('geometry variant        mean      median    p95       max');

    const v = new THREE.Vector3();
    const scored = [];
    for (const [label, M] of variants) {
      /*
       * Best-fit translation for THIS rotation: align the vertex centroid onto the centroid of the bones
       * those vertices belong to. Rotation about the origin on off-centre geometry otherwise adds a
       * translation error that swamps the orientation signal being tested.
       */
      const cp = new THREE.Vector3(), cq = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        cp.add(v.fromBufferAttribute(pos, i).applyMatrix4(M));
        cq.add(bindPos[dom[i]]);
      }
      cp.divideScalar(pos.count); cq.divideScalar(pos.count);
      const t = cq.clone().sub(cp);

      const ds = [];
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(M).add(t);
        ds.push(v.distanceTo(bindPos[dom[i]]) / span);
      }
      ds.sort((a, b) => a - b);
      const mean = ds.reduce((s, x) => s + x, 0) / ds.length;
      scored.push({ label: label.trim(), mean });
      const pc = (x) => `${(x * 100).toFixed(2)}%`;
      console.log(`${label} ${pc(mean).padEnd(9)} ${pc(ds[ds.length >> 1]).padEnd(9)} ` +
        `${pc(ds[Math.floor(ds.length * 0.95)]).padEnd(9)} ${pc(ds[ds.length - 1])}`);
    }

    // The raw spans, printed side by side so the up-axis is unambiguous rather than inferred.
    const bb = new THREE.Box3(); bindPos.forEach(p => bb.expandByPoint(p));
    const bs = new THREE.Vector3(); bb.getSize(bs);
    console.log(`\ngeometry span (raw)   X=${r(gs.x)}  Y=${r(gs.y)}  Z=${r(gs.z)}`);
    console.log(`bind skeleton span    X=${r(bs.x)}  Y=${r(bs.y)}  Z=${r(bs.z)}`);
    console.log(`geometry Y..Z centre  Y=${r((geo.boundingBox.min.y + geo.boundingBox.max.y) / 2)}  Z=${r((geo.boundingBox.min.z + geo.boundingBox.max.z) / 2)}`);
    console.log(`skeleton Y..Z centre  Y=${r((bb.min.y + bb.max.y) / 2)}  Z=${r((bb.min.z + bb.max.z) / 2)}`);

    /*
     * Name the winner explicitly. The whole point is that the numbers above are only meaningful in
     * comparison, and a reader who does not already know that "as authored" SHOULD win can otherwise read
     * a small rotated figure as a suggestion to rotate.
     */
    scored.sort((a, b) => a.mean - b.mean);
    const best = scored[0];
    const runnerUp = scored[1];
    const margin = runnerUp ? runnerUp.mean / Math.max(best.mean, 1e-9) : Infinity;
    console.log(`\nbest variant: ${best.label}  (mean ${(best.mean * 100).toFixed(2)}% of span, ` +
      `${Number.isFinite(margin) ? margin.toFixed(1) + 'x better than the next' : 'no alternative'})`);

    /*
     * The verdict tests the MARGIN, not an absolute distance. A low-poly limb is genuinely a few percent
     * of body span thick, so ~8% mean is what a correct mesh looks like here; what proves alignment is
     * that the alternatives are multiples worse. If no variant separates from the others, no rigid
     * transform explains the pairing and the fault is in the weights or joint mapping instead.
     */
    if (margin < 1.5) {
      console.log('=> DEFECT: no orientation is clearly better than the others, so no rigid transform');
      console.log('   reconciles geometry with its bind skeleton. Suspect skin weights or joint mapping,');
      console.log('   not the up-axis. This file will deform unpredictably when animated.');
    } else if (best.label === 'as authored') {
      console.log('=> SOUND, and ALREADY CORRECTLY ORIENTED. Geometry and skeleton share one space as authored.');
      console.log('   Any downstream up-axis correction must be CONDITIONAL, or it will lay this figure down.');
    } else {
      console.log(`=> Geometry needs "${best.label}" to align with its skeleton: the exporter left the two`);
      console.log('   halves in different up-axis conventions. Fix at conversion time, not at load time.');
    }
  });
}, (e) => { console.error('parse failed', e); process.exit(1); });
