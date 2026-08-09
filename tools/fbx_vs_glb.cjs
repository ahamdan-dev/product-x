/**
 * Is the converted GLB as good as the FBX it came from?
 *
 *   cd app && X_PORT=<dev port> npx electron ../tools/fbx_vs_glb.cjs
 *
 * WHY THIS EXISTS
 *
 * The GPU check found a small population of edges on the converted companions stretching a few times their
 * bind length -- worst case 113 mm of absolute growth on a 2 m figure, at the shoulder, when a clip throws
 * an arm overhead. The known-broken Blender export, by contrast, grows an edge by 1.94 m, or 107% of body
 * height. Those are plainly different in kind, but "113 mm" is not self-evidently acceptable and no
 * threshold I invent can settle it, because the honest question is not "how much does it stretch" but
 * "does it stretch MORE THAN THE SOURCE ASSET DOES".
 *
 * Linear-blend skinning on a low-poly mesh with four influences per vertex genuinely stretches armpit and
 * shoulder triangles when an arm goes overhead -- the candy-wrapper artifact. If the source FBX shows the
 * same growth at the same pose, the conversion is faithful and the remaining stretch is the pack's own
 * authoring, which is not mine to fix and not a defect in the pipeline. If the GLB is meaningfully worse,
 * the conversion damaged something.
 *
 * METHOD
 *
 * Load the source FBX and the converted GLB side by side in the same three.js, play the same clip on both,
 * and sample the same normalised times. Vertex indices need not correspond -- GLTFExporter may reorder --
 * so the comparison is between DISTRIBUTIONS of per-edge growth, plus max absolute growth normalised by
 * each figure's own height. Scale-free by construction, which matters because the GLB is normalised to
 * 1.75 m and the FBX is ~180 units tall.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PACK_ABS = path.join(ROOT, '_refs', 'PRODUCT-X', 'V1-LOW-POLY-ANIMATIONS (Unzipped Files)', 'fbx');
const PORT = process.env['X_PORT'] || '5301';
const PACK_PORT = 5398;

/** [glb under test, source FBX for the same rig, clip name in the GLB]. */
const PAIRS = [
  ['companion-a.glb', 'male_idle1_200f.FBX', 'idle1'],
  ['companion-a.glb', 'ani_hype_100f.FBX', 'hype'],
  ['companion-b.glb', 'female_idle1_150f.FBX', 'idle1'],
  ['companion-b.glb', 'ani_hype_100f.FBX', 'hype'],
];

const OUT = path.join(ROOT, '_shots');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'fbx-vs-glb.log');
fs.writeFileSync(LOG, '');
const hb = (m) => { fs.appendFileSync(LOG, `${m}\n`); console.log(m); };

const { app, BrowserWindow } = require('electron');
process.on('uncaughtException', (e) => { hb(`EXC ${e && e.stack}`); app.exit(9); });

app.whenReady().then(async () => {
  const allowed = new Set([...PAIRS.map(p => p[1]), 'peopleColors.png']);
  const MIME = { '.png': 'image/png' };
  const server = require('node:http').createServer((req, res) => {
    const name = decodeURIComponent(req.url.replace(/^\//, '').split('?')[0]);
    if (!allowed.has(name)) { res.writeHead(404).end('no'); return; }
    res.writeHead(200, {
      'content-type': MIME[path.extname(name).toLowerCase()] || 'application/octet-stream',
      'access-control-allow-origin': '*',
    });
    fs.createReadStream(path.join(PACK_ABS, name)).pipe(res);
  });
  await new Promise((r, j) => { server.once('error', j); server.listen(PACK_PORT, '127.0.0.1', r); });

  const win = new BrowserWindow({ width: 400, height: 300, show: false, webPreferences: { backgroundThrottling: false } });
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) hb(`  page: ${message}`); });
  await win.loadURL(`http://localhost:${PORT}/`);

  // No backticks anywhere below: this whole string is injected inside a template literal.
  const PAGE = `
    (async (CFG) => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { FBXLoader } = await import('/node_modules/three/examples/jsm/loaders/FBXLoader.js');
      const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');

      /* Per-edge growth distribution for one skinned root, over one clip, normalised by body height. */
      function analyse(root, clip) {
        let mesh = null;
        root.traverse(o => { if (o.isSkinnedMesh && !mesh) mesh = o; });
        if (!mesh) return { error: 'no skinned mesh' };

        const geo = mesh.geometry, pos = geo.attributes.position, idx = geo.index;
        const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);

        const seen = new Set(), edges = [];
        for (let t = 0; t < triCount; t++) {
          const a = idx ? idx.getX(t*3) : t*3, b = idx ? idx.getX(t*3+1) : t*3+1, c = idx ? idx.getX(t*3+2) : t*3+2;
          for (const pr of [[a,b],[b,c],[c,a]]) {
            const lo = Math.min(pr[0], pr[1]), hi = Math.max(pr[0], pr[1]), k = lo + '_' + hi;
            if (!seen.has(k)) { seen.add(k); edges.push([lo, hi]); }
          }
        }

        const p = new THREE.Vector3(), q = new THREE.Vector3();
        const skin = (i, into) => {
          into.fromBufferAttribute(pos, i);
          mesh.applyBoneTransform(i, into);
          return into.applyMatrix4(mesh.matrixWorld);
        };
        const lens = () => edges.map(e => skin(e[0], p).distanceTo(skin(e[1], q)));
        const bbox = () => {
          const box = new THREE.Box3(), v = new THREE.Vector3();
          for (let i = 0; i < pos.count; i++) box.expandByPoint(skin(i, v));
          return box;
        };

        root.updateMatrixWorld(true);
        const bind = lens();
        const height = bbox().getSize(new THREE.Vector3()).y;

        const mixer = new THREE.AnimationMixer(mesh);
        mixer.clipAction(clip).reset().play();
        const worst = bind.slice();
        for (let s = 0; s <= 12; s++) {
          mixer.setTime(clip.duration * (s / 12));
          root.updateMatrixWorld(true);
          const now = lens();
          for (let i = 0; i < now.length; i++) if (now[i] > worst[i]) worst[i] = now[i];
        }

        /* Growth as a FRACTION OF BODY HEIGHT, so the FBX's 180-unit scale and the GLB's 1.75 m compare. */
        const grow = [], ratio = [];
        for (let i = 0; i < bind.length; i++) {
          grow.push((worst[i] - bind[i]) / height);
          if (bind[i] > 1e-9) ratio.push(worst[i] / bind[i]);
        }
        grow.sort((x, y) => x - y); ratio.sort((x, y) => x - y);
        const at = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(arr.length * f))];
        return {
          edges: edges.length,
          height: height,
          growP50: at(grow, 0.5), growP99: at(grow, 0.99), growMax: grow[grow.length - 1],
          ratioP99: at(ratio, 0.99), ratioMax: ratio[ratio.length - 1],
          over1p5: ratio.filter(r => r > 1.5).length,
        };
      }

      const fbx = await new Promise((res, rej) =>
        new FBXLoader().load(CFG.fbx, res, undefined, e => rej(new Error('fbx: ' + (e && (e.message || e.type))))));
      const gltf = await new Promise((res, rej) =>
        new GLTFLoader().load(CFG.glb, res, undefined, e => rej(new Error('glb: ' + (e && (e.message || e.type))))));

      const gclip = gltf.animations.find(c => c.name === CFG.clip);
      if (!gclip) return { error: 'clip ' + CFG.clip + ' not in glb' };
      if (!fbx.animations[0]) return { error: 'no animation in fbx' };

      return { fbx: analyse(fbx, fbx.animations[0]), glb: analyse(gltf.scene, gclip) };
    })(JSON.parse(CFG_JSON))
  `;

  hb('=== source FBX vs converted GLB: per-edge growth as a fraction of body height ===');
  hb('Growth is normalised by each figure\'s own height, so the FBX\'s ~180-unit scale and the GLB\'s 1.75 m');
  hb('are directly comparable. The GLB is faithful if its numbers are not materially worse than the FBX\'s.\n');

  let verdictBad = 0;
  for (const [glb, fbxFile, clip] of PAIRS) {
    const r = await win.webContents.executeJavaScript(
      `((CFG_JSON) => ${PAGE})(${JSON.stringify(JSON.stringify({
        glb: `/companions/${glb}`,
        fbx: `http://127.0.0.1:${PACK_PORT}/${encodeURIComponent(fbxFile)}`,
        clip,
      }))})`,
    );
    if (r.error) { hb(`${glb} / ${clip}: ERROR ${r.error}`); verdictBad++; continue; }
    if (r.fbx.error || r.glb.error) { hb(`${glb} / ${clip}: ERROR ${r.fbx.error || r.glb.error}`); verdictBad++; continue; }

    const pct = (x) => `${(x * 100).toFixed(3)}%`;
    hb(`--- ${glb}  clip "${clip}"  (source ${fbxFile}) ---`);
    hb('              edges   height     growth p50   growth p99   growth max   ratio p99   ratio max   >1.5x');
    for (const [tag, s] of [['source FBX', r.fbx], ['our GLB  ', r.glb]]) {
      hb(`${tag}  ${String(s.edges).padStart(6)}  ${s.height.toFixed(3).padStart(8)}  ` +
        `${pct(s.growP50).padStart(11)}  ${pct(s.growP99).padStart(11)}  ${pct(s.growMax).padStart(11)}  ` +
        `${(s.ratioP99.toFixed(2) + 'x').padStart(9)}  ${(s.ratioMax.toFixed(1) + 'x').padStart(9)}  ` +
        `${String(s.over1p5).padStart(5)}`);
    }
    // The comparison that decides it: does OUR file stretch more than the asset we converted?
    const worse = r.glb.growMax > r.fbx.growMax * 1.25;
    hb(`  max growth  FBX ${pct(r.fbx.growMax)}  vs  GLB ${pct(r.glb.growMax)}  ->  ` +
      (worse ? 'GLB IS WORSE — conversion damaged the skin' : 'GLB matches the source (within 25%) — faithful conversion'));
    hb('');
    if (worse) verdictBad++;
  }

  hb(verdictBad === 0
    ? 'VERDICT: every converted GLB deforms no worse than the FBX it came from. The residual stretch is the\n' +
      '         pack\'s own low-poly shoulder weighting, present in the source asset, not a pipeline defect.'
    : `VERDICT: ${verdictBad} pair(s) show the GLB deforming worse than its source. Conversion is at fault.`);
  app.exit(0);
}).catch(e => { hb(`REJ ${e && e.stack}`); app.exit(6); });
