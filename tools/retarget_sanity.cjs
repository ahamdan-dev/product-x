/**
 * Do the retargeted clips actually MOVE the skeleton? A deformation number is meaningless if not.
 *
 *   cd app && X_PORT=<dev port> npx electron ../tools/retarget_sanity.cjs
 *
 * WHY
 *
 * `retarget_bench.cjs` reported SkeletonUtils.retargetClip as the winner, but its column was identical for
 * every clip in a rig -- 4.53% for all twelve male clips, 2.60% for all ten female ones. Twelve different
 * animations cannot deform a mesh by exactly the same amount. That is the signature of a measurement that
 * is not reading the clips at all, so the "winner" is an artifact and must not be acted on.
 *
 * A low deformation score is trivially achievable by producing a clip that does nothing. So before any
 * strategy is chosen, each one has to pass a liveness check:
 *
 *   1. bound tracks     -- do the track names resolve against the target skeleton's bone names?
 *   2. bone travel      -- how far do bones actually move across the clip, in body heights? Near zero means
 *                          an inert clip, however good its stretch number looks.
 *   3. pose fidelity    -- how closely does the retargeted pose match the source's own pose at the same
 *                          normalised time, comparing bone world positions after normalising for height?
 *                          This is the quantity that actually matters: a retarget is good when it
 *                          REPRODUCES the source motion, not when it minimises stretch.
 *
 * Reported per strategy per clip, so an inert or mangled result is impossible to mistake for a good one.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PACK_ABS = path.join(ROOT, '_refs', 'PRODUCT-X', 'V1-LOW-POLY-ANIMATIONS (Unzipped Files)', 'fbx');
const PORT = process.env['X_PORT'] || '5301';
const PACK_PORT = 5395;

/** A representative spread: a same-rig clip, a mildly-off one, and the two worst cross-rig offenders. */
const CASES = [
  ['male', 'male_idle1_200f.FBX', [['idle1', 'male_idle1_200f.FBX'], ['idle2', 'male_idle2_220f.FBX'],
    ['talk', 'male_phoneTalking_180f.FBX'], ['hype', 'ani_hype_100f.FBX'], ['dance', 'ani_dance_afro_56f.fbx']]],
  ['female', 'female_idle1_150f.FBX', [['idle1', 'female_idle1_150f.FBX'], ['walk', 'female_BasicWalk_30f.FBX'],
    ['hype', 'ani_hype_100f.FBX']]],
];

const OUT = path.join(ROOT, '_shots');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'retarget-sanity.log');
fs.writeFileSync(LOG, '');
const hb = (m) => { fs.appendFileSync(LOG, `${m}\n`); console.log(m); };

const { app, BrowserWindow } = require('electron');
process.on('uncaughtException', (e) => { hb(`EXC ${e && e.stack}`); app.exit(9); });

app.whenReady().then(async () => {
  const allowed = new Set([...CASES.flatMap(c => [c[1], ...c[2].map(x => x[1])]), 'peopleColors.png']);
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

  const win = new BrowserWindow({ width: 400, height: 300, show: false, webPreferences: { backgroundThrottling: false } });
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 && !/skinning weights|No target node|CORS policy|Multiple instances/.test(message)) hb(`  page: ${message}`);
  });
  await win.loadURL(`http://localhost:${PORT}/`);

  // No backticks below: injected inside a template literal.
  const PAGE = `
    (async (CFG) => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { FBXLoader } = await import('/node_modules/three/examples/jsm/loaders/FBXLoader.js');
      const SkeletonUtils = await import('/node_modules/three/examples/jsm/utils/SkeletonUtils.js');

      const load = (f) => new Promise((res, rej) =>
        new FBXLoader().load(CFG.pack + encodeURIComponent(f), res, undefined,
          e => rej(new Error('load ' + f + ': ' + (e && (e.message || e.type))))));
      const findMesh = (root) => { let m = null; root.traverse(o => { if (o.isSkinnedMesh && !m) m = o; }); return m; };

      function rig(root) {
        const mesh = findMesh(root);
        const bones = mesh.skeleton.bones;
        const rest = bones.map(b => ({ bone: b, p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() }));
        const reset = () => {
          for (const r of rest) { r.bone.position.copy(r.p); r.bone.quaternion.copy(r.q); r.bone.scale.copy(r.s); }
          root.updateMatrixWorld(true);
        };
        reset();
        /* Height from the skeleton itself, so it is available without a skinning pass. */
        const box = new THREE.Box3();
        const v = new THREE.Vector3();
        for (const b of bones) box.expandByPoint(v.setFromMatrixPosition(b.matrixWorld));
        const height = box.getSize(new THREE.Vector3()).y || 1;
        const names = new Set(bones.map(b => b.name));
        return { root: root, mesh: mesh, bones: bones, reset: reset, height: height, names: names };
      }

      /* Bone world positions at a normalised time, expressed in body heights relative to the hips, so two
         rigs of different sizes and rest poses can be compared pose-to-pose. */
      function sample(r, clip, f) {
        r.reset();
        const mixer = new THREE.AnimationMixer(r.mesh);
        mixer.clipAction(clip).reset().play();
        mixer.setTime(clip.duration * f);
        r.root.updateMatrixWorld(true);
        const v = new THREE.Vector3();
        const origin = new THREE.Vector3().setFromMatrixPosition(r.bones[0].matrixWorld);
        const map = new Map();
        for (const b of r.bones) {
          v.setFromMatrixPosition(b.matrixWorld).sub(origin).divideScalar(r.height);
          map.set(b.name, v.clone());
        }
        mixer.stopAllAction();
        mixer.uncacheClip(clip);
        r.reset();
        return map;
      }

      /* How far do bones travel across the clip, in body heights? Zero means an inert clip. */
      function travel(r, clip) {
        const first = sample(r, clip, 0);
        let maxT = 0;
        for (const f of [0.25, 0.5, 0.75, 1.0]) {
          const s = sample(r, clip, f);
          for (const [n, p] of s) {
            const a = first.get(n);
            if (a) maxT = Math.max(maxT, a.distanceTo(p));
          }
        }
        return maxT;
      }

      /* Mean per-bone position error against the source's own pose, in body heights. */
      function fidelity(src, dst, srcClip, dstClip) {
        let total = 0, count = 0;
        for (const f of [0, 0.25, 0.5, 0.75]) {
          const a = sample(src, srcClip, f), b = sample(dst, dstClip, f);
          for (const [n, p] of a) {
            const q = b.get(n);
            if (q) { total += p.distanceTo(q); count++; }
          }
        }
        return count ? total / count : NaN;
      }

      function bound(r, clip) {
        let n = 0;
        for (const t of clip.tracks) if (r.names.has(t.name.split('.')[0])) n++;
        return n + '/' + clip.tracks.length;
      }

      function rebase(clip, srcRig, dstRig) {
        const srcRest = new Map(srcRig.bones.map(b => [b.name, { q: b.quaternion.clone(), p: b.position.clone() }]));
        const dstRest = new Map(dstRig.bones.map(b => [b.name, { q: b.quaternion.clone(), p: b.position.clone() }]));
        const out = clip.clone();
        const q = new THREE.Quaternion(), Sinv = new THREE.Quaternion();
        for (const track of out.tracks) {
          const parts = track.name.split('.');
          const s = srcRest.get(parts[0]), d = dstRest.get(parts[0]);
          if (!s || !d) continue;
          if (parts[1] === 'quaternion') {
            Sinv.copy(s.q).invert();
            const v = track.values;
            for (let i = 0; i < v.length; i += 4) {
              q.set(v[i], v[i+1], v[i+2], v[i+3]);
              q.premultiply(Sinv).premultiply(d.q);
              v[i] = q.x; v[i+1] = q.y; v[i+2] = q.z; v[i+3] = q.w;
            }
          } else if (parts[1] === 'position') {
            const v = track.values;
            for (let i = 0; i < v.length; i += 3) {
              v[i] = d.p.x + (v[i] - s.p.x); v[i+1] = d.p.y + (v[i+1] - s.p.y); v[i+2] = d.p.z + (v[i+2] - s.p.z);
            }
          }
        }
        return out;
      }

      const baseRoot = await load(CFG.base);
      const base = rig(baseRoot);

      const rows = [];
      for (const entry of CFG.clips) {
        const name = entry[0], file = entry[1];
        const srcRoot = await load(file);
        const src = rig(srcRoot);
        const srcClip = srcRoot.animations[0];

        const row = { name: name, srcTravel: travel(src, srcClip), variants: {} };

        const raw = srcClip.clone();
        row.variants.raw = {
          bound: bound(base, raw), travel: travel(base, raw),
          fidelity: fidelity(src, base, srcClip, raw), tracks: raw.tracks.length,
        };

        const reb = rebase(srcClip, src, base);
        row.variants.rebase = {
          bound: bound(base, reb), travel: travel(base, reb),
          fidelity: fidelity(src, base, srcClip, reb), tracks: reb.tracks.length,
        };

        try {
          const lib = SkeletonUtils.retargetClip(base.mesh, src.mesh, srcClip, { fps: 30, useFirstFramePosition: false });
          base.reset();
          row.variants.library = {
            bound: bound(base, lib), travel: travel(base, lib),
            fidelity: fidelity(src, base, srcClip, lib), tracks: lib.tracks.length,
            trackSample: lib.tracks.slice(0, 3).map(t => t.name),
          };
        } catch (e) { row.variants.library = { error: (e && e.message) || 'threw' }; }

        rows.push(row);
      }
      return { rows: rows, baseBones: base.bones.length };
    })(JSON.parse(CFG_JSON))
  `;

  hb('=== liveness + fidelity check on each retargeting strategy ===');
  hb('travel   = max bone displacement across the clip, in body heights. Near 0 means the clip is INERT.');
  hb('fidelity = mean per-bone position error vs the source\'s own pose, in body heights. Lower is better.');
  hb('A low deformation score means nothing if travel is near zero, which is what this exists to catch.\n');

  for (const [rig, base, clips] of CASES) {
    const r = await win.webContents.executeJavaScript(
      `((CFG_JSON) => ${PAGE})(${JSON.stringify(JSON.stringify({
        base, clips, pack: `http://127.0.0.1:${PACK_PORT}/`,
      }))})`,
    );

    hb(`--- ${rig} rig (base ${base}, ${r.baseBones} bones) ---`);
    for (const row of r.rows) {
      hb(`  ${row.name}   (source rig travel ${row.srcTravel.toFixed(4)} body heights)`);
      hb('    strategy   bound tracks   travel    fidelity err   verdict');
      for (const [k, v] of Object.entries(row.variants)) {
        if (v.error) { hb(`    ${k.padEnd(10)} ERROR ${v.error}`); continue; }
        const inert = v.travel < row.srcTravel * 0.25;
        hb(`    ${k.padEnd(10)} ${v.bound.padStart(12)}   ${v.travel.toFixed(4)}    ` +
          `${v.fidelity.toFixed(4).padStart(9)}      ${inert ? 'INERT — clip barely moves' : 'live'}`);
        if (v.trackSample) hb(`               track names: ${v.trackSample.join(', ')}`);
      }
      hb('');
    }
  }
  app.exit(0);
}).catch(e => { hb(`REJ ${e && e.stack}`); app.exit(6); });
