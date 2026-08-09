/**
 * Which retargeting strategy deforms the mesh least? Measured, with a baseline that is actually bind pose.
 *
 *   cd app && X_PORT=<dev port> npx electron ../tools/retarget_bench.cjs
 *
 * ══ WHY A THIRD MEASUREMENT TOOL ═════════════════════════════════════════════════════════════
 *
 * The two earlier harnesses share a bug that makes their per-clip numbers untrustworthy, and it has to be
 * fixed before any strategy can be compared to any other.
 *
 *   `AnimationMixer.stopAllAction()` does NOT restore the skeleton to bind pose. It stops evaluating, and
 *   the bones keep whatever local transforms the last `setTime` left them in. Both `clip_audit.cjs` and the
 *   converter's own report measure a "bind" edge length at the top of each clip's pass -- so every clip
 *   after the first measured its baseline against the PREVIOUS clip's final pose. That is why the same clip
 *   came back as 3.470% in one tool and 5.157% in another: neither number was wrong arithmetic, both were
 *   measuring from a moved starting line.
 *
 * The fix here: cache every bone's rest local position/quaternion/scale once, and restore them explicitly
 * before each measurement. That is what `skeleton.pose()` would do from the inverse bind matrices -- but
 * `pose()` is not safe to use as a reset on files whose bind space is in question, and it destroyed a bind
 * reference earlier in this same investigation, so the rest transforms are captured directly instead.
 *
 * ══ WHAT IS COMPARED ═════════════════════════════════════════════════════════════════════════
 *
 * Every file in this pack ships its own rest skeleton -- measured, they differ by up to 6.8% of body height
 * -- so playing any clip on the base rig is a retarget. Four strategies, per clip:
 *
 *   own      the clip on the skeleton it shipped with. The asset's authored deformation: the number to beat,
 *            or at least to match. Not a target we can go below; it is the source material's own quality.
 *   raw      played directly on the base rig, tracks untouched.
 *   rebase   q_target = T * S_inv * q, applying the source's pose delta in the target's rest basis. This is
 *            the standard local-rotation rebase, and it replaces the conjugation form
 *            (T_inv * S * q * S_inv * T) used in the first attempt -- that one rebases a DELTA rotation,
 *            not an absolute local rotation, which is why it made several clips worse.
 *   library  three.js's own SkeletonUtils.retargetClip, from the same version the app ships. Solves it in
 *            world space and resamples, which is more robust than any local-space algebra, at the cost of a
 *            larger clip.
 *
 * The winner is whichever measures closest to `own` across the whole set. Reported per clip so a strategy
 * that wins on average while wrecking one clip is visible.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PACK_ABS = path.join(ROOT, '_refs', 'PRODUCT-X', 'V1-LOW-POLY-ANIMATIONS (Unzipped Files)', 'fbx');
const PORT = process.env['X_PORT'] || '5301';
const PACK_PORT = 5396;

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
const LOG = path.join(OUT, 'retarget-bench.log');
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
    if (level >= 2 && !/skinning weights|No target node|CORS policy|Multiple instances/.test(message)) hb(`  page: ${message}`);
  });
  await win.loadURL(`http://localhost:${PORT}/`);

  // No backticks below this line: injected inside a template literal.
  const PAGE = `
    (async (CFG) => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { FBXLoader } = await import('/node_modules/three/examples/jsm/loaders/FBXLoader.js');
      const SkeletonUtils = await import('/node_modules/three/examples/jsm/utils/SkeletonUtils.js');

      const load = (f) => new Promise((res, rej) =>
        new FBXLoader().load(CFG.pack + encodeURIComponent(f), res, undefined,
          e => rej(new Error('load ' + f + ': ' + (e && (e.message || e.type))))));
      const findMesh = (root) => { let m = null; root.traverse(o => { if (o.isSkinnedMesh && !m) m = o; }); return m; };

      /* ---- a deformation meter that resets to a REAL bind pose between measurements ---- */
      function meter(root) {
        const mesh = findMesh(root);
        const geo = mesh.geometry, pos = geo.attributes.position, idx = geo.index;
        const triN = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);

        const seen = new Set(), edges = [];
        for (let t = 0; t < triN; t++) {
          const a = idx ? idx.getX(t*3) : t*3, b = idx ? idx.getX(t*3+1) : t*3+1, c = idx ? idx.getX(t*3+2) : t*3+2;
          for (const pr of [[a,b],[b,c],[c,a]]) {
            const lo = Math.min(pr[0], pr[1]), hi = Math.max(pr[0], pr[1]), k = lo + '_' + hi;
            if (!seen.has(k)) { seen.add(k); edges.push([lo, hi]); }
          }
        }

        /* Rest local transforms, captured ONCE from the freshly loaded file. This is the reset that
           stopAllAction does not perform and that pose() cannot be trusted to perform. */
        const rest = mesh.skeleton.bones.map(b => ({
          bone: b, p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone(),
        }));
        const reset = () => {
          for (const r of rest) { r.bone.position.copy(r.p); r.bone.quaternion.copy(r.q); r.bone.scale.copy(r.s); }
          root.updateMatrixWorld(true);
        };

        const p = new THREE.Vector3(), q = new THREE.Vector3(), v = new THREE.Vector3();
        const skin = (i, into) => {
          into.fromBufferAttribute(pos, i);
          mesh.applyBoneTransform(i, into);
          return into.applyMatrix4(mesh.matrixWorld);
        };
        const lens = () => edges.map(e => skin(e[0], p).distanceTo(skin(e[1], q)));

        reset();
        const bind = lens();
        const box = new THREE.Box3();
        for (let i = 0; i < pos.count; i++) box.expandByPoint(skin(i, v));
        const height = box.getSize(new THREE.Vector3()).y || 1;

        /* Max per-edge growth over a clip, as a fraction of body height. Always from a reset skeleton. */
        function growth(clip) {
          reset();
          const mixer = new THREE.AnimationMixer(mesh);
          mixer.clipAction(clip).reset().play();
          const worst = bind.slice();
          for (let s = 0; s <= 12; s++) {
            mixer.setTime(clip.duration * (s / 12));
            root.updateMatrixWorld(true);
            const now = lens();
            for (let i = 0; i < now.length; i++) if (now[i] > worst[i]) worst[i] = now[i];
          }
          mixer.stopAllAction();
          mixer.uncacheClip(clip);
          reset();
          let maxG = 0, over = 0;
          for (let i = 0; i < bind.length; i++) {
            const g = (worst[i] - bind[i]) / height;
            if (g > maxG) maxG = g;
            if (bind[i] > 1e-9 && worst[i] / bind[i] > 1.5) over++;
          }
          return { max: maxG, over: over };
        }

        return { mesh: mesh, height: height, growth: growth, reset: reset, edges: edges.length, rest: rest };
      }

      /* ---- strategy: local-rotation rebase, q_target = T * S_inv * q ---- */
      function rebase(clip, srcRest, dstRest) {
        const out = clip.clone();
        const q = new THREE.Quaternion(), Sinv = new THREE.Quaternion();
        for (const track of out.tracks) {
          const parts = track.name.split('.');
          const src = srcRest.get(parts[0]), dst = dstRest.get(parts[0]);
          if (!src || !dst) continue;
          if (parts[1] === 'quaternion') {
            Sinv.copy(src.q).invert();
            const v = track.values;
            for (let i = 0; i < v.length; i += 4) {
              q.set(v[i], v[i+1], v[i+2], v[i+3]);
              q.premultiply(Sinv).premultiply(dst.q);   /* T * S_inv * q */
              v[i] = q.x; v[i+1] = q.y; v[i+2] = q.z; v[i+3] = q.w;
            }
          } else if (parts[1] === 'position') {
            const v = track.values;
            for (let i = 0; i < v.length; i += 3) {
              v[i]   = dst.p.x + (v[i]   - src.p.x);
              v[i+1] = dst.p.y + (v[i+1] - src.p.y);
              v[i+2] = dst.p.z + (v[i+2] - src.p.z);
            }
          }
        }
        return out;
      }

      const restMapOf = (root) => {
        const m = findMesh(root), map = new Map();
        for (const b of m.skeleton.bones) map.set(b.name, { q: b.quaternion.clone(), p: b.position.clone() });
        return map;
      };

      /* ---- base rig ---- */
      const baseRoot = await load(CFG.base);
      const baseMeter = meter(baseRoot);
      const baseRestMap = restMapOf(baseRoot);

      const rows = [];
      for (const entry of CFG.clips) {
        const name = entry[0], file = entry[1];
        let srcRoot;
        try { srcRoot = await load(file); } catch (e) { rows.push({ name: name, error: e.message }); continue; }
        const srcClip = srcRoot.animations[0];
        if (!srcClip) { rows.push({ name: name, error: 'no clip' }); continue; }

        const srcMeter = meter(srcRoot);
        const own = srcMeter.growth(srcClip);

        const raw = baseMeter.growth(srcClip.clone());
        const reb = baseMeter.growth(rebase(srcClip, restMapOf(srcRoot), baseRestMap));

        let lib = null, libTracks = null;
        try {
          const c = SkeletonUtils.retargetClip(baseMeter.mesh, srcMeter.mesh, srcClip, { fps: 30, useFirstFramePosition: false });
          libTracks = c.tracks.length;
          lib = baseMeter.growth(c);
        } catch (e) { lib = { error: (e && e.message) || 'retargetClip threw' }; }

        rows.push({
          name: name, file: file,
          own: own.max, raw: raw.max, rebase: reb.max,
          lib: lib && lib.max !== undefined ? lib.max : null,
          libError: lib && lib.error ? lib.error : null,
          libTracks: libTracks,
          ownOver: own.over, rawOver: raw.over, rebaseOver: reb.over,
          libOver: lib && lib.over !== undefined ? lib.over : null,
        });
      }
      return { rows: rows, baseEdges: baseMeter.edges };
    })(JSON.parse(CFG_JSON))
  `;

  hb('=== retargeting strategy benchmark ===');
  hb('Max per-edge stretch over each clip, as % of body height, from a properly reset bind pose.');
  hb('"own" is the clip on the skeleton it shipped with -- the asset\'s own authored quality, the reference.');
  hb('Lower is better, but matching "own" is the goal: going below it would mean losing motion.\n');

  const totals = {};
  for (const [rig, clips] of Object.entries(RIGS)) {
    const r = await win.webContents.executeJavaScript(
      `((CFG_JSON) => ${PAGE})(${JSON.stringify(JSON.stringify({
        base: clips[0][1], clips, pack: `http://127.0.0.1:${PACK_PORT}/`,
      }))})`,
    );

    hb(`--- ${rig} rig (base ${clips[0][1]}, ${r.baseEdges} edges) ---`);
    hb('clip              own      raw      rebase    library    best');
    for (const row of r.rows) {
      if (row.error) { hb(`${row.name.padEnd(12)} ERROR ${row.error}`); continue; }
      const pct = (x) => x === null ? '    -  ' : `${(x * 100).toFixed(2)}%`;
      const cands = [['raw', row.raw], ['rebase', row.rebase]];
      if (row.lib !== null) cands.push(['library', row.lib]);
      const best = cands.reduce((a, b) => (b[1] < a[1] ? b : a));
      hb(`${row.name.padEnd(12)} ${pct(row.own).padStart(8)} ${pct(row.raw).padStart(8)} ` +
        `${pct(row.rebase).padStart(9)} ${pct(row.lib).padStart(10)}    ${best[0]}` +
        (row.libError ? `   (library: ${row.libError})` : ''));
      for (const [k, v] of cands) { totals[k] = (totals[k] || 0) + v; }
      totals.own = (totals.own || 0) + row.own;
      totals.n = (totals.n || 0) + 1;
    }
    hb('');
  }

  hb('--- totals across every clip in both rigs ---');
  const n = totals.n || 1;
  for (const k of ['own', 'raw', 'rebase', 'library']) {
    if (totals[k] === undefined) continue;
    hb(`${k.padEnd(9)} mean max stretch ${((totals[k] / n) * 100).toFixed(3)}%`);
  }
  const ranked = ['raw', 'rebase', 'library'].filter(k => totals[k] !== undefined)
    .sort((a, b) => totals[a] - totals[b]);
  hb(`\nWINNER: ${ranked[0]} (mean ${((totals[ranked[0]] / n) * 100).toFixed(3)}% vs the assets' own ` +
    `${((totals.own / n) * 100).toFixed(3)}%)`);
  hb('The converter should use whichever strategy this names, and nothing else.');
  app.exit(0);
}).catch(e => { hb(`REJ ${e && e.stack}`); app.exit(6); });
