/**
 * Why did the picker's own tear measurement return exactly 0.0000 m, and why is its bind box 0.380 m?
 *
 *   cd app && X_PORT=<dev port> npx electron ../tools/glb_shape_probe.cjs
 *
 * Two suspicious readings came out of `picker_gate.cjs`, and a gate that passes for the wrong reason is
 * worse than one that fails, so neither gets assumed away:
 *
 *   1. EVERY edge -- rest and posed, both companions, all 22 clips -- measured exactly 0.0000 m. An exact
 *      zero is not a small number, it is a code path that never ran. `worstEdge` bails on
 *      "if (!pos || !index) return;", so a NON-INDEXED geometry produces 0 silently. The FBXLoader hands
 *      back non-indexed geometry and GLTFExporter writes what it is given, so the converted files may
 *      well have no index buffer at all -- which would make the app's tear gate permanently inert.
 *
 *   2. Box3.setFromObject reported 0.380 m tall where the GPU harness measured the skinned figure at
 *      1.750 m. Without precise=true, setFromObject unions geometry.boundingBox x matrixWorld, which is
 *      the REST geometry in mesh-local space -- it does not account for the skinning transform at all.
 *      If those disagree, normaliseUpright is dividing into the wrong height and every figure is scaled
 *      by the ratio between them.
 *
 * Also checked: whether the exported GLB is already Y-up. The picker applies a fixed +90 degrees about X
 * to stand up a Z-up authored mesh. If the converter already normalised orientation, that rotation lays
 * the figure on its side, and "height" would then be measuring its depth.
 *
 * No backticks in the injected script, including in comments.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env['X_PORT'] || '5301';
const OUT = path.join(ROOT, '_shots');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'glb-shape-probe.log');
fs.writeFileSync(LOG, '');
const hb = (m) => { fs.appendFileSync(LOG, `${m}\n`); console.log(m); };

const TARGETS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['companions/companion-a.glb', 'companions/companion-b.glb'];

const { app, BrowserWindow } = require('electron');
process.on('uncaughtException', (e) => { hb(`EXC ${e && e.stack}`); app.exit(9); });

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 400, height: 300, show: false, webPreferences: { backgroundThrottling: false } });
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 && !/Multiple instances/.test(message)) hb(`  page: ${message}`);
  });
  await win.loadURL(`http://localhost:${PORT}/`);

  const PAGE = `
    (async (CFG) => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');

      const gltf = await new Promise((res, rej) => new GLTFLoader().load(CFG.url, res, undefined, rej));
      const scene = gltf.scene;
      scene.updateMatrixWorld(true);

      let mesh = null;
      scene.traverse(o => { if (o.isSkinnedMesh && !mesh) mesh = o; });
      if (!mesh) return { error: 'no skinned mesh' };

      const geo = mesh.geometry;
      const pos = geo.attributes.position;

      /* --- 1. is there an index buffer at all? --- */
      const indexed = !!geo.index;
      const indexCount = geo.index ? geo.index.count : 0;

      /* --- 2. three ways of measuring the same figure, with no rotation applied --- */
      const v = new THREE.Vector3();

      /* (a) raw geometry bbox x matrixWorld -- what setFromObject does WITHOUT precise. */
      geo.computeBoundingBox();
      const rawBox = geo.boundingBox.clone().applyMatrix4(mesh.matrixWorld);

      /* (b) setFromObject exactly as the picker calls it. */
      const looseBox = new THREE.Box3().setFromObject(scene);

      /* (c) setFromObject with precise=true, which DOES run getVertexPosition -> bone transform. */
      const preciseBox = new THREE.Box3().setFromObject(scene, true);

      /* (d) the ground truth the GPU harness uses: every vertex through applyBoneTransform. */
      const skinBox = new THREE.Box3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        mesh.applyBoneTransform(i, v);
        v.applyMatrix4(mesh.matrixWorld);
        skinBox.expandByPoint(v);
      }

      const sizeOf = (b) => {
        const s = b.getSize(new THREE.Vector3());
        return { x: s.x, y: s.y, z: s.z };
      };

      /* --- 3. what the picker's pipeline produces once its +90deg about X is applied --- */
      const upright = new THREE.Group();
      upright.rotation.x = Math.PI / 2;
      upright.add(scene);
      upright.updateMatrixWorld(true);
      const pickerBox = new THREE.Box3().setFromObject(upright);
      const pickerSkinBox = new THREE.Box3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        mesh.applyBoneTransform(i, v);
        v.applyMatrix4(mesh.matrixWorld);
        pickerSkinBox.expandByPoint(v);
      }

      /* --- 4. node transform chain from the skinned mesh up to the scene root --- */
      const chain = [];
      for (let o = mesh; o; o = o.parent) {
        chain.push({
          name: o.name || o.type, type: o.type,
          scale: [o.scale.x, o.scale.y, o.scale.z],
          rotX: o.rotation.x, pos: [o.position.x, o.position.y, o.position.z],
        });
      }

      /* --- 5. a longest-edge measurement that does NOT depend on an index buffer --- */
      const a = new THREE.Vector3(), b = new THREE.Vector3();
      const triN = geo.index ? Math.floor(geo.index.count / 3) : Math.floor(pos.count / 3);
      let restEdgeNoIndex = 0;
      for (let t = 0; t < triN; t++) {
        const ia = geo.index ? geo.index.getX(t * 3) : t * 3;
        const ib = geo.index ? geo.index.getX(t * 3 + 1) : t * 3 + 1;
        a.fromBufferAttribute(pos, ia); mesh.applyBoneTransform(ia, a); a.applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(pos, ib); mesh.applyBoneTransform(ib, b); b.applyMatrix4(mesh.matrixWorld);
        restEdgeNoIndex = Math.max(restEdgeNoIndex, a.distanceTo(b));
      }

      return {
        indexed: indexed, indexCount: indexCount, vertexCount: pos.count, triCount: triN,
        rawBox: sizeOf(rawBox), looseBox: sizeOf(looseBox), preciseBox: sizeOf(preciseBox),
        skinBox: sizeOf(skinBox), pickerBox: sizeOf(pickerBox), pickerSkinBox: sizeOf(pickerSkinBox),
        chain: chain, restEdgeNoIndex: restEdgeNoIndex,
        clipCount: (gltf.animations || []).length,
      };
    })(JSON.parse(CFG_JSON))
  `;

  hb('=== GLB shape probe: index buffer, and four ways of measuring one figure ===\n');

  for (const rel of TARGETS) {
    const url = '/' + rel.replace(/^public\//, '').replace(/^\/+/, '');
    const r = await win.webContents.executeJavaScript(
      `((CFG_JSON) => ${PAGE})(${JSON.stringify(JSON.stringify({ url }))})`,
    );
    if (r.error) { hb(`${rel}: ERROR ${r.error}`); continue; }

    const fmt = (s) => `${s.x.toFixed(3)} x ${s.y.toFixed(3)} x ${s.z.toFixed(3)}`;

    hb(`--- ${rel} ---`);
    hb(`  geometry            : ${r.vertexCount} verts, ${r.triCount} tris, ${r.clipCount} clips`);
    hb(`  INDEX BUFFER        : ${r.indexed ? `present (${r.indexCount} indices)` : 'ABSENT'}`);
    if (!r.indexed) {
      hb('    -> Picker.worstEdge() returns early on "if (!pos || !index) return", so it measured');
      hb('       nothing. That is the exact 0.0000 m, and it means the app tear gate is INERT on');
      hb('       these files: assessRigIntegrity is handed maxEdge = 0 and passes unconditionally.');
      hb(`    -> the same measurement WITHOUT needing an index: longest rest edge ${r.restEdgeNoIndex.toFixed(4)} m`);
    }
    hb('  size (x by y by z), no rotation applied:');
    hb(`    geometry bbox x matrixWorld : ${fmt(r.rawBox)}`);
    hb(`    setFromObject (as picker)   : ${fmt(r.looseBox)}`);
    hb(`    setFromObject precise=true  : ${fmt(r.preciseBox)}`);
    hb(`    every vertex skinned        : ${fmt(r.skinBox)}   <- ground truth`);
    hb(`  with the picker's +90deg about X applied:`);
    hb(`    setFromObject (as picker)   : ${fmt(r.pickerBox)}`);

    const truth = r.skinBox.y;
    const loose = r.looseBox.y;
    if (truth > 1e-6 && Math.abs(loose - truth) / truth > 0.02) {
      hb(`  MISMATCH: setFromObject reports ${loose.toFixed(3)} m tall, skinned truth is ${truth.toFixed(3)} m` +
        ` (${(loose / truth).toFixed(3)}x).`);
      hb(`    normaliseUpright divides TARGET by the loose number, so the figure ends up ` +
        `${(truth / loose).toFixed(2)}x its intended size.`);
    }

    const already = Math.abs(r.skinBox.y - 1.75) < 0.05;
    hb(`  already Y-up and 1.75 m tall?  ${already ? 'YES — the converter normalised it' : 'no'}`);
    if (already) {
      hb('    -> the picker then rotates it another +90deg about X, which lays it on its side.');
    }
    hb('  node chain from skinned mesh to root:');
    for (const n of r.chain) {
      hb(`    ${n.type.padEnd(12)} ${(n.name || '').padEnd(16)} scale [${n.scale.map(x => x.toFixed(4)).join(', ')}]` +
        `  rotX ${n.rotX.toFixed(4)}  pos [${n.pos.map(x => x.toFixed(3)).join(', ')}]`);
    }
    hb('');
  }
  app.exit(0);
}).catch(e => { hb(`REJ ${e && e.stack}`); app.exit(6); });
