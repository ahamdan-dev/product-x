/**
 * Companion picker. Two stock rigs shown as live 3D, plus a custom import.
 *
 * ── ONE CANVAS, NOT THREE ───────────────────────────────────────────────────
 * Both hero previews and the future custom preview share a single `<Canvas>`; the cards are laid
 * out in DOM and the rigs are placed side by side in one scene, framed by one locked camera. This
 * was measured, not assumed. Each rig is 1 skinned mesh, 1 material, one 256² texture, ~1.6k
 * triangles, 22 bones. Animating one costs 0.0059 ms/frame; two cost 0.0115 ms; two cross-fading
 * cost 0.0129 ms — under 0.08% of a 16.7 ms budget. The per-rig cost is therefore irrelevant and
 * the only real cost is the fixed overhead of a WebGL context: a second context means a second
 * render loop, a second state machine, duplicated shader programs, and browser context limits.
 * One canvas removes all of that. drei's `<View>` would also work but needs tunnel-rat, per-frame
 * `getBoundingClientRect` and scissor juggling — machinery whose failure modes are not worth
 * carrying for a two-card picker.
 *
 * ── THE RIGS ARE BROKEN, AND THIS FILE SURVIVES THAT ────────────────────────
 * The shipped GLBs cannot be animated. Their geometry is authored Z-up (a clean T-pose lying in
 * the XZ plane) while their skeletons stand Y-up, and no runtime transform reconciles the two:
 * an optimal similarity fit still leaves a 0.12–0.17 m residual per vertex, and playing any clip
 * stretches triangle edges to ~1.9 m on a 1.75 m figure — the mesh renders as a spray of shards.
 * Rather than show that to a room, the picker measures each rig on load (`assessRigIntegrity`) and,
 * when the bind is torn, presents the rig standing in its own correct bind pose with animation
 * suppressed and a quiet honest note on the card. Liveness then comes from the scene — a slow
 * turntable drift and the card's own light — not from a clip that would shatter the model.
 * When a repaired GLB is dropped in, `animatable` flips true and the clips play with no code change.
 *
 * The material is also overridden on load: the authored `metalness` is 1 with no environment map,
 * which multiplies albedo by (1 − metalness) = 0 and renders the figures black. That is the
 * "unpainted CAD" look the brand explicitly rejects.
 */

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useApp } from '../state/store';
import {
  assessRigIntegrity,
  attributionText,
  chooseClips,
  needsZUpToYUp,
  normaliseUpright,
  parseCompanionManifest,
  resolveAssetUrl,
  checkImportSize,
  describeModelImport,
  placeRigInWindow,
  rectsToClipPath,
  type CompanionManifest,
  type PixelBox,
  type RigPlacement,
} from './glbSource';
import { classifyImport, validateSpriteZipManifest, type Issue } from './spriteStandard';
import './picker.css';

/** Subject height every companion is normalised to, per the manifest. */
const TARGET_HEIGHT = 1.75;

/**
 * The camera is fixed and dead level; every rig is then placed to suit it.
 *
 * A long lens (30°) at a few metres keeps the perspective gentle — a wide lens this close would
 * distort a face. The distance and height are not framing dials: because each rig's position and
 * presentation scale are derived from its measured well (see the layout effect), any reasonable
 * pair of values here produces the same composition, and these two only set how strong the
 * perspective is. A level camera is also what makes "no looking up the model's nose" structural
 * rather than a matter of restraint — there is no tilt to abuse, and no controls are mounted.
 */
const CAM_FOV = 30;
const CAM_HEIGHT = 0.85;
const CAM_DISTANCE = 4.2;

/** Fraction of its well's height the figure occupies, leaving air above the head. */
const FIGURE_FILL = 0.82;
/** Where the ground line sits inside a well, matching `.x-pick__well::after` in picker.css. */
const GROUND_LINE_FRACTION = 0.14;

/** Where one rig stands and how big it reads, both derived from the DOM. */
interface Slot extends RigPlacement {
  /**
   * False until the rig's own measured width has fed back into this placement.
   *
   * The framing needs the figure's width, but the width is only knowable once the GLB has loaded,
   * and it cannot load until it is mounted into a slot — so the first slot for any rig is solved on
   * height alone and is wrong for a wide pose. Rather than let the figure appear at one size and
   * visibly jump to another, the rig mounts invisible for the frame or two that takes: it still
   * loads, still measures, still reports. What the room sees is a companion arriving already framed.
   */
  framed: boolean;
}

// ── Rig loading ─────────────────────────────────────────────────────────────

interface PreparedRig {
  /** Ready to mount: uprighted, grounded, centred, scaled, material repaired. */
  object: THREE.Object3D;
  clips: THREE.AnimationClip[];
  animatable: boolean;
  /** Set when the rig cannot be animated — shown on the card, quietly. */
  note: string | null;
  /**
   * Widest horizontal extent in metres, after normalisation — how much room the figure needs to
   * stand in its well without losing its hands to the frame. Measured, not assumed: an animated
   * companion is ~0.6 m across, but a rig displayed in its bind pose is a T-pose at ~1.76 m across,
   * which is wider than it is tall.
   */
  width: number;
}

/**
 * Longest triangle edge as the GPU would actually compute it — vertex through the skinning
 * transform, then into world space.
 *
 * Rest and posed edges must be measured by the same path or the ratio between them is meaningless.
 * That is not hypothetical: measuring the rest pose from raw geometry while measuring the posed
 * mesh through `applyBoneTransform` compares two different spaces, because these rigs carry a
 * 0.0097 scale on the mesh node that the skinning path cancels and the raw path does not. Passing
 * `clip: null` measures the bind pose through the identical pipeline, so the ratio is honest.
 *
 * `Skeleton.pose()` is deliberately NOT used to get back to the bind pose. It derives each bone's
 * LOCAL transform from the inverse bind matrix, which is a world-space quantity — correct only when
 * no ancestor scales the rig. These rigs put 0.01 on `rig_CharRoot`, so `pose()` writes a transform
 * 100× off and collapses the figure (measured: a 0.0014 m longest edge where the true value is
 * 0.18 m). The bones already sit at bind when the file loads, so rest needs no restoration at all;
 * after sampling a clip, the local transforms are snapshotted and put back verbatim instead.
 *
 * Cloning the scene would be tidier, but `SkeletonUtils.clone` costs 1.69 ms per rig, and this runs
 * once before the object is ever rendered.
 */
function worstEdge(root: THREE.Object3D, clip: THREE.AnimationClip | null): number {
  const mixer = clip ? new THREE.AnimationMixer(root) : null;
  if (mixer && clip) mixer.clipAction(clip).reset().play();

  const samples = clip ? 4 : 1;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  let worst = 0;

  for (let s = 0; s < samples; s++) {
    if (mixer && clip) mixer.setTime((clip.duration * s) / samples);
    root.updateMatrixWorld(true);

    root.traverse(o => {
      const sm = o as THREE.SkinnedMesh;
      if (!sm.isSkinnedMesh) return;
      sm.skeleton.update();
      const pos = sm.geometry.getAttribute('position');
      const index = sm.geometry.index;
      if (!pos) return;
      /*
       * Non-indexed geometry is measured too, and that is not a defensive nicety — it is the whole
       * reason this gate works at all.
       *
       * This loop previously read `if (!pos || !index) return`, and GLTFExporter writes what it is
       * given: the FBX source hands back non-indexed geometry, so both shipped companions have NO
       * index buffer. Every edge, rest and posed, on both rigs, across all 22 clips, therefore
       * measured exactly 0.0000 m — and an exact zero sails through `assessRigIntegrity`, which was
       * handed maxEdge = 0 and passed unconditionally. The gate reported every rig safe by never
       * looking. A tear check that cannot fail is worse than none, because it is quoted as evidence.
       *
       * For non-indexed geometry the vertices ARE the triangle corners in order, so the index is just
       * the position in the buffer. Same stride either way, so the sample size does not change.
       */
      const corners = index ? index.count : pos.count;
      const at = index ? (i: number) => index.getX(i) : (i: number) => i;
      // Every 5th triangle. A uniform sample finds the scale of the longest edge without walking
      // 4,600 triangles four times on the main thread.
      for (let i = 0; i + 1 < corners; i += 15) {
        const ia = at(i);
        const ib = at(i + 1);
        a.fromBufferAttribute(pos, ia);
        sm.applyBoneTransform(ia, a);
        sm.localToWorld(a);
        b.fromBufferAttribute(pos, ib);
        sm.applyBoneTransform(ib, b);
        sm.localToWorld(b);
        worst = Math.max(worst, a.distanceTo(b));
      }
    });
  }

  if (mixer && clip) {
    mixer.stopAllAction();
    mixer.uncacheClip(clip);
    mixer.uncacheRoot(root);
  }
  return worst;
}

/**
 * Give the figures skin that reacts to light.
 *
 * The authored material is physical with metalness 1 and no env map, so albedo is multiplied to
 * nothing. Keeping the baseColor texture and dialling metalness down is what turns black shards
 * into a lit figure; a touch of roughness keeps it matte rather than plastic.
 */
function repairMaterials(root: THREE.Object3D): void {
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh && !(mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of list) {
      const std = mat as THREE.MeshStandardMaterial;
      if (!std || typeof std !== 'object') continue;
      if ('metalness' in std) std.metalness = 0.04;
      if ('roughness' in std) std.roughness = 0.62;
      const phys = std as THREE.MeshPhysicalMaterial;
      // Companion A ships specularIntensity 0 via KHR_materials_specular, which kills even the
      // highlight the metalness override would have given back.
      if ('specularIntensity' in phys && phys.specularIntensity === 0) phys.specularIntensity = 0.5;
      std.needsUpdate = true;
    }
  });
}

/**
 * Load one companion and hand back something safe to render.
 *
 * The `+90° about X` rotation is the change of basis that stands the Z-up authored mesh up; the
 * normalisation then grounds and centres it so both cards share a ground line and a pivot. Both
 * are applied to a wrapper group, never to the geometry, so nothing is mutated in `useGLTF`'s cache.
 */
function prepareRig(gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }): PreparedRig {
  const source = gltf.scene;

  /*
   * Measure the figure AS AUTHORED first, then decide whether it needs standing up.
   *
   * The rotation used to be unconditional, which was right for the raw Z-up FBX rigs and wrong for
   * everything the converter now produces. `tools/fbx_to_glb.cjs` normalises its output to Y-up at
   * 1.75 m, so the fixed +90° laid the finished companion on its back: the shipped bind box measures
   * 0.531 × 1.750 × 0.380 upright, and the rotation turned that into 0.531 × 0.380 × 1.750, after
   * which `normaliseUpright` read "height" as the figure's 0.38 m depth and scaled it 4.6× to
   * compensate. A custom import can arrive either way round, so this has to be measured per file
   * rather than pinned to whatever the stock assets happen to be this week.
   */
  const upright = new THREE.Group();
  upright.add(source);
  upright.updateMatrixWorld(true);

  // `setFromObject` accounts for skinning on a SkinnedMesh in three r169, so this is the box the
  // renderer will actually draw — not `geometry.boundingBox * matrixWorld`, which for these rigs
  // reports a T-pose lying down (1.759 × 1.752 × 0.314) whose Y and Z are too close to tell apart.
  const authored = new THREE.Box3().setFromObject(upright);
  if (
    needsZUpToYUp({
      min: [authored.min.x, authored.min.y, authored.min.z],
      max: [authored.max.x, authored.max.y, authored.max.z],
    })
  ) {
    upright.rotation.x = Math.PI / 2;
    upright.updateMatrixWorld(true);
  }

  const box = new THREE.Box3().setFromObject(upright);
  const norm = normaliseUpright(
    { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] },
    TARGET_HEIGHT,
  );

  // Both edges through the same pipeline, in pre-normalisation metres, compared against the
  // MEASURED height — a ratio is only meaningful if all three share one space.
  const clips = gltf.animations ?? [];
  const restEdge = worstEdge(source, null);
  let maxPosedEdge = 0;
  if (clips.length > 0) {
    // Snapshot every bone's LOCAL transform before the probe. This is the only safe way back to the
    // authored bind pose for these rigs (see worstEdge on why Skeleton.pose() destroys them), and
    // the still pose is what the user actually sees, so getting it back exactly is the whole point.
    const bones: THREE.Bone[] = [];
    source.traverse(o => {
      if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
    });
    const rest = bones.map(bone => ({
      position: bone.position.clone(),
      quaternion: bone.quaternion.clone(),
      scale: bone.scale.clone(),
    }));

    const idleName = chooseClips(clips.map(c => c.name)).idle;
    const probe = clips.find(c => c.name === idleName) ?? clips[0];
    if (probe) maxPosedEdge = worstEdge(source, probe);

    bones.forEach((bone, i) => {
      const snap = rest[i];
      if (!snap) return;
      bone.position.copy(snap.position);
      bone.quaternion.copy(snap.quaternion);
      bone.scale.copy(snap.scale);
    });
    upright.updateMatrixWorld(true);
    source.traverse(o => {
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh) sm.skeleton.update();
    });
  }

  const integrity = assessRigIntegrity({
    maxEdge: maxPosedEdge,
    restEdge,
    subjectHeight: norm.measuredHeight,
  });

  repairMaterials(upright);
  upright.traverse(o => {
    o.castShadow = false;
    o.receiveShadow = false;
    (o as THREE.Mesh).frustumCulled = false;
  });

  // Wrapper carries the grounding translation and the uniform scale; `upright` carries the basis
  // change. Two groups keeps each transform readable instead of one fused matrix.
  const holder = new THREE.Group();
  holder.scale.setScalar(norm.scale);
  upright.position.set(norm.translate[0], norm.translate[1], norm.translate[2]);
  holder.add(upright);

  if (!integrity.animatable && integrity.reason) {
    // Loud in the console (this is an asset defect someone must fix), quiet in the UI.
    console.warn(`[companion] ${integrity.reason}`);
  }

  return {
    object: holder,
    clips,
    animatable: integrity.animatable && clips.length > 0,
    note: integrity.animatable ? null : 'Preview shown as a still pose',
    /*
     * The bind pose's own width, in final metres, is what the framing is allowed to size against.
     *
     * It is exact and free — `box` is the skinning-aware bind box already measured above — and it is
     * the right number for both cases rather than a conservative stand-in for one. A rig whose
     * animation was suppressed is literally displayed in this pose, arms straight out: companion A
     * spans 1.76 m across a 1.75 m height, so width is what binds. And a rig that DOES animate is
     * playing `celebrate` / `flourish` / `hype`, where the arms swing out to near their full span —
     * a T-pose is close to the widest a humanoid silhouette ever gets, so this bounds those too.
     * Measuring each clip's true silhouette instead would mean transforming all 22k vertices at
     * several sample times through `applyBoneTransform` (~26 ms) to win back a few percent of scale.
     */
    width: (box.max.x - box.min.x) * norm.scale,
  };
}

/** What loading a rig teaches us that the DOM outside the canvas needs to know. */
interface RigFacts {
  /** Set when animation had to be suppressed — the card renders this. */
  note: string | null;
  /** Metres across, which decides whether width or height constrains the framing. */
  width: number;
}

interface RigProps {
  url: string;
  /** Selected or hovered: the rig leans into the light and, if it can, plays its reward clip. */
  excited: boolean;
  /** Reports what the rig turned out to be, back out to the DOM that has to frame and label it. */
  onMeasured: (facts: RigFacts) => void;
}

function Rig({ url, excited, onMeasured }: RigProps) {
  const gltf = useGLTF(url);
  const prepared = useMemo(
    () => prepareRig(gltf as unknown as { scene: THREE.Object3D; animations: THREE.AnimationClip[] }),
    [gltf],
  );

  // Both facts are discovered inside the canvas, on load, but are needed outside it: the note is
  // rendered by the card, and the width feeds the framing solve that decides this rig's own scale.
  useEffect(() => {
    onMeasured({ note: prepared.note, width: prepared.width });
  }, [prepared, onMeasured]);

  const group = useRef<THREE.Group>(null);
  const mixer = useRef<THREE.AnimationMixer | null>(null);
  const current = useRef<THREE.AnimationAction | null>(null);

  const clipNames = useMemo(() => prepared.clips.map(c => c.name), [prepared.clips]);
  const choice = useMemo(() => chooseClips(clipNames), [clipNames]);

  // The mixer only exists for a rig that is safe to animate.
  useEffect(() => {
    if (!prepared.animatable) return;
    const m = new THREE.AnimationMixer(prepared.object);
    mixer.current = m;
    return () => {
      m.stopAllAction();
      for (const clip of prepared.clips) m.uncacheClip(clip);
      m.uncacheRoot(prepared.object);
      mixer.current = null;
      current.current = null;
    };
  }, [prepared]);

  // Cross-fade between rest and reward. 380 ms is long enough to read as a body moving rather than
  // a cut, short enough to feel like a response to the pointer.
  useEffect(() => {
    const m = mixer.current;
    if (!m || !prepared.animatable) return;
    const wanted = (excited ? choice.lively : choice.idle) ?? choice.idle;
    if (!wanted) return;
    const clip = prepared.clips.find(c => c.name === wanted);
    if (!clip) return;
    const next = m.clipAction(clip);
    next.reset().setLoop(THREE.LoopRepeat, Infinity).play();
    if (current.current && current.current !== next) {
      current.current.crossFadeTo(next, 0.38, false);
    }
    current.current = next;
  }, [excited, choice, prepared]);

  // Disposal: useGLTF caches the source scene, so geometry and textures are shared and must NOT be
  // disposed here — clearing the cache entry is the owner's job (see the preload effect below).
  // What this component owns is the mixer, handled above.

  useFrame((_state, delta) => {
    const m = mixer.current;
    if (m) m.update(delta);
    const g = group.current;
    if (!g) return;
    // A still rig would look like a screenshot, so the presentation itself breathes: a slow yaw
    // drift, and a small lean towards the viewer when the card is live. Both are the scene's
    // liveness, not the model's, which is what keeps a torn rig presentable.
    const t = _state.clock.elapsedTime;
    const target = excited ? 0.26 : 0;
    g.rotation.y += (Math.sin(t * 0.28) * 0.14 + target - g.rotation.y) * Math.min(1, delta * 3);
    g.position.y += ((excited ? 0.035 : 0) - g.position.y) * Math.min(1, delta * 4);
  });

  return (
    <group ref={group}>
      <primitive object={prepared.object} />
    </group>
  );
}

// ── Scene ───────────────────────────────────────────────────────────────────

/**
 * Warm, soft light matching the aurora palette: a hemisphere for ambient fill, one warm key from
 * the upper left, and a cool bounce from the lower right. Three lights, as `World.tsx` establishes
 * — a hard three-point studio rig is what makes hobby 3D look like hobby 3D.
 */
function Lighting() {
  return (
    <>
      <hemisphereLight args={['#FFFFFF', '#C9C4BA', 1.05]} />
      <directionalLight position={[-2.2, 3.2, 2.6]} intensity={1.35} color="#FBD1B8" />
      <directionalLight position={[2.6, 1.4, -1.8]} intensity={0.42} color="#A9E3F1" />
    </>
  );
}

/** A soft elliptical contact shadow. Cheaper and calmer than a shadow map for a figure at rest. */
function GroundShade({ radius }: { radius: number }) {
  return (
    <mesh position={[0, 0.002, 0.04]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[radius, 32]} />
      <meshBasicMaterial color="#20222B" transparent opacity={0.07} depthWrite={false} />
    </mesh>
  );
}

interface SceneProps {
  urls: readonly string[];
  activeIndex: number | null;
  onMeasured: (index: number, facts: RigFacts) => void;
  /** Position and scale per rig, derived from the real well geometry. */
  slots: readonly Slot[];
}

function Scene({ urls, activeIndex, onMeasured, slots }: SceneProps) {
  return (
    <>
      <Lighting />
      {urls.map((url, i) => {
        // No slot yet means the DOM has not been measured, so the rig would land in the wrong
        // place; skip it for that one frame rather than show it sliding into position.
        const slot = slots[i];
        if (!slot) return null;
        return (
          // The slot's placement lives on this group, so the rig itself only has to know how to
          // stand at the origin — and one uniform scale keeps the figure and its shadow together.
          // `visible` hides only the first frame or two, before the rig's measured width has been
          // folded into its scale (see Slot.framed). It does not affect loading or measurement.
          <group
            key={url}
            position={[slot.x, slot.y, 0]}
            scale={slot.scale}
            visible={slot.framed}
          >
            <GroundShade radius={0.42} />
            <Rig
              url={url}
              excited={activeIndex === i}
              onMeasured={facts => onMeasured(i, facts)}
            />
          </group>
        );
      })}
    </>
  );
}

// ── Import validation ───────────────────────────────────────────────────────

interface ImportReport {
  fileName: string;
  ok: boolean;
  issues: Issue[];
}

/** Read the central directory of a ZIP to list its entries, without a dependency. */
async function listZipEntries(file: File): Promise<string[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const names: string[] = [];
  // Scan for local file headers (PK\x03\x04) and read each name. Enough to validate the manifest
  // shape; the pixels are validated later by validateSheet once a sheet is actually decoded.
  for (let i = 0; i + 30 < buf.length; i++) {
    if (buf[i] !== 0x50 || buf[i + 1] !== 0x4b || buf[i + 2] !== 0x03 || buf[i + 3] !== 0x04) continue;
    const nameLen = (buf[i + 26] ?? 0) | ((buf[i + 27] ?? 0) << 8);
    if (nameLen <= 0 || i + 30 + nameLen > buf.length) continue;
    names.push(new TextDecoder().decode(buf.subarray(i + 30, i + 30 + nameLen)));
  }
  return names;
}

/**
 * Validate a 3D import by actually loading it and measuring it.
 *
 * The loader is imported lazily so the picker's initial bundle does not carry an FBX parser that
 * most users never trigger.
 */
async function validateModelFile(file: File, targetHeight: number): Promise<ImportReport> {
  const url = URL.createObjectURL(file);
  try {
    const ext = file.name.toLowerCase().split('.').pop() ?? '';
    let scene: THREE.Object3D;
    let animations: THREE.AnimationClip[];

    if (ext === 'fbx') {
      const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
      const loaded = await new FBXLoader().loadAsync(url);
      scene = loaded;
      animations = loaded.animations ?? [];
    } else {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const loaded = await new GLTFLoader().loadAsync(url);
      scene = loaded.scene;
      animations = loaded.animations ?? [];
    }

    let hasSkinnedMesh = false;
    scene.traverse(o => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) hasSkinnedMesh = true;
    });

    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    /*
     * Height is whichever of Y/Z the figure is long along — an import may be authored either way up
     * and must not be failed for that. X is excluded on purpose: `Math.max` of all three axes was
     * here before, and on a T-pose it answers the ARM SPAN. Companion A measures 1.759 m across
     * against 1.750 m tall, so the reported "height" was the wrong dimension by a whisker, which then
     * set the tear threshold and the resize warning off a number that is not the figure's height.
     */
    const heightMeters = Math.max(size.y, size.z);

    const restEdge = worstEdge(scene, null);
    const first = animations[0];
    const maxPosedEdge = first ? worstEdge(scene, first) : 0;

    const report = describeModelImport(
      file.name,
      { hasSkinnedMesh, animationCount: animations.length, heightMeters, restEdge, maxPosedEdge },
      targetHeight,
    );

    // Free the parsed geometry immediately: this object is never rendered.
    scene.traverse(o => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const m of mats) m.dispose();
    });

    return { fileName: file.name, ok: report.ok, issues: report.issues };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return {
      fileName: file.name,
      ok: false,
      issues: [
        {
          severity: 'error',
          rule: 'container',
          // The loader's own words: they name the malformed chunk, which is what makes this fixable.
          message: `"${file.name}" could not be read as a 3D model: ${detail}`,
        },
      ],
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── Cards ───────────────────────────────────────────────────────────────────

interface StockCardProps {
  label: string;
  sublabel: string;
  /** Set when this rig's animation had to be suppressed. */
  note: string | null;
  selected: boolean;
  onSelect: () => void;
  onHoverChange: (hovered: boolean) => void;
  onKeyNav: (dir: -1 | 1) => void;
  focusable: boolean;
}

function StockCard({
  label,
  sublabel,
  note,
  selected,
  onSelect,
  onHoverChange,
  onKeyNav,
  focusable,
}: StockCardProps) {
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      onKeyNav(1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      onKeyNav(-1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  };

  return (
    <div
      className={`x-pick__card ${selected ? 'is-selected' : ''}`}
      role="radio"
      aria-checked={selected}
      tabIndex={focusable ? 0 : -1}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      onPointerEnter={() => onHoverChange(true)}
      onPointerLeave={() => onHoverChange(false)}
      onFocus={() => onHoverChange(true)}
      onBlur={() => onHoverChange(false)}
    >
      {/* The canvas lives behind every card; this well is the window onto it, and the element the
          rig's world position is measured from. */}
      <div className="x-pick__well" data-rig-well="" aria-hidden="true" />
      <div className="x-pick__meta">
        <span className="x-pick__name">{label}</span>
        <span className="x-pick__sub x-mono">{sublabel}</span>
      </div>
      {/* The rig could not be animated. Said plainly, once, rather than hidden. */}
      {note && <span className="x-pick__note">{note}</span>}
      <span className="x-pick__check" aria-hidden="true">
        <svg viewBox="0 0 16 16">
          <path d="M4 8.3l2.6 2.6L12 5.6" />
        </svg>
      </span>
    </div>
  );
}

// ── Picker ──────────────────────────────────────────────────────────────────

export function Picker() {
  const character = useApp(s => s.character);
  const setCharacter = useApp(s => s.setCharacter);

  const [manifest, setManifest] = useState<CompanionManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  /** What each loaded rig turned out to be, indexed by card. Empty until the GLBs resolve. */
  const [facts, setFacts] = useState<Record<number, RigFacts>>({});
  const [slots, setSlots] = useState<readonly Slot[]>([]);
  /**
   * The mask that limits the shared canvas to the wells. `'none'` until the DOM is measured — an
   * unmasked first frame would flash a figure across the card frames.
   */
  const [clipPath, setClipPath] = useState('none');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const baseUrl = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';

  useEffect(() => {
    let alive = true;
    const url = resolveAssetUrl('companions/manifest.json', baseUrl);
    fetch(url)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(json => {
        if (!alive) return;
        const parsed = parseCompanionManifest(json);
        if (parsed) setManifest(parsed);
        else setManifestError('The companion manifest could not be read.');
      })
      .catch((e: unknown) => {
        if (alive) setManifestError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [baseUrl]);

  const urls = useMemo(
    () => (manifest ? manifest.companions.map(c => resolveAssetUrl(c.file, baseUrl)) : []),
    [manifest, baseUrl],
  );

  // Preload both rigs once the manifest names them, so the wells fill in one step instead of popping
  // in one at a time, and clear the cache on unmount so the GPU resources for a picker the user has
  // left do not outlive it.
  useEffect(() => {
    for (const u of urls) useGLTF.preload(u);
    return () => {
      for (const u of urls) useGLTF.clear(u);
    };
  }, [urls]);

  const selectedIndex = useMemo(() => {
    if (!manifest) return -1;
    const byRig = manifest.companions.findIndex(c => c.rig === character);
    return byRig >= 0 ? byRig : 0;
  }, [manifest, character]);

  const activeIndex = hovered ?? (selectedIndex >= 0 ? selectedIndex : null);

  // Identity-stable, and a no-op when nothing changed. Both matter: this is called from an effect
  // inside the canvas, and the width it carries feeds the layout solve that re-renders that canvas —
  // so returning `prev` unchanged is what stops measure → setState → measure from looping.
  const onMeasured = useCallback((index: number, next: RigFacts) => {
    setFacts(prev => {
      const have = prev[index];
      if (have && have.note === next.note && Math.abs(have.width - next.width) < 1e-4) return prev;
      return { ...prev, [index]: next };
    });
  }, []);

  /**
   * Place each rig inside its own window by measuring the DOM, rather than hard-coding metres.
   *
   * Hard-coded world offsets only line up at one canvas size: the cards are a fluid `1fr` grid, so
   * at any other panel width the rigs drift off their wells, and the canvas covers the whole card
   * (frame, label and all) rather than just the well — so a figure sized to the canvas would also
   * be wrong vertically. Both are solved by measuring the well and converting through the camera's
   * own projection: at `CAM_DISTANCE` a vertical `CAM_FOV` lens shows `2·d·tan(fov/2)` metres, which
   * turns any pixel box into world units. Each rig then gets an X (well centre), a Y (the well's
   * ground line) and a scale that CONTAINS it, so it sits in its frame at every size. Recomputed on
   * resize only — never per frame, which is the cost drei's `<View>` carries.
   *
   * It re-runs when a rig's measured width arrives, because the fit needs both the pixel box and the
   * figure's own proportions, and those two facts become available at different moments.
   */
  useEffect(() => {
    const stage = rootRef.current?.querySelector<HTMLElement>('.x-pick__stage');
    if (!stage) return;

    const measure = () => {
      const box = stage.getBoundingClientRect();
      const wells = stage.querySelectorAll<HTMLElement>('[data-rig-well]');
      if (box.width === 0 || box.height === 0 || wells.length === 0) return;

      /*
       * The canvas is clipped to exactly the well rectangles, which is what lets it sit ABOVE the
       * cards instead of behind them.
       *
       * Behind was the original design and it cost the figures their colour. Two translucent layers
       * of card material sat over the render — the card's `--x-panel-well` at 62% opacity and the
       * well's old `--x-veil` at 68% — so a mid-grey limb composited to roughly 208 of 255 and both
       * companions appeared as pale ghosts seen through frosted glass. Removing the well's veil alone
       * would not fix it; the card's own background is still in the way, and making the CARD
       * transparent would dissolve the frame the design depends on.
       *
       * So the render moves in front and is masked to the windows it is allowed to paint. `clip-path`
       * is one composited layer with no extra draw calls, and it clips the canvas element itself, so
       * the cards keep their material everywhere the wells are not. Corner radii are not modelled:
       * each well already sets `overflow: hidden` and the figure never reaches its corners, so a
       * rounded mask would cost geometry for no visible difference.
       *
       * These boxes are STAGE-RELATIVE, and that is a requirement of `rectsToClipPath`, not a
       * convenience: `path()` coordinates resolve in the clipped element's own space, and the canvas
       * is `inset: 0` on the stage. Passing raw viewport rects would shift the mask by the stage's
       * page offset and hide the figures entirely.
       */
      const clipRects: PixelBox[] = [];

      // The canvas exactly overlays the stage, so the stage box IS the viewport. The projection
      // itself lives in glbSource so it can be unit-tested without a DOM.
      const next: Slot[] = [];
      wells.forEach((well, i) => {
        const width = facts[i]?.width ?? 0;
        const wellBox = well.getBoundingClientRect();
        clipRects.push({
          left: wellBox.left - box.left,
          top: wellBox.top - box.top,
          width: wellBox.width,
          height: wellBox.height,
        });
        next.push({
          ...placeRigInWindow(
            wellBox,
            box,
            { fovDegrees: CAM_FOV, distance: CAM_DISTANCE, height: CAM_HEIGHT },
            TARGET_HEIGHT,
            FIGURE_FILL,
            GROUND_LINE_FRACTION,
            width,
          ),
          // A width of 0 means this rig has not reported yet, so the scale above is height-only and
          // provisional. Mount it, but keep it out of sight until its real proportions land.
          framed: width > 0,
        });
      });

      setClipPath(rectsToClipPath(clipRects));

      setSlots(prev =>
        prev.length === next.length &&
        prev.every((p, i) => {
          const n = next[i];
          return (
            !!n &&
            p.framed === n.framed &&
            Math.abs(p.x - n.x) < 1e-4 &&
            Math.abs(p.y - n.y) < 1e-4 &&
            Math.abs(p.scale - n.scale) < 1e-4
          );
        })
          ? prev
          : next,
      );
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [urls.length, facts]);

  const focusCard = useCallback((dir: -1 | 1, from: number) => {
    const cards = rootRef.current?.querySelectorAll<HTMLElement>('[role="radio"]');
    if (!cards || cards.length === 0) return;
    const next = (from + dir + cards.length) % cards.length;
    cards[next]?.focus();
  }, []);

  const onFile = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;

      setBusy(true);
      setReport(null);
      try {
        const sizeIssue = checkImportSize(file.name, file.size);
        if (sizeIssue) {
          setReport({ fileName: file.name, ok: false, issues: [sizeIssue] });
          return;
        }

        const kind = classifyImport(file.name);
        if (kind === 'unknown') {
          setReport({
            fileName: file.name,
            ok: false,
            issues: [
              {
                severity: 'error',
                rule: 'container',
                message:
                  `"${file.name}" is not a format the companion importer understands. Bring a 3D ` +
                  `rig as .glb, .gltf or .fbx, or a ZIP of 5×5 sprite sheets.`,
              },
            ],
          });
          return;
        }

        if (kind === 'sprite-zip') {
          const entries = await listZipEntries(file);
          // The existing validator's messages are written to be actionable — surfaced verbatim.
          const sheet = validateSpriteZipManifest(entries);
          setReport({ fileName: file.name, ok: sheet.ok, issues: sheet.issues });
          return;
        }

        setReport(await validateModelFile(file, manifest?.targetHeight ?? TARGET_HEIGHT));
      } finally {
        setBusy(false);
      }
    },
    [manifest],
  );

  const license = manifest?.license ?? null;

  return (
    <div className="x-pick x-ambient" ref={rootRef}>
      <header className="x-pick__head">
        <span className="x-eyebrow">Companion</span>
        <h2 className="x-display x-pick__title">
          Choose who <span className="x-accent-word">studies</span> with you
        </h2>
        <p className="x-pick__lede">
          They will live on your desktop, notice what you are working on, and celebrate when you get
          something right.
        </p>
      </header>

      <div className="x-pick__stage">
        {/* ONE canvas for every preview. Sits behind the cards; the wells are its windows. */}
        {urls.length > 0 && (
          <Canvas
            className="x-pick__canvas"
            /*
             * These four declarations MUST be inline, not in picker.css.
             *
             * R3F builds its container div with `style={{ position: 'relative', width: '100%',
             * height: '100%', overflow: 'hidden', pointerEvents, ...style }}` — an inline style,
             * which beats any stylesheet rule regardless of specificity. Left alone it keeps the
             * canvas in normal flow, where `height: 100%` resolves against an auto-height parent
             * that the canvas itself is helping to size; measured result was a 2392px-tall stage
             * that pushed the cards ~2300px below the fold. Because R3F spreads `...style` LAST,
             * passing them here edits the same declaration instead of losing to it.
             */
            /*
             * `clipPath` is here for a second, different reason from the four above: it is a measured
             * value that changes with the layout, so it belongs with component state rather than in
             * the stylesheet. The stacking itself is CSS (`.x-pick__canvas`), because it is fixed.
             * `pointerEvents: 'none'` is what lets the canvas sit in FRONT of the cards without
             * costing a single click — the cards still own all interaction.
             */
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none', clipPath }}
            /* Capped: a picker is not worth a 4× pixel bill on a retina laptop. */
            dpr={[1, 1.6]}
            gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
            /*
             * A long lens at a derived distance. Locked: no controls are mounted.
             *
             * `rotation` is load-bearing and must not be removed. R3F's camera setup ends with
             * `if (!state.camera && !(cameraOptions != null && cameraOptions.rotation))
             *  camera.lookAt(0, 0, 0)` — so without it, R3F aims the camera at the world origin,
             * tilting it 11.44° down (measured: rotation.x = -0.199684 rad). `placeRigInWindow`
             * derives everything from `2·d·tan(fov/2)`, which is the visible height only for a LEVEL
             * camera, so that tilt silently pushed every figure ~38% of a frame below where the
             * projection expected it: the head projected to -58px, off the top of the frame, leaving
             * a well full of trousers and shoes. Passing any rotation suppresses the lookAt, and
             * [0,0,0] is the level camera the projection already assumes.
             */
            camera={{
              fov: CAM_FOV,
              near: 0.1,
              far: 24,
              position: [0, CAM_HEIGHT, CAM_DISTANCE],
              rotation: [0, 0, 0],
            }}
            onCreated={({ gl }) => {
              gl.toneMapping = THREE.ACESFilmicToneMapping;
              gl.outputColorSpace = THREE.SRGBColorSpace;
              gl.setClearAlpha(0);
            }}
          >
            <Suspense fallback={null}>
              <Scene
                urls={urls}
                activeIndex={activeIndex}
                onMeasured={onMeasured}
                slots={slots}
              />
            </Suspense>
          </Canvas>
        )}

        <div className="x-pick__cards" role="radiogroup" aria-label="Companion">
          {manifest?.companions.map((c, i) => (
            <StockCard
              key={c.id}
              label={c.label}
              sublabel={`${c.clips.length} moves`}
              note={facts[i]?.note ?? null}
              selected={selectedIndex === i}
              focusable={selectedIndex === i || (selectedIndex < 0 && i === 0)}
              onSelect={() => setCharacter(c.rig === 'male' ? 'male' : 'female')}
              onHoverChange={h => setHovered(h ? i : null)}
              onKeyNav={dir => focusCard(dir, i)}
            />
          ))}

          {/* Custom import: a card in the same row, so "bring your own" is a peer, not a footnote. */}
          <div className="x-pick__card x-pick__card--import" role="group" aria-label="Custom companion">
            <div className="x-pick__drop">
              <svg className="x-pick__dropicon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 16V4M12 4L7.5 8.5M12 4l4.5 4.5" />
                <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
              </svg>
              <button
                type="button"
                className="x-pick__browse"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                {busy ? 'Checking…' : 'Bring your own'}
              </button>
              <p className="x-pick__hint">
                A rigged <span className="x-mono">.glb</span> <span className="x-mono">.gltf</span>{' '}
                <span className="x-mono">.fbx</span>, or a ZIP of 5×5 sprite sheets
              </p>
              <input
                ref={fileRef}
                className="x-pick__file"
                type="file"
                accept=".glb,.gltf,.fbx,.zip"
                onChange={e => void onFile(e)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Validator output, verbatim. Errors and warnings are visually distinct because one blocks
          the import and the other does not. */}
      {report && (
        <div
          className={`x-pick__report ${report.ok ? 'is-ok' : 'is-bad'}`}
          role="status"
          aria-live="polite"
        >
          <p className="x-pick__reportHead">
            {report.ok
              ? `${report.fileName} looks right.`
              : `${report.fileName} needs a change before it can be used.`}
          </p>
          {report.issues.length > 0 && (
            <ul className="x-pick__issues">
              {report.issues.map((issue, i) => (
                <li key={i} className={`x-pick__issue is-${issue.severity}`}>
                  <span className="x-pick__rule x-mono">{issue.rule}</span>
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {manifestError && (
        <p className="x-pick__report is-bad" role="status">
          The stock companions could not be loaded: {manifestError}
        </p>
      )}

      {/* CC BY 4.0 obliges us to credit the author wherever the work appears. This is a licence
          term, so it renders whenever the manifest declares one — it is not decoration. */}
      {license && license.requiresAttribution && (
        <footer className="x-pick__credit">
          <span>{attributionText(license)}</span>
          {license.source && (
            <a
              className="x-pick__creditLink"
              href={license.source}
              target="_blank"
              rel="noreferrer noopener"
            >
              {license.pack || 'Source'}
            </a>
          )}
        </footer>
      )}
    </div>
  );
}
