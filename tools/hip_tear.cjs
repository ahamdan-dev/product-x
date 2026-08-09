/**
 * The male companion has a visible spike at the hips during idle1. Is it MINE, or is it the asset's?
 *
 *   cd app && X_PORT=<dev port> npx electron ../tools/hip_tear.cjs
 *
 * WHY THIS RUNS AT ALL
 *
 * `gpu_check.cjs` passed companion-a at 7.10% worst edge growth, well under its 25% gate, and the
 * whole-body capture looked like a clean figure. Then the picker screenshot at card size showed a
 * triangle spike jutting between the legs and the left thigh reading as detached. So the gate has a
 * false negative and the picture is the thing that caught it -- which is the order the acceptance test
 * was always meant to work in, but it means the number needs to be understood before it is trusted
 * again on the next asset.
 *
 * Two things get measured, because the fix depends on which is true:
 *
 *   1. IS IT INHERENT? idle1 is a SAME-RIG clip for the male: it ships in male_idle1_200f.FBX, the very
 *      file the mesh and skeleton come from. `fbx_vs_glb.cjs` already showed same-rig conversion is
 *      exact to three decimals. So the same frame is rendered from the source FBX and from the GLB,
 *      side by side, at the same camera. If the FBX spikes too, this is authored and not mine to fix
 *      by editing geometry -- the honest options are to pick a different idle or accept it.
 *   2. WHERE IS IT, EXACTLY? Per-triangle worst growth, sorted, with the vertex indices and their bone
 *      weights. A tear from bad weights names a specific handful of vertices, and their weights say
 *      which bone is dragging them.
 *
 * Rendered zoomed on the pelvis, because that is where the defect is and a whole-body frame is what
 * hid it. Written large enough to see: the earlier 512px whole-figure capture is exactly the kind of
 * evidence that looked fine while being wrong.
 *
 * No backticks in the injected script, including in comments.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PACK_ABS = path.join(ROOT, '_refs', 'PRODUCT-X', 'V1-LOW-POLY-ANIMATIONS (Unzipped Files)', 'fbx');
const PORT = process.env['X_PORT'] || '5301';
const PACK_PORT = 5394;

const OUT = path.join(ROOT, '_shots');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'hip-tear.log');
fs.writeFileSync(LOG, '');
const hb = (m) => { fs.appendFileSync(LOG, `${m}\n`); console.log(m); };

const CASES = [
  { tag: 'glb-idle1', kind: 'glb', url: '/companions/companion-a.glb', clip: 'idle1' },
  { tag: 'fbx-idle1', kind: 'fbx', url: 'male_idle1_200f.FBX', clip: null },
];

const { app, BrowserWindow } = require('electron');
process.on('uncaughtException', (e) => { hb(`EXC ${e && e.stack}`); app.exit(9); });

app.whenReady().then(async () => {
  const allowed = new Set(['male_idle1_200f.FBX', 'peopleColors.png']);
  const server = require('node:http').createServer((req, res) => {
    const name = decodeURIComponent(req.url.replace(/^\//, '').split('?')[0]);
    if (!allowed.has(name)) { res.writeHead(404).end('no'); return; }
    res.writeHead(200, {
      'content-type': name.endsWith('.png') ? 'image/png' : 'application/octet-stream',
      'access-control-allow-origin': '*',
    });
    fs.createReadStream(path.join(PACK_ABS, name)).pipe(res);
  });
  await new Promise((r, j) => { server.once('error', j); server.listen(PACK_PORT, '127.0.0.1', r); });

  const win = new BrowserWindow({ width: 900, height: 900, show: false, webPreferences: { backgroundThrottling: false } });
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 && !/skinning weights|No target node|CORS policy|Multiple instances|Security Warning|unsafe-eval|electronjs.org|^\s*$|once the app is packaged|consult/.test(message)) hb(`  page: ${message}`);
  });
  await win.loadURL(`http://localhost:${PORT}/`);

  const PAGE = `
    (async (CFG) => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
      const { FBXLoader } = await import('/node_modules/three/examples/jsm/loaders/FBXLoader.js');

      let root, clips;
      if (CFG.kind === 'glb') {
        const g = await new Promise((res, rej) => new GLTFLoader().load(CFG.url, res, undefined, rej));
        root = g.scene; clips = g.animations || [];
      } else {
        const f = await new Promise((res, rej) => new FBXLoader().load(CFG.pack + encodeURIComponent(CFG.url), res, undefined, rej));
        root = f; clips = f.animations || [];
      }
      root.updateMatrixWorld(true);

      let mesh = null;
      root.traverse(o => { if (o.isSkinnedMesh && !mesh) mesh = o; });
      if (!mesh) return { error: 'no skinned mesh' };

      /* Flat white: the silhouette and its spikes, with no texture to hide them. */
      const original = mesh.material;
      mesh.material = new THREE.MeshBasicMaterial({ color: 0xffffff });

      const geo = mesh.geometry, pos = geo.attributes.position, idx = geo.index;
      const skinIdx = geo.attributes.skinIndex, skinW = geo.attributes.skinWeight;
      const triN = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);
      const cornerOf = (i) => (idx ? idx.getX(i) : i);

      const REST = mesh.skeleton.bones.map(b => ({
        bone: b, p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone(),
      }));
      const resetPose = () => {
        for (const r of REST) { r.bone.position.copy(r.p); r.bone.quaternion.copy(r.q); r.bone.scale.copy(r.s); }
        root.updateMatrixWorld(true);
      };

      const tmp = new THREE.Vector3();
      const skin = (i, into) => {
        into.fromBufferAttribute(pos, i);
        mesh.applyBoneTransform(i, into);
        return into.applyMatrix4(mesh.matrixWorld);
      };

      /* Body height of the skinned bind figure, so growth is scale-free. */
      resetPose();
      const bindBox = new THREE.Box3();
      for (let i = 0; i < pos.count; i++) bindBox.expandByPoint(skin(i, tmp));
      const height = bindBox.getSize(new THREE.Vector3()).y || 1;
      const bindMin = bindBox.min.clone(), bindMax = bindBox.max.clone();

      /* EVERY triangle edge at bind -- no sampling stride, which is how a local defect gets missed. */
      const a = new THREE.Vector3(), b = new THREE.Vector3();
      const bindLen = new Float64Array(triN * 3);
      for (let t = 0; t < triN; t++) {
        const i0 = cornerOf(t*3), i1 = cornerOf(t*3+1), i2 = cornerOf(t*3+2);
        bindLen[t*3]   = skin(i0, a).distanceTo(skin(i1, b));
        bindLen[t*3+1] = skin(i1, a).distanceTo(skin(i2, b));
        bindLen[t*3+2] = skin(i2, a).distanceTo(skin(i0, b));
      }

      const clip = CFG.clip ? clips.find(c => c.name === CFG.clip) : clips[0];
      if (!clip) return { error: 'clip not found: ' + CFG.clip };

      /* Walk the clip densely and keep the worst growth per edge, plus the frame it happened on. */
      const mixer = new THREE.AnimationMixer(mesh);
      mixer.clipAction(clip).reset().play();
      const worstGrow = new Float64Array(triN * 3);
      const worstAt = new Float64Array(triN * 3);
      const STEPS = 48;
      let peak = 0, peakT = 0;
      for (let s = 0; s <= STEPS; s++) {
        const t = clip.duration * (s / STEPS);
        mixer.setTime(t);
        root.updateMatrixWorld(true);
        for (let tri = 0; tri < triN; tri++) {
          const i0 = cornerOf(tri*3), i1 = cornerOf(tri*3+1), i2 = cornerOf(tri*3+2);
          const l0 = skin(i0, a).distanceTo(skin(i1, b));
          const l1 = skin(i1, a).distanceTo(skin(i2, b));
          const l2 = skin(i2, a).distanceTo(skin(i0, b));
          const cand = [l0, l1, l2];
          for (let e = 0; e < 3; e++) {
            const g = (cand[e] - bindLen[tri*3+e]) / height;
            if (g > worstGrow[tri*3+e]) { worstGrow[tri*3+e] = g; worstAt[tri*3+e] = t; }
            if (g > peak) { peak = g; peakT = t; }
          }
        }
      }

      /* The ten worst edges, with the bone weights of the vertices involved. */
      const order = [];
      for (let i = 0; i < worstGrow.length; i++) order.push(i);
      order.sort((x, y) => worstGrow[y] - worstGrow[x]);
      const bones = mesh.skeleton.bones;
      const weightsOf = (vi) => {
        const out = [];
        for (let k = 0; k < 4; k++) {
          const bi = skinIdx.getComponent(vi, k), w = skinW.getComponent(vi, k);
          if (w > 0.001) out.push((bones[bi] ? bones[bi].name : '?' + bi) + ':' + w.toFixed(3));
        }
        return out.join(' ');
      };
      const top = [];
      for (let n = 0; n < 10 && n < order.length; n++) {
        const e = order[n], tri = Math.floor(e / 3), which = e % 3;
        const pair = [[0,1],[1,2],[2,0]][which];
        const vA = cornerOf(tri*3 + pair[0]), vB = cornerOf(tri*3 + pair[1]);
        top.push({
          growth: worstGrow[e], atTime: worstAt[e], tri: tri,
          bindLen: bindLen[e], vA: vA, vB: vB,
          wA: weightsOf(vA), wB: weightsOf(vB),
        });
      }

      /* Where is the worst vertex, in body-relative terms? Names the region without guessing. */
      mixer.setTime(peakT);
      root.updateMatrixWorld(true);
      const worstV = top[0] ? top[0].vA : 0;
      skin(worstV, tmp);
      const rel = {
        x: (tmp.x - bindMin.x) / (bindMax.x - bindMin.x || 1),
        y: (tmp.y - bindMin.y) / (bindMax.y - bindMin.y || 1),
        z: (tmp.z - bindMin.z) / (bindMax.z - bindMin.z || 1),
      };

      /* ---- render the peak frame, zoomed on the pelvis ---- */
      const W = 800, H = 800;
      document.body.innerHTML = '';
      document.body.style.margin = '0';
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(W, H);
      renderer.setClearColor(0x101014, 1);
      document.body.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 3));
      scene.add(root);

      const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
      const centre = new THREE.Vector3(
        (bindMin.x + bindMax.x) / 2,
        bindMin.y + (bindMax.y - bindMin.y) * CFG.focusY,
        (bindMin.z + bindMax.z) / 2,
      );
      const span = (bindMax.y - bindMin.y) * CFG.spanFrac;
      const dist = (span / 2) / Math.tan((35 * Math.PI / 180) / 2);
      camera.position.set(centre.x, centre.y, centre.z + dist);
      camera.lookAt(centre);
      camera.updateMatrixWorld(true);

      mixer.setTime(peakT);
      root.updateMatrixWorld(true);
      renderer.render(scene, camera);
      const pngZoom = renderer.domElement.toDataURL('image/png');

      /* And the whole figure at the same frame, for context. */
      const fullCentre = new THREE.Vector3((bindMin.x+bindMax.x)/2, (bindMin.y+bindMax.y)/2, (bindMin.z+bindMax.z)/2);
      const fullSpan = (bindMax.y - bindMin.y) * 1.15;
      const fullDist = (fullSpan / 2) / Math.tan((35 * Math.PI / 180) / 2);
      camera.position.set(fullCentre.x, fullCentre.y, fullCentre.z + fullDist);
      camera.lookAt(fullCentre);
      camera.updateMatrixWorld(true);
      renderer.render(scene, camera);
      const pngFull = renderer.domElement.toDataURL('image/png');

      /*
       * And the same pelvis close-up TEXTURED, which is what the user actually sees.
       *
       * The flat-white pass above answers "is the geometry torn"; it cannot answer "does it look
       * wrong", because a texture seam or a dark-on-dark material boundary reads as a crack in a card-
       * sized preview while the silhouette is perfectly intact. Both renders are needed to tell those
       * two apart, and this one is the one to compare against the picker screenshot.
       */
      mesh.material = original;
      camera.position.set(centre.x, centre.y, centre.z + dist);
      camera.lookAt(centre);
      camera.updateMatrixWorld(true);
      scene.add(new THREE.DirectionalLight(0xffffff, 1.2).translateY(2));
      mixer.setTime(peakT);
      root.updateMatrixWorld(true);
      renderer.render(scene, camera);
      const pngTextured = renderer.domElement.toDataURL('image/png');

      return {
        pngTextured: pngTextured,
        height: height, triCount: triN, indexed: !!idx, vertexCount: pos.count,
        clipName: clip.name, duration: clip.duration, tracks: clip.tracks.length,
        peak: peak, peakT: peakT, top: top, rel: rel,
        pngZoom: pngZoom, pngFull: pngFull,
      };
    })(JSON.parse(CFG_JSON))
  `;

  hb('=== the hip spike on companion-a idle1: mine, or the asset\'s? ===');
  hb('Every triangle edge, 49 frames, no sampling stride -- the 1500-triangle stride in gpu_check.cjs');
  hb('is a candidate for how a local defect passed a 25% gate at 7.10%.\n');

  const results = {};
  for (const c of CASES) {
    const r = await win.webContents.executeJavaScript(
      `((CFG_JSON) => ${PAGE})(${JSON.stringify(JSON.stringify({
        kind: c.kind, url: c.url, clip: c.clip,
        pack: `http://127.0.0.1:${PACK_PORT}/`,
        focusY: 0.52, spanFrac: 0.42,
      }))})`,
    );
    if (r.error) { hb(`${c.tag}: ERROR ${r.error}`); continue; }
    results[c.tag] = r;

    hb(`--- ${c.tag} (${c.kind.toUpperCase()}) ---`);
    hb(`  clip "${r.clipName}"  ${r.duration.toFixed(3)}s  ${r.tracks} tracks   ` +
      `${r.vertexCount} verts / ${r.triCount} tris   index ${r.indexed ? 'present' : 'absent'}`);
    hb(`  body height ${r.height.toFixed(4)} m`);
    hb(`  WORST edge growth ${(r.peak * 100).toFixed(2)}% of body height at t=${r.peakT.toFixed(3)}s`);
    hb(`  worst vertex sits at ${(r.rel.x * 100).toFixed(0)}% across, ` +
      `${(r.rel.y * 100).toFixed(0)}% up, ${(r.rel.z * 100).toFixed(0)}% deep`);
    hb('  ten worst edges:');
    for (const t of r.top) {
      hb(`    ${(t.growth * 100).toFixed(2).padStart(7)}%  tri ${String(t.tri).padStart(5)}  ` +
        `bind ${(t.bindLen * 1000).toFixed(1).padStart(6)} mm  t=${t.atTime.toFixed(2)}`);
      hb(`             v${t.vA}: ${t.wA}`);
      hb(`             v${t.vB}: ${t.wB}`);
    }
    for (const [key, suffix] of [['pngZoom', 'pelvis'], ['pngFull', 'full'], ['pngTextured', 'pelvis-textured']]) {
      const f = path.join(OUT, `hip-${c.tag}-${suffix}.png`);
      fs.writeFileSync(f, Buffer.from(r[key].split(',')[1], 'base64'));
      hb(`  wrote ${f}`);
    }
    hb('');
  }

  const g = results['glb-idle1'], f = results['fbx-idle1'];
  if (g && f) {
    hb('--- verdict ---');
    hb(`  GLB worst growth ${(g.peak * 100).toFixed(2)}%   source FBX worst growth ${(f.peak * 100).toFixed(2)}%`);
    const ratio = f.peak > 1e-9 ? g.peak / f.peak : Infinity;
    hb(`  ratio ${Number.isFinite(ratio) ? ratio.toFixed(3) + 'x' : 'n/a'}`);
    hb(Math.abs(g.peak - f.peak) / Math.max(f.peak, 1e-9) < 0.05
      ? '  INHERENT TO THE ASSET: the source FBX deforms the same amount on its own rig, so the\n' +
        '  conversion did not introduce this. Editing geometry would be inventing art; the honest\n' +
        '  options are a different idle clip, or accepting it.'
      : '  INTRODUCED BY CONVERSION: the GLB deforms measurably more than the source on its own rig.\n' +
        '  This one is mine to fix.');
  }
  app.exit(0);
}).catch(e => { hb(`REJ ${e && e.stack}`); app.exit(6); });
