/**
 * Convert the CC-BY animation pack into the two stock companions -- through three.js, in Electron.
 *
 *   cd app && X_PORT=<dev server port> npx electron ../tools/fbx_to_glb.cjs
 *
 * ══ WHY THIS REPLACES THE BLENDER PATH ═══════════════════════════════════════════════════════
 *
 * `tools/rig_to_glb.py` produced GLBs that render as a shredded fan of stretched triangles the moment any
 * clip plays. That is not a suspicion: it was captured on the GPU in Electron, in this repo, at
 * `_shots/gpu-companion-a.png`, and every one of the 12 clips tore.
 *
 * The defect, as measured rather than guessed:
 *
 *   Skinning computes `v_world = sum_i w_i * (bone_i.matrixWorld * inverseBindMatrix_i) * v`, so the
 *   vertex data must live in the same space as the bind skeleton. In the Blender-exported files it does
 *   not -- the exported bind skeleton stands 1.38 m up the Y axis while the exported vertices lie 1.76 m
 *   along Z, and vertices sit a mean of 1.64 m away from the bones that drive them. At bind pose every
 *   `bone.matrixWorld * inverseBindMatrix` is the identity, so the mesh renders at its raw coordinates
 *   and holds its shape -- which is exactly why the Blender-side height check, the GLB header parse and
 *   `verify.log` all passed. The first keyframe makes those products non-identity, each vertex is swung
 *   about a pivot a metre and a half away, and the mesh explodes.
 *
 * Hypotheses tested against that pipeline and falsified, so they are not retried here: exporter sampling
 * and baking flags; FBX import orientation flags; the scale-0.01 `rig_CharRoot` ancestor; `export_yup` in
 * both states (all three variants tore at exactly 11.0x, so orientation is not the cause); baking the
 * mesh object's transform into its vertex data in world space and in armature space; applying the mesh's
 * rotation alone; and flattening both halves to world space (which made it worse -- 1530x -- by baking a
 * 100x skeleton against metre-scale vertices).
 *
 * The asymmetry that decides the approach: the SOURCE FBX skins **cleanly** in this exact three.js
 * version -- longest-edge ratio 0.993 against bind, measured. The assets were never the problem. So this
 * converter uses the runtime as the converter: FBXLoader in, GLTFExporter out, both from the same three.js
 * the app ships. Nothing translates the skin binding between two tools' idea of what a rest pose is,
 * because only one tool is involved.
 *
 * ══ WHAT IT DOES ═════════════════════════════════════════════════════════════════════════════
 *
 * The pack ships 20 FBX files, each carrying its own copy of the same skinned mesh plus one clip. Loading
 * that into a browser would mean 20 redundant meshes and 20 skeletons. So: load the base clip's file for
 * the mesh and skeleton, then load each remaining file only to take its AnimationClip, and discard the
 * duplicate geometry. Bone names are identical across the pack, and `AnimationMixer` resolves tracks by
 * node name, so a clip from one file drives the base skeleton with no retargeting step to get wrong.
 *
 * Normalisation is applied as a uniform scale plus translation on a WRAPPER GROUP above the rig, never by
 * rewriting vertices or bind matrices. That is provably safe, and the proof is why it is done this way: a
 * parent transform P multiplies both `bone.matrixWorld` and the mesh's `bindMatrixInverse`, and the
 * rendered position works out to `P * sum(w * D_i * v)` with every `D_i` unchanged. The skin binding is
 * therefore untouched by construction -- which is the one property this whole exercise showed is easy to
 * break silently.
 *
 * Attribution is not optional: "Free Animation Pack - City People Commons" by Denys Almaral, CC BY 4.0.
 * The notice is written into the GLB's asset extras and into the manifest so the UI can render it.
 *
 * ══ SALVAGED FROM THE RETIRED BLENDER PIPELINE ═══════════════════════════════════════════════
 *
 * `tools/rig_to_glb.py` and `tools/verify_glb.py` were deleted once this tool was proven. Two findings in
 * them were paid for with real debugging time and are NOT reproducible from this file's own code, so they
 * are recorded here rather than lost with it:
 *
 *   1. WHY NORMALISATION MUST GO ON A NODE NOTHING ANIMATES. The pack's hierarchy is `rig_CharRoot` (an
 *      empty at scale 0.01) -> `bip` (armature) -> mesh. The clips animate the ARMATURE's object-level
 *      location (root motion, 3 `location` fcurves per action), AND each source FBX ships a second action
 *      bound to `rig_CharRoot` itself -- so BOTH of those nodes' transforms are owned by animation and any
 *      correction written to them is overwritten the moment a clip plays. That is exactly why an earlier
 *      attempt reported a converged 1.7500 and then exported a GLB still measuring 1.8099. The wrapper
 *      group this tool inserts above the rig is the same defence, arrived at independently: a fresh node
 *      nothing keys.
 *
 *   2. WHY A GLB HEADER PARSE CANNOT VERIFY HEIGHT. For a skinned mesh the glTF spec says the mesh node's
 *      own transform MUST be ignored -- vertices are placed by the joint matrices. So POSITION accessor
 *      min/max walked through the node hierarchy is not render space and cannot be compared against a
 *      target height. Measuring it that way once reported a 3 mm tall character. `tools/verify_glb.cjs`
 *      still parses the container and is useful for structure (clip names, joint counts, embedded
 *      texture), but its height/ground-line numbers carry this caveat; the skinning-aware measurement in
 *      this file and in `tools/gpu_check.cjs` is the one that reflects what a renderer draws.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PACK_ABS = path.join(ROOT, '_refs', 'PRODUCT-X', 'V1-LOW-POLY-ANIMATIONS (Unzipped Files)', 'fbx');
const OUT_DIR = path.join(ROOT, 'app', 'public', 'companions');
const PORT = process.env['X_PORT'] || '5301';

/**
 * The pack is served by a throwaway static server this script owns, not by a mount in the app's Vite
 * config. `_refs/` is design input that is gitignored and never ships, so teaching the product's dev
 * server to serve it would put a build-time-only path into a runtime config -- and would make this
 * converter silently depend on an edit somewhere else. A local server keeps the dependency here, where it
 * can be read, and it means the pack does not have to be reachable from the app at all.
 */
const PACK_PORT = 5399;
const PACK_REL = `http://127.0.0.1:${PACK_PORT}/`;

/** Target height in metres. The exact number matters less than both rigs sharing it: the camera rig and
 *  every anchor offset are expressed relative to it. */
const TARGET_HEIGHT = 1.75;

const RIGS = {
  'companion-a': {
    label: 'Ash', rig: 'male',
    clips: [
      ['idle1', 'male_idle1_200f.FBX'], ['idle2', 'male_idle2_220f.FBX'],
      ['walk', 'male_BasicWalk_30f.FBX'], ['walk_slow', 'male_slowWalk_40f.FBX'],
      ['jog', 'male_jogging_30f.FBX'], ['run', 'male_running_20f.FBX'],
      ['talk', 'male_phoneTalking_180f.FBX'], ['walk_busy', 'male_phoneWalking_40f.FBX'],
      ['celebrate', 'male_flossing_48f.FBX'], ['flourish', 'male_riverdance_60f.FBX'],
      ['hype', 'ani_hype_100f.FBX'], ['dance', 'ani_dance_afro_56f.fbx'],
    ],
  },
  'companion-b': {
    label: 'Wren', rig: 'female',
    clips: [
      ['idle1', 'female_idle1_150f.FBX'], ['idle2', 'female_idle2_190f.FBX'],
      ['walk', 'female_BasicWalk_30f.FBX'], ['walk_slow', 'female_slowWalk_40f.FBX'],
      ['jog', 'female_jogging_30f.FBX'], ['run', 'female_running_20f.FBX'],
      ['walk_busy', 'female_phoneWalking_40f.FBX'], ['celebrate', 'female_flossing_48f.FBX'],
      ['hype', 'ani_hype_100f.FBX'], ['dance', 'ani_dance_afro_56f.fbx'],
    ],
  },
};

const LICENSE = {
  pack: 'Free Animation Pack - City People Commons',
  author: 'Denys Almaral',
  license: 'CC BY 4.0',
  requires_attribution: true,
  source: 'https://denysalmaral.com/2019/07/free-animation-pack-city-people-common-moves-wip.html',
  notice: 'Character animations by Denys Almaral, licensed CC BY 4.0.',
};

const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration = () => {};

fs.mkdirSync(OUT_DIR, { recursive: true });
const LOG = path.join(OUT_DIR, 'convert.log');
fs.writeFileSync(LOG, '');
const log = (m) => { fs.appendFileSync(LOG, `${m}\n`); console.log(m); };

process.on('uncaughtException', (e) => { log(`EXC ${e && e.stack}`); app.exit(9); });

app.whenReady().then(async () => {
  // Every file the converter needs must be missing-checked before Electron starts drawing, so a typo in
  // the pack listing fails loudly here rather than producing a GLB with silently fewer clips.
  const missing = [];
  for (const [key, spec] of Object.entries(RIGS)) {
    for (const [name, file] of spec.clips) {
      if (!fs.existsSync(path.join(PACK_ABS, file))) missing.push(`${key}/${name}: ${file}`);
    }
  }
  if (missing.length) { log(`MISSING SOURCE FILES:\n  ${missing.join('\n  ')}`); app.exit(4); return; }

  /**
   * Serve the FBX pack over HTTP.
   *
   * FBXLoader goes through `fetch`, and a `file://` page cannot fetch sibling files under Chromium's
   * origin rules -- which is why this runs against a server rather than loading the pack off disk. Only
   * basenames from the RIGS listing are honoured, so a path cannot escape the pack directory.
   *
   * TEXTURES must be allowlisted alongside the FBX files. The pack's single shared atlas
   * `peopleColors.png` is referenced from inside every FBX, so FBXLoader requests it without this script
   * ever naming it. Leaving it out is not a cosmetic loss: the fetch 404s, the image never decodes, and
   * `GLTFExporter` aborts the whole export with "No valid image data found" rather than shipping an
   * untextured GLB. Served with a real image content-type, because a decoded `<img>` is what the exporter
   * needs to read pixels out of.
   */
  const TEXTURES = ['peopleColors.png'];
  const allowed = new Set([
    ...Object.values(RIGS).flatMap(s => s.clips.map(([, f]) => f)),
    ...TEXTURES,
  ]);
  const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
  const packServer = require('node:http').createServer((req, res) => {
    const name = decodeURIComponent(req.url.replace(/^\//, '').split('?')[0]);
    if (!allowed.has(name)) { res.writeHead(404).end('not in pack'); return; }
    const file = path.join(PACK_ABS, name);
    res.writeHead(200, {
      'content-type': MIME[path.extname(name).toLowerCase()] || 'application/octet-stream',
      'access-control-allow-origin': '*',
    });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((res, rej) => {
    packServer.once('error', rej);
    packServer.listen(PACK_PORT, '127.0.0.1', res);
  });
  log(`pack server on ${PACK_PORT} (${allowed.size} files)`);

  const win = new BrowserWindow({
    width: 400, height: 300, show: false,
    webPreferences: { offscreen: false, backgroundThrottling: false },
  });
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 1) log(`  page: ${message}`);
  });

  await win.loadURL(`http://localhost:${PORT}/`);
  log(`dev server ${PORT} loaded`);

  for (const [key, spec] of Object.entries(RIGS)) {
    log(`\n=== ${key} (${spec.label} / ${spec.rig}) ===`);

    /**
     * The page script is a plain string with ONE interpolation, at the end, supplying its arguments as
     * JSON. Interpolating config into the middle of it is what broke the first version of this file: the
     * script contains template literals of its own, and `${...}` inside those is parsed by the OUTER
     * template first, which is a syntax error that only surfaces at require time.
     */
    const PAGE = `
      (async (CFG) => {
        const THREE = await import('/node_modules/three/build/three.module.js');
        const { FBXLoader } = await import('/node_modules/three/examples/jsm/loaders/FBXLoader.js');
        const { GLTFExporter } = await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js');

        const CLIPS = CFG.clips, PACK = CFG.pack, TARGET = CFG.target;
        const notes = [];

        // FBXLoader resolves relative paths against the page, so the pack origin is absolute here.
        const load = (file) => new Promise((res, rej) =>
          new FBXLoader().load(PACK + encodeURIComponent(file), res, undefined,
            (e) => rej(new Error('load ' + file + ': ' + (e && (e.message || e.type))))));

        const findMesh = (root) => {
          let m = null;
          root.traverse(o => { if (o.isSkinnedMesh && !m) m = o; });
          return m;
        };

        // ---- base file: the mesh, the skeleton, and the first clip ----------------------------
        const [baseName, baseFile] = CLIPS[0];
        const base = await load(baseFile);

        let mesh = null;
        base.traverse(o => { if (o.isSkinnedMesh && !mesh) mesh = o; });
        if (!mesh) return { error: 'no skinned mesh in ' + baseFile };

        const clips = [];
        if (base.animations[0]) { base.animations[0].name = baseName; clips.push(base.animations[0]); }
        else notes.push('base file carried no animation: ' + baseFile);

        const boneNames = new Set(mesh.skeleton.bones.map(b => b.name));

        /**
         * Convert the FBX's Phong materials to MeshStandardMaterial.
         *
         * FBXLoader produces MeshPhongMaterial, which glTF has no equivalent for -- GLTFExporter
         * approximates it and says so. Converting here means the roughness/metalness the GLB carries is
         * chosen deliberately rather than inferred from a shininess value that came out of 3ds Max.
         *
         * The pack is flat-shaded low-poly lit by a single atlas, so: fully dielectric, fairly matte, and
         * texture colours passed through untouched. Preserving the map's colour space matters -- an sRGB
         * atlas read as linear washes the character out.
         */
        const convertMaterial = (m) => {
          if (!m || m.isMeshStandardMaterial) return m;
          const std = new THREE.MeshStandardMaterial({
            name: m.name || 'companion',
            color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
            map: m.map || null,
            roughness: 0.85,
            metalness: 0.0,
            transparent: !!m.transparent,
            opacity: m.opacity === undefined ? 1 : m.opacity,
            side: THREE.FrontSide,
            skinning: undefined,
          });
          if (std.map) std.map.colorSpace = THREE.SRGBColorSpace;
          return std;
        };

        let textured = false;
        base.traverse(o => {
          if (!o.isMesh) return;
          o.material = Array.isArray(o.material) ? o.material.map(convertMaterial) : convertMaterial(o.material);
          for (const m of [].concat(o.material)) if (m && m.map) textured = true;
        });
        // A missing atlas is the difference between a character and a grey mannequin, and it fails
        // silently on the GPU, so it is reported rather than assumed.
        if (!textured) notes.push('no texture map survived material conversion (figure will render untextured)');

        /**
         * NO RETARGETING. The clips are used exactly as authored, and that is a measured decision.
         *
         * Every file in this pack ships its own rest skeleton -- they differ by up to 6.8% of body height,
         * so male_idle2 is technically a different rig from male_idle1. That looks like it demands a
         * retarget, and two were built and benchmarked against playing the tracks as-is
         * (tools/retarget_sanity.cjs, tools/retarget_bench.cjs). Both lost:
         *
         *   * A per-bone rest-basis rebase (q_target = T * S_inv * q) tripled the pose error -- mean
         *     per-bone deviation from the source's own pose went from 0.085 to 0.312 body heights on hype.
         *     The rest bases differ here because the CHARACTERS ARE PROPORTIONED DIFFERENTLY, not because
         *     of a coordinate convention, so rebasing rotations into the target's basis distorts the pose it
         *     was trying to preserve.
         *
         *   * three.js's own SkeletonUtils.retargetClip produced a completely INERT clip: it emits
         *     .bones[name].quaternion track paths, which do not resolve when the mixer is rooted on the
         *     SkinnedMesh, so 0 of 29 tracks bound and the figure never moved. It scored best on
         *     deformation precisely because a mesh at rest does not deform -- a good reminder that a metric
         *     without a liveness check will happily reward doing nothing.
         *
         *   * Playing the tracks raw reproduces the source pose to 0.0000 body heights on same-rig clips
         *     and 0.0098-0.114 on cross-rig ones, with every track bound.
         *
         * The residual stretch on cross-rig clips (up to ~7% of body height at the shoulder, against ~3.9%
         * when the same clip plays on its own rig) is the cost of sharing one skeleton across the pack. It
         * is a shoulder-weighting artifact on a low-poly mesh at extreme arm poses, and the alternative --
         * one skeleton and mesh per clip -- would mean 20 rigs and no cross-fading between clips at all.
         */
        // ---- remaining files: take the clip, drop the duplicate geometry ----------------------
        for (const [name, file] of CLIPS.slice(1)) {
          let grp;
          try { grp = await load(file); }
          catch (e) { notes.push('FAILED to load ' + file + ': ' + e.message); continue; }

          const clip = grp.animations[0];
          if (!clip) { notes.push('no clip in ' + file); continue; }

          // A clip only drives this skeleton if its track targets exist here. Names are identical across
          // the pack, but asserting it is what turns a silently-inert clip into a reported one.
          const targets = new Set(clip.tracks.map(t => t.name.split('.')[0]));
          const matched = [...targets].filter(t => boneNames.has(t)).length;
          if (matched === 0) { notes.push('clip "' + name + '" targets no bone of this rig; dropped'); continue; }
          if (matched < targets.size) {
            notes.push('clip "' + name + '": ' + matched + '/' + targets.size + ' targets matched');
          }

          clip.name = name;
          clips.push(clip);
        }

        /**
         * Strip root motion.
         *
         * The pack bakes locomotion into the clip -- basicWalk literally translates the character across
         * the world. Right for a game where the clip drives movement, wrong here: the app owns where the
         * companion is (it anchors to desktop percentages and drifts with intent), and a clip that also
         * translates fights that placement and walks the figure off its anchor. It would also make the
         * ground line depend on which clip happens to be playing.
         *
         * Only tracks targeting NON-bone nodes are removed, so every bone channel -- including the
         * pelvis rotation that gives a walk its weight -- survives. The walk still looks like a walk; it
         * walks in place, and the app decides whether that becomes travel.
         */
        const stripped = [];
        for (const clip of clips) {
          const before = clip.tracks.length;
          clip.tracks = clip.tracks.filter(t => boneNames.has(t.name.split('.')[0]));
          if (clip.tracks.length !== before) stripped.push(clip.name + ' (-' + (before - clip.tracks.length) + ')');
        }

        // ---- measure the real skinned figure ---------------------------------------------------
        /**
         * Measured through CPU skinning at a posed frame, not from the rest pose and not from
         * Box3.setFromObject.
         *
         * setFromObject uses the undeformed geometry box for a SkinnedMesh, which is not the character.
         * And the rest pose of this pack is not the character either -- measuring it is what produced a
         * badly wrong scale factor in the previous pipeline. Frame 1 of the first clip is the pose the
         * user actually sees first, so it is the honest thing to normalise against.
         */
        base.updateMatrixWorld(true);
        const mixer = new THREE.AnimationMixer(mesh);
        if (clips[0]) {
          mixer.clipAction(clips[0]).reset().play();
          mixer.setTime(0);
          base.updateMatrixWorld(true);
        }

        const measure = () => {
          const box = new THREE.Box3();
          const v = new THREE.Vector3();
          const pos = mesh.geometry.attributes.position;
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i);
            mesh.applyBoneTransform(i, v);
            v.applyMatrix4(mesh.matrixWorld);
            box.expandByPoint(v);
          }
          return box;
        };

        /**
         * Per-clip deformation report, so the retarget is verified in the same run that performs it.
         *
         * Max per-edge stretch over the clip, as a fraction of body height. Scale-free, so it is comparable
         * against the source-asset figures the audit produced (2%-6.5% on the pack's own rigs). A clip that
         * comes out far above its own source is a retarget that made things worse, and that is worth
         * knowing here rather than three tools later.
         */
        const geoPos = mesh.geometry.attributes.position;
        const geoIdx = mesh.geometry.index;
        const triN = geoIdx ? Math.floor(geoIdx.count / 3) : Math.floor(geoPos.count / 3);
        const edgeSeen = new Set(), EDGES = [];
        for (let t = 0; t < triN; t++) {
          const a = geoIdx ? geoIdx.getX(t * 3) : t * 3;
          const b = geoIdx ? geoIdx.getX(t * 3 + 1) : t * 3 + 1;
          const c = geoIdx ? geoIdx.getX(t * 3 + 2) : t * 3 + 2;
          for (const pr of [[a, b], [b, c], [c, a]]) {
            const lo = Math.min(pr[0], pr[1]), hi = Math.max(pr[0], pr[1]), k = lo + '_' + hi;
            if (!edgeSeen.has(k)) { edgeSeen.add(k); EDGES.push([lo, hi]); }
          }
        }
        const ep = new THREE.Vector3(), eq = new THREE.Vector3();
        const skinPt = (i, into) => {
          into.fromBufferAttribute(geoPos, i);
          mesh.applyBoneTransform(i, into);
          return into.applyMatrix4(mesh.matrixWorld);
        };
        const edgeLens = () => EDGES.map(e => skinPt(e[0], ep).distanceTo(skinPt(e[1], eq)));

        /**
         * Rest local transforms, captured before any clip is ever bound, and an explicit reset built on them.
         *
         * AnimationMixer.stopAllAction() does NOT restore bind pose -- it stops evaluating and leaves the
         * bones wherever the last setTime put them. Measuring a "bind" baseline after stopAllAction()
         * therefore measures the PREVIOUS clip's final pose, which silently corrupted every per-clip number
         * after the first (the same clip read 3.47% in one harness and 5.16% in another; neither was doing
         * bad arithmetic, both were measuring from a moved starting line).
         *
         * skeleton.pose() would reset from the inverse bind matrices, but it destroyed a bind reference
         * earlier in this investigation on a file whose bind space was in question, so the rest transforms
         * are captured directly instead.
         */
        const REST = mesh.skeleton.bones.map(b => ({
          bone: b, p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone(),
        }));
        const resetPose = () => {
          for (const r of REST) { r.bone.position.copy(r.p); r.bone.quaternion.copy(r.q); r.bone.scale.copy(r.s); }
          base.updateMatrixWorld(true);
        };

        const deformOf = (clip, height) => {
          resetPose();
          const bindLens = edgeLens();
          const m2 = new THREE.AnimationMixer(mesh);
          m2.clipAction(clip).reset().play();
          const worstLens = bindLens.slice();
          for (let s = 0; s <= 12; s++) {
            m2.setTime(clip.duration * (s / 12));
            base.updateMatrixWorld(true);
            const now = edgeLens();
            for (let i = 0; i < now.length; i++) if (now[i] > worstLens[i]) worstLens[i] = now[i];
          }
          m2.stopAllAction();
          m2.uncacheClip(clip);
          resetPose();
          let maxG = 0;
          for (let i = 0; i < bindLens.length; i++) {
            const g = (worstLens[i] - bindLens[i]) / height;
            if (g > maxG) maxG = g;
          }
          return maxG;
        };

        const box = measure();
        const size = box.getSize(new THREE.Vector3());
        const k = size.y > 1e-9 ? TARGET / size.y : 1;

        /**
         * Normalise on a WRAPPER above the rig, never by rewriting vertices or bind matrices.
         *
         * A uniform parent transform P multiplies bone.matrixWorld and the mesh's bindMatrixInverse
         * alike, so the rendered position is P * sum(w * D_i * v) with every skinning matrix D_i
         * unchanged. The binding is therefore preserved by construction -- and preserving it is the whole
         * point, since a broken binding is invisible at bind pose and is what shipped last time.
         */
        const wrapper = new THREE.Group();
        wrapper.name = 'companion_root';
        wrapper.scale.setScalar(k);
        wrapper.position.set(
          -(box.min.x + box.max.x) * 0.5 * k,   // centre the pivot in x
          -box.min.y * k,                        // feet on y = 0
          -(box.min.z + box.max.z) * 0.5 * k,    // centre the pivot in z
        );
        wrapper.add(base);
        wrapper.updateMatrixWorld(true);

        // Ground drift across the first clip: with root motion stripped the feet should stay planted, so
        // report the worst case rather than trusting one frame.
        let driftLo = Infinity, driftHi = -Infinity;
        if (clips[0]) {
          const d = clips[0].duration;
          for (let i = 0; i <= 8; i++) {
            mixer.setTime(d * (i / 8));
            wrapper.updateMatrixWorld(true);
            const b = measure();
            driftLo = Math.min(driftLo, b.min.y * k + wrapper.position.y);
            driftHi = Math.max(driftHi, b.min.y * k + wrapper.position.y);
          }
          mixer.setTime(0);
          wrapper.updateMatrixWorld(true);
        }

        // ---- export ---------------------------------------------------------------------------
        /**
         * Reset to REST before exporting.
         *
         * GLTFExporter writes each node's CURRENT local transform, so whatever pose the bones are in when
         * parse() is called becomes the exported rest pose -- and everything downstream that reasons about
         * bind pose (the app's own integrity check, every harness here) would then be reasoning about frame
         * 0 of idle1 instead. The measurement passes above leave the skeleton posed, so this undoes them.
         * The inverse bind matrices are computed from the skeleton's boneInverses and are unaffected either
         * way, but the node transforms are not, and a rest pose that is secretly a keyframe is exactly the
         * kind of invisible-at-bind defect this whole pipeline exists to avoid.
         */
        mixer.stopAllAction();
        resetPose();
        wrapper.updateMatrixWorld(true);

        const glb = await new Promise((res, rej) => new GLTFExporter().parse(
          wrapper,
          res,
          rej,
          { binary: true, animations: clips, includeCustomExtensions: false },
        ));

        /**
         * Deformation per clip, measured on the finished rig. Reported for every clip so one bad clip
         * cannot hide behind an average.
         *
         * The height passed in is TARGET, not size.y. deformOf measures edges through mesh.matrixWorld,
         * which by this point includes the wrapper's normalisation scale, so the edges are in normalised
         * metres and the figure is TARGET tall. Dividing by size.y -- the height in the FBX's ~180-unit
         * source space -- understated every number by exactly the scale factor, about 104x, which is how it
         * was caught: idle1 came back at 0.006% when an independent harness had already measured 0.668%.
         *
         * (No backticks in this injected script, comments included: it is interpolated into a template
         * literal, so one closes the literal and the file stops parsing.)
         */
        const deform = {};
        for (const c of clips) deform[c.name] = +(deformOf(c, TARGET) * 100).toFixed(3);
        resetPose();

        return {
          bytes: Array.from(new Uint8Array(glb)),
          deform,
          clips: clips.map(c => ({ name: c.name, duration: +c.duration.toFixed(4), tracks: c.tracks.length })),
          bones: mesh.skeleton.bones.length,
          verts: mesh.geometry.attributes.position.count,
          measuredHeight: +size.y.toFixed(4),
          scale: +k.toFixed(6),
          groundDrift: [+driftLo.toFixed(5), +driftHi.toFixed(5)],
          strippedRootMotion: stripped,
          notes,
        };
      })(JSON.parse(CFG_JSON))
    `;

    const result = await win.webContents.executeJavaScript(
      `((CFG_JSON) => ${PAGE})(${JSON.stringify(JSON.stringify({
        clips: spec.clips, pack: PACK_REL, target: TARGET_HEIGHT,
      }))})`,
    );

    if (result.error) { log(`  ERROR ${result.error}`); app.exit(5); return; }

    const out = path.join(OUT_DIR, `${key}.glb`);
    fs.writeFileSync(out, Buffer.from(result.bytes));

    log(`  source height ${result.measuredHeight} -> scale ${result.scale} -> ${TARGET_HEIGHT} m`);
    log(`  bones ${result.bones}  verts ${result.verts}  clips ${result.clips.length}`);
    log(`  ground drift ${result.groundDrift[0]} .. ${result.groundDrift[1]} m`);
    if (result.strippedRootMotion.length) log(`  stripped root motion: ${result.strippedRootMotion.join(', ')}`);
    for (const n of result.notes) log(`  NOTE ${n}`);
    log(`  clips: ${result.clips.map(c => `${c.name}(${c.duration}s/${c.tracks}t)`).join(' ')}`);
    // Max per-edge stretch as a % of body height. The pack's own rigs measure 2.0-6.5% on these same
    // clips, so anything in that band is the asset's authored deformation, not something we introduced.
    log(`  deformation (max edge stretch, % of body height):`);
    for (const [n, v] of Object.entries(result.deform)) log(`    ${n.padEnd(12)} ${v.toFixed(3)}%`);
    log(`  wrote ${out} (${fs.statSync(out).size} bytes)`);

    RIGS[key]._result = result;
  }

  // ---- manifest -----------------------------------------------------------------------------
  const manifest = {
    generated: 'tools/fbx_to_glb.cjs (three.js FBXLoader -> GLTFExporter, run in Electron)',
    targetHeight: TARGET_HEIGHT,
    license: LICENSE,
    companions: Object.entries(RIGS).map(([key, spec]) => ({
      id: key,
      label: spec.label,
      rig: spec.rig,
      file: `companions/${key}.glb`,
      bones: spec._result.bones,
      vertices: spec._result.verts,
      clips: spec._result.clips,
      groundDrift: spec._result.groundDrift,
      /**
       * Max per-edge stretch per clip, as a percentage of body height, measured from a real bind pose.
       *
       * Recorded because the app's rig-integrity check needs a calibrated reference rather than a number
       * someone chose. For scale: a broken export measured 107% here, these clips run 0.7%-9.5%, and the
       * same clips on the skeletons they shipped with run 2%-6.5% -- so single-digit values are this
       * pack's own low-poly shoulder weighting, not a pipeline defect.
       */
      deformationPctOfHeight: spec._result.deform,
    })),
  };
  const mf = path.join(OUT_DIR, 'manifest.json');
  fs.writeFileSync(mf, JSON.stringify(manifest, null, 2));
  log(`\nwrote ${mf}`);
  log('done');
  app.exit(0);
}).catch(e => { log(`REJ ${e && e.stack}`); app.exit(6); });
