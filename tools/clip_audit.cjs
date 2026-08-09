/**
 * Per-clip: does the base rig deform worse than the clip's OWN rig, and is its rest skeleton different?
 *
 *   cd app && X_PORT=<dev port> npx electron ../tools/clip_audit.cjs
 *
 * WHY
 *
 * `fbx_vs_glb.cjs` found a clean split. For a clip that ships in the SAME file as the mesh, the converted
 * GLB deforms identically to the source -- 0.668% max edge growth against 0.668%, equal to three decimals.
 * For "hype", which comes from a generic `ani_*` file rather than the male/female one, the GLB is roughly
 * twice as bad as the source (7.1% vs 3.9%).
 *
 * That points at one thing: the pack's clips carry POSITION tracks per bone, not just rotations. A position
 * track is only meaningful against the rest skeleton it was authored on. Play it on a skeleton whose bones
 * sit at even slightly different rest offsets and joints are pulled off their sockets -- parent and child
 * separate, and the triangles spanning them stretch. Rotations transfer between skeletons of identical
 * topology; translations do not. That is why rotation-only retargeting is the standard practice.
 *
 * This audit measures the claim per clip instead of assuming it, and reports three things for each:
 *
 *   1. rest-skeleton delta -- how far this file's bone rest offsets sit from the base rig's, in units and
 *      as a fraction of the rig's own height. Zero means same rig; non-zero names a retarget.
 *   2. growth on its own rig -- the clip's authored, correct deformation.
 *   3. growth on the base rig -- what our GLB actually does.
 *
 * If (3) only exceeds (2) where (1) is non-zero, the diagnosis holds and the fix is to strip position
 * tracks from cross-rig clips. If (3) exceeds (2) on same-rig clips too, something else is wrong and the
 * fix would be a guess.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PACK_ABS = path.join(ROOT, '_refs', 'PRODUCT-X', 'V1-LOW-POLY-ANIMATIONS (Unzipped Files)', 'fbx');
const PORT = process.env['X_PORT'] || '5301';
const PACK_PORT = 5397;

const RIGS = {
  male: [
    ['idle1', 'male_idle1_200f.FBX'], ['idle2', 'male_idle2_220f.FBX'],
    ['walk', 'male_BasicWalk_30f.FBX'], ['walk_slow', 'male_slowWalk_40f.FBX'],
    ['jog', 'male_jogging_30f.FBX'], ['run', 'male_running_20f.FBX'],
    ['talk', 'male_phoneTalking_180f.FBX'], ['walk_busy', 'male_phoneWalking_40f.FBX'],
    ['celebrate', 'male_flossing_48f.FBX'], ['flourish', 'male_riverdance_60f.FBX'],
    ['hype', 'ani_hype_100f.FBX'], ['dance', 'ani_dance_afro_56f.fbx'],
  ],
  female: [
    ['idle1', 'female_idle1_150f.FBX'], ['idle2', 'female_idle2_190f.FBX'],
    ['walk', 'female_BasicWalk_30f.FBX'], ['walk_slow', 'female_slowWalk_40f.FBX'],
    ['jog', 'female_jogging_30f.FBX'], ['run', 'female_running_20f.FBX'],
    ['walk_busy', 'female_phoneWalking_40f.FBX'], ['celebrate', 'female_flossing_48f.FBX'],
    ['hype', 'ani_hype_100f.FBX'], ['dance', 'ani_dance_afro_56f.fbx'],
  ],
};

const OUT = path.join(ROOT, '_shots');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'clip-audit.log');
fs.writeFileSync(LOG, '');
const hb = (m) => { fs.appendFileSync(LOG, `${m}\n`); console.log(m); };

const { app, BrowserWindow } = require('electron');
process.on('uncaughtException', (e) => { hb(`EXC ${e && e.stack}`); app.exit(9); });

app.whenReady().then(async () => {
  const allowed = new Set([...Object.values(RIGS).flat().map(c => c[1]), 'peopleColors.png']);
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
    // FBXLoader's per-vertex weight notice and the unresolvable root tracks are expected and repeat per
    // file; anything else is worth seeing.
    if (level >= 2 && !/skinning weights|No target node found|CORS policy|Multiple instances/.test(message)) hb(`  page: ${message}`);
  });
  await win.loadURL(`http://localhost:${PORT}/`);

  // No backticks below: this string is injected inside a template literal.
  const PAGE = `
    (async (CFG) => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { FBXLoader } = await import('/node_modules/three/examples/jsm/loaders/FBXLoader.js');

      const load = (f) => new Promise((res, rej) =>
        new FBXLoader().load(CFG.pack + encodeURIComponent(f), res, undefined,
          e => rej(new Error('load ' + f + ': ' + (e && (e.message || e.type))))));

      function findMesh(root) { let m = null; root.traverse(o => { if (o.isSkinnedMesh && !m) m = o; }); return m; }

      /* Unique edges of a geometry, as sorted index pairs. */
      function edgesOf(geo) {
        const idx = geo.index, pos = geo.attributes.position;
        const n = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);
        const seen = new Set(), out = [];
        for (let t = 0; t < n; t++) {
          const a = idx ? idx.getX(t*3) : t*3, b = idx ? idx.getX(t*3+1) : t*3+1, c = idx ? idx.getX(t*3+2) : t*3+2;
          for (const pr of [[a,b],[b,c],[c,a]]) {
            const lo = Math.min(pr[0], pr[1]), hi = Math.max(pr[0], pr[1]), k = lo + '_' + hi;
            if (!seen.has(k)) { seen.add(k); out.push([lo, hi]); }
          }
        }
        return out;
      }

      /* Max per-edge growth over a clip, as a fraction of body height. Scale-free, so rigs of different
         authoring sizes compare directly. */
      function growth(root, mesh, clip) {
        const geo = mesh.geometry, pos = geo.attributes.position;
        const edges = edgesOf(geo);
        const p = new THREE.Vector3(), q = new THREE.Vector3(), v = new THREE.Vector3();
        const skin = (i, into) => {
          into.fromBufferAttribute(pos, i);
          mesh.applyBoneTransform(i, into);
          return into.applyMatrix4(mesh.matrixWorld);
        };
        const lens = () => edges.map(e => skin(e[0], p).distanceTo(skin(e[1], q)));

        root.updateMatrixWorld(true);
        const bind = lens();
        const box = new THREE.Box3();
        for (let i = 0; i < pos.count; i++) box.expandByPoint(skin(i, v));
        const height = box.getSize(new THREE.Vector3()).y || 1;

        const mixer = new THREE.AnimationMixer(mesh);
        mixer.clipAction(clip).reset().play();
        const worst = bind.slice();
        for (let s = 0; s <= 12; s++) {
          mixer.setTime(clip.duration * (s / 12));
          root.updateMatrixWorld(true);
          const now = lens();
          for (let i = 0; i < now.length; i++) if (now[i] > worst[i]) worst[i] = now[i];
        }
        let maxG = 0, over = 0;
        for (let i = 0; i < bind.length; i++) {
          const g = (worst[i] - bind[i]) / height;
          if (g > maxG) maxG = g;
          if (bind[i] > 1e-9 && worst[i] / bind[i] > 1.5) over++;
        }
        mixer.stopAllAction();
        return { maxGrowth: maxG, over1p5: over, height: height, edges: edges.length };
      }

      /* ---- base rig, loaded once ---- */
      const baseRoot = await load(CFG.base);
      const baseMesh = findMesh(baseRoot);
      const baseBones = baseMesh.skeleton.bones;
      const baseRest = new Map();
      for (const b of baseBones) baseRest.set(b.name, b.position.clone());
      const baseBox = new THREE.Box3().setFromObject(baseRoot);
      const baseHeight = baseBox.getSize(new THREE.Vector3()).length() || 1;

      const rows = [];
      for (const entry of CFG.clips) {
        const name = entry[0], file = entry[1];
        let root;
        try { root = await load(file); } catch (e) { rows.push({ name, file, error: e.message }); continue; }
        const mesh = findMesh(root);
        const clip = root.animations[0];
        if (!clip || !mesh) { rows.push({ name, file, error: 'missing clip or mesh' }); continue; }

        /* ---- 1. rest-skeleton delta vs the base rig ---- */
        let maxDelta = 0, deltaBone = '', missing = 0;
        for (const b of mesh.skeleton.bones) {
          const r = baseRest.get(b.name);
          if (!r) { missing++; continue; }
          const d = b.position.distanceTo(r);
          if (d > maxDelta) { maxDelta = d; deltaBone = b.name; }
        }

        /* ---- 2. the clip on its OWN rig (authored, correct) ---- */
        const own = growth(root, mesh, clip);

        /* ---- 3. the same clip on the BASE rig (what our GLB does) ----
           A fresh clone of the clip, because AnimationMixer caches bindings per clip object. */
        const onBase = growth(baseRoot, baseMesh, clip.clone());

        /* ---- 4. and rotation-only, to test the proposed fix before committing to it ---- */
        const rotOnly = clip.clone();
        rotOnly.tracks = rotOnly.tracks.filter(t => /\\.quaternion$/.test(t.name));
        const rotResult = rotOnly.tracks.length ? growth(baseRoot, baseMesh, rotOnly) : null;

        rows.push({
          name, file,
          restDelta: maxDelta, restDeltaFrac: maxDelta / baseHeight, deltaBone, missingBones: missing,
          ownGrowth: own.maxGrowth, ownOver: own.over1p5,
          baseGrowth: onBase.maxGrowth, baseOver: onBase.over1p5,
          rotGrowth: rotResult ? rotResult.maxGrowth : null,
          rotOver: rotResult ? rotResult.over1p5 : null,
          tracks: clip.tracks.length, rotTracks: rotOnly.tracks.length,
        });
      }
      return { rows, baseBones: baseBones.length };
    })(JSON.parse(CFG_JSON))
  `;

  hb('=== per-clip audit: rest-skeleton match, and deformation on own rig vs base rig ===');
  hb('Growth is max per-edge stretch over the clip, as a fraction of body height (scale-free).');
  hb('"own rig" is the clip played on the skeleton it shipped with -- its authored, correct deformation.');
  hb('"base rig" is the same clip on the companion\'s skeleton -- what our GLB does.');
  hb('"rot only" is the same, with position/scale tracks stripped: the proposed fix, measured not assumed.\n');

  const summary = {};
  for (const [rig, clips] of Object.entries(RIGS)) {
    const r = await win.webContents.executeJavaScript(
      `((CFG_JSON) => ${PAGE})(${JSON.stringify(JSON.stringify({
        base: clips[0][1], clips, pack: `http://127.0.0.1:${PACK_PORT}/`,
      }))})`,
    );

    hb(`--- ${rig} rig (base ${clips[0][1]}, ${r.baseBones} bones) ---`);
    hb('clip         rest delta   same rig?   own rig    base rig   rot only   tracks(rot)');
    for (const row of r.rows) {
      if (row.error) { hb(`${row.name.padEnd(12)} ERROR ${row.error}`); continue; }
      const pct = (x) => x === null ? '     -' : `${(x * 100).toFixed(3)}%`;
      const same = row.restDelta < 1e-4 && row.missingBones === 0;
      hb(`${row.name.padEnd(12)} ${row.restDeltaFrac === 0 ? '     0.000%' : `${(row.restDeltaFrac * 100).toFixed(3)}%`.padStart(11)}` +
        `   ${(same ? 'yes' : 'NO').padStart(9)}   ${pct(row.ownGrowth).padStart(7)}   ${pct(row.baseGrowth).padStart(8)}` +
        `   ${pct(row.rotGrowth).padStart(8)}   ${`${row.tracks}(${row.rotTracks})`.padStart(11)}`);
      summary[`${rig}/${row.name}`] = row;
    }
    hb('');
  }

  // Does the evidence actually support the diagnosis? Cross-rig clips should be the only ones that regress.
  const rows = Object.entries(summary);
  const sameRig = rows.filter(([, v]) => v.restDelta < 1e-4 && v.missingBones === 0);
  const crossRig = rows.filter(([, v]) => !(v.restDelta < 1e-4 && v.missingBones === 0));
  const regressed = (list) => list.filter(([, v]) => v.baseGrowth > v.ownGrowth * 1.25).map(([k]) => k);

  hb(`same-rig clips : ${sameRig.length}   regressed on base rig: ${regressed(sameRig).join(', ') || 'none'}`);
  hb(`cross-rig clips: ${crossRig.length}   regressed on base rig: ${regressed(crossRig).join(', ') || 'none'}`);

  const rotHelps = crossRig.filter(([, v]) => v.rotGrowth !== null && v.rotGrowth < v.baseGrowth * 0.9).map(([k]) => k);
  hb(`rotation-only improves: ${rotHelps.join(', ') || 'none'}`);

  hb(regressed(sameRig).length === 0
    ? '\nDIAGNOSIS HOLDS: only clips whose rest skeleton differs from the base rig deform worse on it. The\n' +
      '                 position tracks are the mechanism, and stripping them is the targeted fix.'
    : '\nDIAGNOSIS DOES NOT HOLD: same-rig clips regress too, so position-track retargeting is not the whole\n' +
      '                        story and stripping them would be a guess.');
  app.exit(0);
}).catch(e => { hb(`REJ ${e && e.stack}`); app.exit(6); });
