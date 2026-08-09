/**
 * Does the APP's own tear gate open on the repaired GLBs? Measured through the picker's code path.
 *
 *   cd app && X_PORT=<dev port> npx electron ../tools/picker_gate.cjs
 *
 * WHY THIS IS A SEPARATE CHECK FROM gpu_check.cjs
 *
 * The GPU harness judges on edge GROWTH as a fraction of body height, and it passes both companions
 * at ~7%. The shipping app does not use that quantity. `assessRigIntegrity` judges on the ABSOLUTE
 * longest posed edge against 0.18 x subject height -- a different measurement with a different
 * threshold, evaluated on a different sample (every 15th index, 4 sample times, from the idle clip
 * only). Passing one says nothing rigorous about the other, so assuming the picker follows the
 * harness would be exactly the kind of unverified claim the contract forbids.
 *
 * This reproduces `prepareRig`'s pipeline verbatim -- the +90 degrees about X wrapper, the
 * skinning-aware bind box, `worstEdge` with the same stride and sample count, the same rest-snapshot
 * restore, and the same idle-clip choice -- and reports what `animatable` will actually be, plus how
 * much headroom is left under the threshold. Run before and after any converter change.
 *
 * No backticks in the injected script below, including in comments: it is passed to executeJavaScript
 * inside a template literal, so a backtick here closes that literal and the file fails to parse.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env['X_PORT'] || '5301';
const OUT = path.join(ROOT, '_shots');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'picker-gate.log');
fs.writeFileSync(LOG, '');
const hb = (m) => { fs.appendFileSync(LOG, `${m}\n`); console.log(m); };

/** Must match src/companion/glbSource.ts and src/companion/Picker.tsx. */
const TEAR_THRESHOLD_RATIO = 0.18;
const TARGET_HEIGHT = 1.75;
const IDLE_PREFERENCE = ['idle1', 'idle', 'idle2', 'talk', 'walk_slow'];

const FILES = process.argv.slice(2);
const TARGETS = FILES.length ? FILES : ['companions/companion-a.glb', 'companions/companion-b.glb'];

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
      const source = gltf.scene;
      const clips = gltf.animations || [];

      /* --- prepareRig: measure as authored, rotate only if lying down, then re-measure --- */
      const upright = new THREE.Group();
      upright.add(source);
      upright.updateMatrixWorld(true);
      const authored = new THREE.Box3().setFromObject(upright);
      /* needsZUpToYUp: Z extent greater than Y extent means the figure is long along Z, i.e. lying down. */
      const rotated = (authored.max.z - authored.min.z) > (authored.max.y - authored.min.y);
      if (rotated) { upright.rotation.x = Math.PI / 2; upright.updateMatrixWorld(true); }
      const box = new THREE.Box3().setFromObject(upright);
      const measuredHeight = box.max.y - box.min.y;
      const measuredWidth = box.max.x - box.min.x;

      /* --- worstEdge, identical stride and sample count to Picker.tsx --- */
      function worstEdge(root, clip) {
        const mixer = clip ? new THREE.AnimationMixer(root) : null;
        if (mixer && clip) mixer.clipAction(clip).reset().play();
        const samples = clip ? 4 : 1;
        const a = new THREE.Vector3(), b = new THREE.Vector3();
        let worst = 0;
        for (let s = 0; s < samples; s++) {
          if (mixer && clip) mixer.setTime((clip.duration * s) / samples);
          root.updateMatrixWorld(true);
          root.traverse(o => {
            const sm = o;
            if (!sm.isSkinnedMesh) return;
            sm.skeleton.update();
            const pos = sm.geometry.getAttribute('position');
            const index = sm.geometry.index;
            if (!pos) return;
            /* Non-indexed geometry included: these files have no index buffer, and requiring one is
               what made the app gate read 0.0000 m for every clip on every rig. */
            const corners = index ? index.count : pos.count;
            const at = index ? (i) => index.getX(i) : (i) => i;
            for (let i = 0; i + 1 < corners; i += 15) {
              const ia = at(i), ib = at(i + 1);
              a.fromBufferAttribute(pos, ia); sm.applyBoneTransform(ia, a); sm.localToWorld(a);
              b.fromBufferAttribute(pos, ib); sm.applyBoneTransform(ib, b); sm.localToWorld(b);
              worst = Math.max(worst, a.distanceTo(b));
            }
          });
        }
        if (mixer && clip) { mixer.stopAllAction(); mixer.uncacheClip(clip); mixer.uncacheRoot(root); }
        return worst;
      }

      const restEdge = worstEdge(source, null);

      /* Rest snapshot + restore, as the picker does it. */
      const bones = [];
      source.traverse(o => { if (o.isBone) bones.push(o); });
      const rest = bones.map(b => ({ p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() }));
      const restore = () => {
        bones.forEach((b, i) => { b.position.copy(rest[i].p); b.quaternion.copy(rest[i].q); b.scale.copy(rest[i].s); });
        upright.updateMatrixWorld(true);
        source.traverse(o => { if (o.isSkinnedMesh) o.skeleton.update(); });
      };

      let mesh = null;
      source.traverse(o => { if (o.isSkinnedMesh && !mesh) mesh = o; });

      const names = clips.map(c => c.name);
      const idleName = CFG.idlePref.find(n => names.includes(n)) || names[0] || null;
      const probeClip = clips.find(c => c.name === idleName) || clips[0];

      const idleEdge = probeClip ? worstEdge(source, probeClip) : 0;
      restore();

      /*
       * The picker only probes the IDLE clip, so idle alone decides animatable. But a clip that tears
       * would tear on screen whether or not the gate sampled it, so EVERY clip is measured here too --
       * a gate that opens on idle while celebrate shreds would be a false pass.
       */
      const perClip = [];
      for (const c of clips) {
        const e = worstEdge(source, c);
        restore();
        perClip.push({ name: c.name, edge: e });
      }

      return {
        measuredHeight: measuredHeight, measuredWidth: measuredWidth,
        restEdge: restEdge, idleClip: idleName, idleEdge: idleEdge,
        perClip: perClip, clipCount: clips.length, boneCount: bones.length,
        rotated: rotated, indexed: !!(mesh && mesh.geometry.index),
      };
    })(JSON.parse(CFG_JSON))
  `;

  hb('=== does the shipping app\'s own tear gate open? ===');
  hb(`gate: assessRigIntegrity fails when maxPosedEdge > ${TEAR_THRESHOLD_RATIO} x subject height`);
  hb('The picker probes the IDLE clip only; every clip is measured here as well, because a clip that');
  hb('tears on screen is a defect whether or not the gate happened to sample it.\n');

  let allPass = true;
  for (const rel of TARGETS) {
    const url = '/' + rel.replace(/^public\//, '').replace(/^\/+/, '');
    const r = await win.webContents.executeJavaScript(
      `((CFG_JSON) => ${PAGE})(${JSON.stringify(JSON.stringify({ url, idlePref: IDLE_PREFERENCE }))})`,
    );

    const limit = r.measuredHeight * TEAR_THRESHOLD_RATIO;
    const animatable = r.idleEdge <= limit && r.clipCount > 0;

    hb(`--- ${rel} ---`);
    hb(`  index buffer        : ${r.indexed ? 'present' : 'ABSENT (measured non-indexed, as the app now does)'}`);
    hb(`  stood up by picker? : ${r.rotated ? 'yes — authored lying down' : 'no — already upright'}`);
    hb(`  bind box            : ${r.measuredHeight.toFixed(3)} m tall x ${r.measuredWidth.toFixed(3)} m wide` +
      `   (${r.boneCount} bones, ${r.clipCount} clips)`);
    hb(`  threshold           : ${limit.toFixed(4)} m`);
    hb(`  longest edge at rest: ${r.restEdge.toFixed(4)} m`);
    hb(`  idle clip probed    : ${r.idleClip}   longest posed edge ${r.idleEdge.toFixed(4)} m` +
      `   (${((r.idleEdge / limit) * 100).toFixed(1)}% of threshold)`);
    hb('  every clip:');
    let worstName = null, worstEdgeAll = 0;
    for (const c of r.perClip) {
      const pctOfLimit = (c.edge / limit) * 100;
      if (c.edge > worstEdgeAll) { worstEdgeAll = c.edge; worstName = c.name; }
      hb(`    ${c.name.padEnd(12)} ${c.edge.toFixed(4)} m   ${pctOfLimit.toFixed(1)}% of threshold   ` +
        (c.edge > limit ? 'OVER' : 'ok'));
    }
    const anyOver = r.perClip.filter(c => c.edge > limit);
    hb(`  worst of all clips  : ${worstName} at ${worstEdgeAll.toFixed(4)} m ` +
      `(${((worstEdgeAll / limit) * 100).toFixed(1)}% of threshold)`);
    hb(`  animatable          : ${animatable ? 'TRUE — clips play, no "still pose" note' : 'FALSE — frozen at bind pose'}`);
    if (anyOver.length) hb(`  WARNING: ${anyOver.length} clip(s) exceed the threshold even though the gate opened on idle`);
    if (!animatable || anyOver.length) allPass = false;
    hb('');

    /* TARGET_HEIGHT is referenced so a drift between this harness and the app is visible, not silent. */
    if (Math.abs(r.measuredHeight - TARGET_HEIGHT) > 0.02) {
      hb(`  note: bind height ${r.measuredHeight.toFixed(3)} m differs from the app's TARGET_HEIGHT ` +
        `${TARGET_HEIGHT} m. The picker normalises to TARGET after this measurement, so the gate is ` +
        `evaluated in pre-normalisation metres -- which is correct, but worth seeing.`);
      hb('');
    }
  }

  hb(allPass
    ? 'RESULT: every companion animates in the app with no code change, and no clip exceeds the gate.'
    : 'RESULT: at least one companion is still frozen or has a clip over the gate. Do not remove the note.');
  app.exit(allPass ? 0 : 1);
}).catch(e => { hb(`REJ ${e && e.stack}`); app.exit(6); });
