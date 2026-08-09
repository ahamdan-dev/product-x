/**
 * Does the companion actually render correctly on the GPU, animated? The whole-clip-vocabulary gate.
 *
 *   cd app && X_PORT=5301 npx electron ../tools/gpu_check.cjs [public/companions/companion-a.glb]
 *
 * Must be run from `app/` -- plain `node` fails with MODULE_NOT_FOUND: electron, and the injected script
 * imports three through the Vite dev server, which must be live on X_PORT (default 5301).
 *
 * ══ WHY IT EXISTS ════════════════════════════════════════════════════════════════════════════
 *
 * Every other CPU-side harness is arithmetic in Node, and the CPU and GPU skinning paths in three.js are
 * separate implementations of the same formula. `applyBoneTransform` (CPU) applies `bindMatrix` then
 * `bindMatrixInverse` around the bone product; the vertex shader does the same thing with `boneTexture`.
 * They agree in principle, but only one of them is what a user sees -- and the CPU harnesses during this
 * investigation produced two contradictory answers (11x vs 1000x, depending on one matrix multiply), plus
 * a `skeleton.pose()` call that silently corrupted the bind reference.
 *
 * So this asks the shipping renderer directly, in Electron, with a real WebGL context, over EVERY clip in
 * the companion's vocabulary -- which is what distinguishes it from `tools/hip_tear.cjs` (one clip, two
 * source formats, zoomed pictures) and `tools/picker_gate.cjs` (reproduces the app's own different gate).
 *
 * ══ COVERAGE: READ THIS BEFORE TRUSTING A NUMBER ═════════════════════════════════════════════
 *
 * This harness previously sampled triangles with `STEP = max(1, floor(triCount / 1500))` and reported the
 * result as if it were exhaustive. `hip_tear.cjs` was written partly on the suspicion that this stride was
 * how a local hip defect passed a 25% gate at 7.10%. That suspicion turned out to be WRONG, and the reason
 * is worth recording because it is easy to re-derive incorrectly:
 *
 *   companion-a has 1552 triangles and companion-b has 1622. floor(1552 / 1500) = 1. The stride evaluated
 *   to exactly 1 on both shipping assets, so triangle coverage was ALREADY complete and the 7.10% figure
 *   was never a sampled number.
 *
 * The stride was therefore latent, not active -- but a gate whose coverage silently depends on how many
 * triangles the asset happens to have is a gate that can start lying the moment someone ships a denser
 * mesh. At 3000 triangles the stride becomes 2 and half the mesh stops being measured, with no change to
 * the output to say so. That is the actual defect, and it is fixed two ways:
 *
 *   1. The default stride is 1 -- every triangle, every edge, no sampling. Overridable with X_STRIDE only
 *      for a deliberately coarse pass on a huge mesh.
 *   2. Coverage is printed as an explicit line stating triangles measured out of total, edges measured,
 *      and frames per clip, and the verdict names itself EXHAUSTIVE or SAMPLED. The output cannot be read
 *      as exhaustive when it was not.
 *
 * The real sampling weakness was never the stride: it was TIME. The original walked 7 fractions of each
 * clip where `hip_tear.cjs` walks 49 frames, and a defect that peaks between two samples is invisible.
 * Frames per clip now default to 25 and are logged with everything else. X_FRAMES overrides.
 *
 * ══ WHAT IT MEASURES ═════════════════════════════════════════════════════════════════════════
 *
 *   1. Render at bind pose, capture the framebuffer.
 *   2. Walk each clip, render, capture, and measure PER-EDGE stretch against each edge's OWN bind length.
 *   3. Photograph the frame that scored worst -- not clip 0 frame 0.5.
 *
 * Two earlier metrics were not good enough to convict or acquit, and both failures shaped this one:
 *
 *   * Painted silhouette growth cannot distinguish a dance clip throwing both arms out (2.59x on
 *     companion-b, capture shows a clean figure with one arm raised) from a shredded mesh (4.07x). It is
 *     reported below and never judged on.
 *   * Comparing the single longest edge in the frame to the single longest at bind is barely better: those
 *     can be different edges on different parts of the body, so the ratio drifts with pose. It flagged a
 *     sprint clip at 1.374x purely because a sharply bent knee is where linear-blend skinning legitimately
 *     stretches a triangle.
 *
 * Comparing each edge to itself removes that drift, and reporting the DISTRIBUTION rather than the maximum
 * separates the two causes for good: linear-blend skinning at a bent joint stretches a HANDFUL of edges by
 * tens of percent (the candy-wrapper artifact, in every game character ever shipped), whereas a space
 * mismatch between vertices and bind skeleton stretches THOUSANDS by multiples. So p99.9 plus a max.
 *
 * ══ NOTE ON THESE ASSETS ═════════════════════════════════════════════════════════════════════
 *
 * Both shipping GLBs are NON-INDEXED -- FBXLoader drops the index buffer and GLTFExporter writes what it
 * is given. The `idx ? ... : ...` branch below is not defensive padding; the else-branch is the one that
 * runs. Anything downstream that bails on a missing index (the app's own `worstEdge` used to) is inert on
 * these files, which is a real bug pattern already found once.
 *
 * The camera is framed on the bind-pose bounding sphere and never moves, so any change in the silhouette
 * is the mesh's doing and not the camera's.
 *
 * No backticks anywhere in the injected script, including in comments: it is passed to executeJavaScript
 * inside a template literal, so a backtick here closes that literal and the file fails to parse.
 */

const fs = require('fs');
const path = require('path');

const GLB = process.argv[2] || 'public/companions/companion-a.glb';
const OUT = path.join(__dirname, '..', '_shots');
fs.mkdirSync(OUT, { recursive: true });
const TAG = path.basename(GLB, '.glb');
const LOG = path.join(OUT, `gpu-${TAG}.log`);
fs.writeFileSync(LOG, '');
const hb = (m) => { fs.appendFileSync(LOG, `${m}\n`); console.log(m); };

/**
 * Triangle stride. 1 means every triangle -- the default, and the only value whose output is exhaustive.
 * Raise it ONLY for a deliberately coarse pass on a mesh far denser than these assets, and read the
 * coverage line in the output, which will say SAMPLED rather than EXHAUSTIVE.
 */
const STRIDE = Math.max(1, parseInt(process.env['X_STRIDE'] || '1', 10) || 1);

/** Frames sampled per clip. hip_tear.cjs uses 49 on one clip; 25 across a whole vocabulary is comparable. */
const FRAMES = Math.max(2, parseInt(process.env['X_FRAMES'] || '25', 10) || 25);

const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration = () => {};

process.on('uncaughtException', (e) => { hb(`EXC ${e && e.stack}`); app.exit(9); });

const PORT = process.env['X_PORT'] || '5301';

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 640, height: 640, show: false,
    backgroundColor: '#101014',
    webPreferences: { offscreen: false, backgroundThrottling: false },
  });

  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 && !/Multiple instances|Security Warning|unsafe-eval|electronjs\.org|once the app is packaged|consult|Content Security|^\s*$/.test(message)) {
      hb(`PAGE[${level}] ${message}`);
    }
  });

  // A blank page on the dev server, so bare module specifiers resolve through Vite.
  await win.loadURL(`http://localhost:${PORT}/`);
  hb('loaded dev server');

  const glbUrl = '/' + GLB.replace(/^public\//, '');
  const started = Date.now();

  const PAGE = `
    (async (CFG) => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');

      document.body.innerHTML = '';
      document.body.style.margin = '0';

      const W = 512, H = 512;
      const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true });
      renderer.setSize(W, H);
      renderer.setClearColor(0x000000, 1);
      document.body.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 3));

      const gltf = await new Promise((res, rej) => new GLTFLoader().load(CFG.url, res, undefined, rej));
      scene.add(gltf.scene);
      gltf.scene.updateMatrixWorld(true);

      let mesh = null;
      gltf.scene.traverse(o => { if (o.isSkinnedMesh && !mesh) mesh = o; });
      if (!mesh) return { error: 'no skinned mesh' };

      /* Flat white so the silhouette is what gets measured, not shading. */
      mesh.material = new THREE.MeshBasicMaterial({ color: 0xffffff });

      /* Frame the camera on the BIND pose and then leave it alone. */
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
      const d = sphere.radius / Math.sin((45 * Math.PI / 180) / 2) * 1.2;
      camera.position.set(sphere.center.x, sphere.center.y, sphere.center.z + d);
      camera.lookAt(sphere.center);
      camera.updateMatrixWorld(true);

      const gl = renderer.getContext();
      const px = new Uint8Array(W * H * 4);

      /** Painted bounding box + coverage, read back from the framebuffer. */
      function measure() {
        renderer.render(scene, camera);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let minX = W, minY = H, maxX = -1, maxY = -1, lit = 0;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            /* Any non-black pixel is the character; the clear colour is pure black. */
            if (px[(y * W + x) * 4] > 12) {
              lit++;
              if (x < minX) minX = x; if (x > maxX) maxX = x;
              if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
          }
        }
        return lit ? { w: maxX - minX + 1, h: maxY - minY + 1, cov: lit / (W * H) } : { w: 0, h: 0, cov: 0 };
      }

      const idx = mesh.geometry.index;
      const posAttr = mesh.geometry.attributes.position;
      const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(posAttr.count / 3);

      /*
       * Triangle corner indices, fixed once so bind and posed measure the SAME edges.
       *
       * CFG.stride is 1 by default, so this is every triangle in the mesh. It is kept as a parameter
       * rather than hardcoded so that a coarse pass on a much denser mesh is possible, but the value is
       * reported back and printed -- the previous version computed a stride from the triangle count and
       * said nothing, which is how a partial measurement could be mistaken for a complete one.
       */
      const tris = [];
      for (let t = 0; t < triCount; t += CFG.stride) {
        tris.push(idx
          ? [idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2)]
          : [t * 3, t * 3 + 1, t * 3 + 2]);
      }

      const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();

      /** Skinned length of every measured edge, in the order the triangles were listed. */
      function edgeLengths() {
        const outLen = [];
        for (const [a, b, c] of tris) {
          vA.fromBufferAttribute(posAttr, a); mesh.applyBoneTransform(a, vA); vA.applyMatrix4(mesh.matrixWorld);
          vB.fromBufferAttribute(posAttr, b); mesh.applyBoneTransform(b, vB); vB.applyMatrix4(mesh.matrixWorld);
          vC.fromBufferAttribute(posAttr, c); mesh.applyBoneTransform(c, vC); vC.applyMatrix4(mesh.matrixWorld);
          outLen.push(vA.distanceTo(vB), vB.distanceTo(vC), vC.distanceTo(vA));
        }
        return outLen;
      }

      /*
       * Rest local transforms plus an explicit reset.
       *
       * AnimationMixer.stopAllAction() stops evaluating but leaves every bone wherever the last setTime
       * put it, so without this each clip was measured against the PREVIOUS clip's final pose rather than
       * against bind. That inflated the numbers well past what two independently-fixed harnesses measure
       * on the same files, which is how it was caught. Rest is captured before any clip is bound.
       */
      const REST = mesh.skeleton.bones.map(b => ({
        bone: b, p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone(),
      }));
      const resetPose = () => {
        for (const r of REST) { r.bone.position.copy(r.p); r.bone.quaternion.copy(r.q); r.bone.scale.copy(r.s); }
        gltf.scene.updateMatrixWorld(true);
      };

      let BIND_EDGES = null;
      let BODY_HEIGHT = 1;

      /**
       * Edge stretch measured as ABSOLUTE growth relative to body height, not as a bare ratio.
       *
       * A ratio on a short edge is not evidence of anything visible. This mesh has 4 mm armpit edges at
       * bind; one reaching 17 mm is a 4.27x ratio and 0.7% of body height -- invisible. The known-broken
       * Blender export, at the same moment, grows an edge by 1.94 m, or 107% of body height, and looks
       * like a fan of shredded triangles. Both facts came from this harness; only the second is something
       * a user can see, and judging on the ratio flagged eleven clean clips as torn while the captures
       * showed intact human figures.
       *
       * So the reported quantity is growth / body height: scale-free, comparable across both rigs, and
       * directly comparable to the source assets' authored deformation. Ratios are printed alongside,
       * because they are what distinguishes a stretched edge from a merely long one.
       */
      function edgeStats() {
        const now = edgeLengths();
        const grow = [];
        const ratios = [];
        for (let i = 0; i < now.length; i++) {
          const b = BIND_EDGES[i];
          grow.push((now[i] - b) / BODY_HEIGHT);
          if (b > 1e-6) ratios.push(now[i] / b);
        }
        grow.sort((x, y) => x - y);
        ratios.sort((x, y) => x - y);
        const at = (arr, q) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))];
        return {
          growP999: at(grow, 0.999),
          growMax: grow[grow.length - 1],
          ratioMax: ratios.length ? ratios[ratios.length - 1] : 1,
          total: grow.length,
        };
      }

      /*
       * Bind pose is measured AS LOADED, with no skeleton.pose() call.
       *
       * pose() rebuilds each bone's local matrix from its boneInverse, which assumes the bone hierarchy
       * and the inverse bind matrices share a space. On the Blender-exported files this harness was
       * written to diagnose they did not, and pose() moved the skeleton somewhere that rendered nothing
       * at all -- a 0x0 painted box, which made every growth ratio a division by an empty frame. The
       * state the loader produces is also the honest reference regardless: it is exactly what the app
       * shows before a clip plays.
       */
      resetPose();
      const out = {
        clips: [], canvas: W,
        triCount: triCount, trisMeasured: tris.length, stride: CFG.stride,
        framesPerClip: CFG.frames, indexed: !!idx, vertexCount: posAttr.count,
      };
      out.bind = measure();
      BIND_EDGES = edgeLengths();
      out.measuredEdges = BIND_EDGES.length;
      out.bindPng = renderer.domElement.toDataURL('image/png');

      /* Body height from the SKINNED bind figure, so growth can be expressed as a fraction of it. */
      {
        const hbox = new THREE.Box3(), hv = new THREE.Vector3();
        for (let i = 0; i < posAttr.count; i++) {
          hv.fromBufferAttribute(posAttr, i);
          mesh.applyBoneTransform(i, hv);
          hv.applyMatrix4(mesh.matrixWorld);
          hbox.expandByPoint(hv);
        }
        BODY_HEIGHT = hbox.getSize(new THREE.Vector3()).y || 1;
        out.bodyHeight = BODY_HEIGHT;
      }

      const mixer = new THREE.AnimationMixer(mesh);
      let worstClip = null, worstArea = 0, worstT = 0;
      for (const clip of gltf.animations) {
        mixer.stopAllAction();
        mixer.uncacheClip(clip);
        resetPose();
        const act = mixer.clipAction(clip);
        act.reset().play();
        let worst = { w: 0, h: 0, cov: 0 };
        let stats = { growP999: 0, growMax: 0, ratioMax: 1, total: 0 };
        let atTime = 0;

        /*
         * Uniform dense walk across the clip, endpoints included. The previous version used seven
         * hand-picked fractions; a defect peaking between two of them was simply not measured.
         */
        for (let s = 0; s < CFG.frames; s++) {
          const t = clip.duration * (s / (CFG.frames - 1));
          mixer.setTime(t);
          gltf.scene.updateMatrixWorld(true);
          const m = measure();
          const st = edgeStats();
          if (st.growMax > stats.growMax) { stats = st; atTime = t; }
          if (m.w * m.h > worst.w * worst.h) worst = m;
          if (m.w * m.h > worstArea) { worstArea = m.w * m.h; worstClip = clip; worstT = t; }
        }
        out.clips.push({ name: clip.name, w: worst.w, h: worst.h, cov: worst.cov, stats: stats, atTime: atTime });
      }

      /*
       * Photograph the frame that scored WORST, not clip 0 frame 0.5.
       *
       * The number is a proxy; the picture is the actual acceptance test, so the picture has to be of the
       * frame the number is complaining about. Capturing a calm idle pose while the report flags a dance
       * clip would look like evidence without being any.
       */
      mixer.stopAllAction();
      if (worstClip) {
        resetPose();
        mixer.clipAction(worstClip).reset().play();
        mixer.setTime(worstT);
        gltf.scene.updateMatrixWorld(true);
      }
      renderer.render(scene, camera);
      out.png = renderer.domElement.toDataURL('image/png');
      out.worstClip = worstClip ? worstClip.name : null;

      return out;
    })(JSON.parse(CFG_JSON))
  `;

  const result = await win.webContents.executeJavaScript(
    `((CFG_JSON) => ${PAGE})(${JSON.stringify(JSON.stringify({
      url: glbUrl, stride: STRIDE, frames: FRAMES,
    }))})`,
  );

  if (result.error) { hb(`ERR ${result.error}`); app.exit(5); return; }

  /**
   * The gate: no edge may grow by more than 25% of body height.
   *
   * Every quantity this harness tried first was a worse discriminator, and each failure narrowed it:
   *
   *   * Painted silhouette growth cannot tell a dance clip throwing both arms out (2.59x, capture shows a
   *     clean figure) from a shredded mesh (4.07x). Reported below, never judged on.
   *   * A bare edge-length RATIO cannot either. This mesh has 4 mm armpit edges; one reaching 17 mm is
   *     4.27x and 0.7% of body height -- invisible. Judging on ratios flagged eleven clips as torn whose
   *     captures were intact human figures, a false-positive rate that would make the gate useless.
   *
   * Growth as a fraction of BODY HEIGHT is what a viewer perceives, and the two populations are three
   * orders of magnitude apart on it: these files top out under 10%, the same clips on the skeletons they
   * shipped with run 2%-6.5%, and the broken Blender export grows an edge by 107% of body height. 25% sits
   * in the empty gap between them -- roughly 2.5x above anything the pack itself produces, and 4x below
   * the defect. Calibrated against a known-bad file in the same run, not chosen to make a build pass.
   */
  const GROW_MAX = 0.25;

  const exhaustive = result.stride === 1;
  const pctTris = (result.trisMeasured / Math.max(1, result.triCount)) * 100;

  hb(`\n=== GPU render check: ${GLB} ===`);
  hb(`canvas ${result.canvas}x${result.canvas}   body height ${result.bodyHeight.toFixed(3)} m   ` +
    `index ${result.indexed ? 'present' : 'ABSENT (non-indexed)'}`);
  hb(`COVERAGE: ${exhaustive ? 'EXHAUSTIVE' : 'SAMPLED'} -- ` +
    `${result.trisMeasured}/${result.triCount} triangles (${pctTris.toFixed(1)}%, stride ${result.stride}), ` +
    `${result.measuredEdges} edges, ${result.framesPerClip} frames per clip, ${result.clips.length} clips`);
  if (!exhaustive) {
    hb(`  WARNING: stride ${result.stride} means ${(100 - pctTris).toFixed(1)}% of triangles were NOT measured.`);
    hb('  A local defect can hide in the gap. Re-run without X_STRIDE before trusting a PASS.');
  }
  hb(`BIND   painted ${result.bind.w}x${result.bind.h} px   coverage ${(result.bind.cov * 100).toFixed(2)}%`);
  hb('\nclip          painted px    silhouette   edge growth (% of body height)   worst ratio   at t     verdict');
  hb('                                            p99.9        max');
  const bindArea = Math.max(1, result.bind.w * result.bind.h);
  let worstGrow = 0, worstSil = 0, torn = 0, worstGrowClip = '';
  for (const c of result.clips) {
    const growth = (c.w * c.h) / bindArea;
    const s = c.stats;
    const bad = s.growMax >= GROW_MAX;
    if (bad) torn++;
    if (growth > worstSil) worstSil = growth;
    if (s.growMax > worstGrow) { worstGrow = s.growMax; worstGrowClip = c.name; }
    hb(`${c.name.padEnd(13)} ${`${c.w}x${c.h}`.padEnd(13)} ${`${growth.toFixed(2)}x`.padStart(9)}   ` +
      `${(s.growP999 * 100).toFixed(2)}%`.padStart(12) + `${(s.growMax * 100).toFixed(2)}%`.padStart(12) +
      `${s.ratioMax.toFixed(1)}x`.padStart(14) + `${c.atTime.toFixed(2)}s`.padStart(8) +
      '   ' + (bad ? 'TORN' : 'CLEAN'));
  }
  hb(`\nworst edge growth      : ${(worstGrow * 100).toFixed(2)}% of body height on "${worstGrowClip}"   ` +
    `(gate < ${GROW_MAX * 100}%)`);
  hb(`worst silhouette growth: ${worstSil.toFixed(2)}x   (reported, not judged -- limb spread does this too)`);
  hb(`headroom under the gate: ${((GROW_MAX - worstGrow) * 100).toFixed(2)} percentage points`);
  hb(torn === 0
    ? `VERDICT: skins correctly on the GPU. No edge moves a visible fraction of the body in any clip.\n` +
      `         This verdict is ${exhaustive ? 'EXHAUSTIVE over every triangle' : 'SAMPLED and could miss a local defect'}.`
    : `VERDICT: ${torn} clip(s) torn -- vertices and bind skeleton disagree about their space.`);
  if (result.worstClip) hb(`capture is "${result.worstClip}" at its widest frame (the worst case, not an idle pose)`);
  hb(`wall clock ${((Date.now() - started) / 1000).toFixed(1)}s`);

  for (const [key, suffix] of [['bindPng', 'bind'], ['png', 'anim']]) {
    if (!result[key]) continue;
    const f = path.join(OUT, `gpu-${TAG}-${suffix}.png`);
    fs.writeFileSync(f, Buffer.from(result[key].split(',')[1], 'base64'));
    hb(`wrote ${f}`);
  }
  app.exit(0);
}).catch(e => { hb(`REJ ${e && e.stack}`); app.exit(6); });
