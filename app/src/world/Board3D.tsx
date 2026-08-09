/**
 * The board perimeter. A *board*, not 32 loose plates.
 *
 * This is a rebuild. The first pass drew 2.6-wide cards on 4-unit centers, which left a 1.4-unit gap
 * between every tile — so instead of a Monopoly-grammar ring it read as scattered grey slabs on a
 * field, with no edge, no continuity, and nothing naming any space. Per the blueprint (§3, §4) the
 * grammar we borrow is exactly: permanent corners, sides with recognizable meaning, individual
 * action spaces, traversal. All four of those need the ring to be *continuous* and *labelled*.
 *
 * Construction, from outside in:
 *   1. DECK      — one slab under everything, with a rim. This is the thing that makes it a board.
 *   2. TILES     — 32 spaces sized to exactly fill their span, hairline gaps only.
 *   3. STRIPES   — a mode-colored band on each tile's outer edge, the Monopoly color-group cue.
 *   4. LABELS    — the space's real name, on the board, readable at `board` framing.
 *
 * Cost: the deck is 2 meshes. Tiles and stripes are 2 InstancedMeshes (28 actions + 4 corners share
 * geometry within each group). Labels are the one real expense — 32 SDF text meshes via troika — so
 * they are built once and never animated.
 */

import { useMemo, useRef, useLayoutEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Text } from '@react-three/drei';
import {
  BOARD, BOARD_SIZE, SPACES_PER_SIDE, SIDE_MODE, spaceLabel, labelFacingSign, type Space,
} from './board';
import { WORLD_PALETTE, type Theme } from './districtMaterial';

/**
 * Tile footprint, derived from the board rather than hand-picked.
 *
 * A side spans corner-to-corner. It holds one corner-width plus 7 cards, so the card pitch is the
 * remaining length divided by 7 — and the tile is drawn at that pitch minus a hairline gap. This is
 * why the ring closes: the numbers come from the geometry instead of being guessed next to it.
 */
const CORNER_W = 4.4;
const SIDE_SPAN = BOARD_SIZE - CORNER_W;             // usable length between the two corner blocks
const CARD_PITCH = SIDE_SPAN / SPACES_PER_SIDE;
const GAP = 0.07;                                    // hairline. Enough to read as separate tiles.
const CARD_W = CARD_PITCH - GAP;
const CARD_D = 3.6;                                  // depth inward from the rim
const TILE_H = 0.20;

/** The deck: one slab the whole ring sits on, inset so the rim shows as a lip. */
const DECK_H = 0.34;
const RIM = 0.55;

/** Stripe: the mode-color band along the tile's outer edge. Monopoly's color group, one cue only. */
const STRIPE_D = 0.62;
const STRIPE_LIFT = 0.012;

/**
 * How often label orientation is re-tested against the camera.
 *
 * Not every frame: the test is only interesting when the camera crosses a tile's outward axis, which
 * happens a handful of times during a 620 ms dolly. 140 ms is well inside that, and it keeps 32 dot
 * products off the hot path.
 */
const LABEL_ORIENT_INTERVAL_MS = 140;

export interface Board3DProps {
  theme?: Theme;
  /** The space the companion is standing on — gets a subtle lift. */
  companionSpace?: number;
  onSelectSpace?: (index: number) => void;
}

export function Board3D({ theme = 'light', companionSpace = -1, onSelectSpace }: Board3DProps) {
  const p = WORLD_PALETTE[theme];

  const actions = useMemo(() => BOARD.filter(s => s.kind === 'action'), []);
  const corners = useMemo(() => BOARD.filter(s => s.kind === 'corner'), []);

  const actionRef = useRef<THREE.InstancedMesh>(null);
  const cornerRef = useRef<THREE.InstancedMesh>(null);
  const stripeRef = useRef<THREE.InstancedMesh>(null);

  /**
   * Geometry. Rounded, with a small radius — the reference boards are all softened rectangles, and a
   * hard-cornered box at this scale is the single clearest "untextured CAD" tell.
   */
  const cardGeom = useMemo(() => new RoundedBoxGeometry(CARD_W, TILE_H, CARD_D, 2, 0.05), []);
  const cornerGeom = useMemo(() => new RoundedBoxGeometry(CORNER_W, TILE_H * 1.25, CORNER_W, 2, 0.07), []);
  const stripeGeom = useMemo(() => new THREE.BoxGeometry(CARD_W, TILE_H * 0.5, STRIPE_D), []);
  const deckGeom = useMemo(
    () => new RoundedBoxGeometry(BOARD_SIZE + RIM * 2, DECK_H, BOARD_SIZE + RIM * 2, 3, 0.22),
    [],
  );

  /**
   * Tile face: porcelain. Slightly *lighter* than the deck so tiles read as printed onto a board
   * rather than cut out of it, which is how every real board and every reference behaves.
   */
  const cardMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: new THREE.Color(p.stock),
    roughness: 0.62,
    metalness: 0,
  }), [p.stock]);

  // Corners are structural anchors, so they carry the structure color at low mix — present, not loud.
  const cornerMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: new THREE.Color(p.hema).lerp(new THREE.Color(p.stock), 0.78),
    roughness: 0.52,
    metalness: 0,
  }), [p.hema, p.stock]);

  /**
   * The deck reads as frosted glass, not as a solid slab.
   *
   * It is the largest single object in the app, and on a transparent always-on-top window an opaque
   * deck is a grey sheet parked over the student's work — which is the one thing this product must not
   * be. Verified against a synthetic desktop pattern: at full opacity the deck erased it completely.
   *
   * 0.82 rather than something dramatic, because the deck is also what makes 32 loose plates read as
   * one board. Let too much through and the ring dissolves; the desktop should be *sensed* behind the
   * board the way it is sensed behind a frosted panel, not read through it.
   */
  const deckMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: new THREE.Color(p.ground).lerp(new THREE.Color(p.ink), theme === 'light' ? 0.05 : 0.0),
    roughness: 0.85,
    metalness: 0,
    transparent: true,
    opacity: 0.82,
    // Depth writes stay ON: the deck must still occlude the tiles behind it, or the far rim shows
    // through the near one and the board loses its solidity entirely.
  }), [p.ground, p.ink, theme]);

  /**
   * Stripes are per-instance colored, so one material with vertex colors carries all four modes.
   * `toneMapped: false` keeps the mode hues at their authored value — ACES would otherwise desaturate
   * the small colored areas, and the color group is the one thing here that must stay identifiable.
   */
  const stripeMat = useMemo(() => new THREE.MeshStandardMaterial({
    roughness: 0.45,
    metalness: 0,
    toneMapped: false,
  }), []);

  useLayoutEffect(() => () => {
    cardGeom.dispose(); cornerGeom.dispose(); stripeGeom.dispose(); deckGeom.dispose();
    cardMat.dispose(); cornerMat.dispose(); deckMat.dispose(); stripeMat.dispose();
  }, [cardGeom, cornerGeom, stripeGeom, deckGeom, cardMat, cornerMat, deckMat, stripeMat]);

  /** Write instance transforms. Runs on layout, not per frame — the board is static. */
  const place = (
    mesh: THREE.InstancedMesh | null,
    spaces: Space[],
    lift: number,
    inwardOffset = 0,
  ) => {
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const scale = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();

    spaces.forEach((s, i) => {
      q.setFromAxisAngle(up, s.rotationY);
      const y = lift + (s.index === companionSpace ? 0.05 : 0);
      // Offset along the facing normal: tiles sit just inside the rim, stripes sit at their outer edge.
      pos.set(
        s.position[0] + s.facing[0] * inwardOffset,
        y,
        s.position[2] + s.facing[2] * inwardOffset,
      );
      m.compose(pos, q, scale);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  };

  // Tiles are pulled inward by half their depth so their outer edge lands on the board edge, not
  // straddling it. Without this the ring hangs half off the deck.
  const TILE_INSET = -CARD_D / 2 + 0.1;

  useLayoutEffect(() => {
    place(actionRef.current, actions, DECK_H / 2 + TILE_H / 2, TILE_INSET);
  }, [actions, companionSpace]);

  useLayoutEffect(() => {
    place(cornerRef.current, corners, DECK_H / 2 + TILE_H * 0.62, 0);
  }, [corners, companionSpace]);

  // Stripes ride on top of the action tiles, flush to the outer edge.
  useLayoutEffect(() => {
    const mesh = stripeRef.current;
    if (!mesh) return;
    place(mesh, actions, DECK_H / 2 + TILE_H + STRIPE_LIFT, TILE_INSET + CARD_D / 2 - STRIPE_D / 2);
    const c = new THREE.Color();
    actions.forEach((s, i) => {
      c.set(p[SIDE_MODE[s.side]]);
      mesh.setColorAt(i, c);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [actions, companionSpace, p]);

  const handleClick = (spaces: Space[]) => (e: { instanceId?: number; stopPropagation: () => void }) => {
    if (e.instanceId === undefined || !onSelectSpace) return;
    e.stopPropagation();
    const s = spaces[e.instanceId];
    if (s) onSelectSpace(s.index);
  };

  /**
   * Labels. Flat on the board, oriented so every name reads right-side-up from wherever the camera is.
   *
   * The previous fix guessed at this with a position test — `position[2] < -2 || position[0] > 2` —
   * and that is why the board still shipped with mirrored text. The test asks "is this tile on the far
   * side", but a *side* of the board straddles it: the south row runs from x = -16 to x = +16, so the
   * tiles past x = 2 got flipped and the ones before it did not. The result was a single edge whose
   * labels changed direction halfway along it — "Goals" and "Habits" upside down while "Mentor" and
   * "Teamwork" two tiles away read fine. A screenshot shows it instantly; the code reads plausible.
   *
   * Replaced with the geometry instead of a guess. Two facts drive it:
   *
   *   1. A label must lie flat with its normal pointing UP. If the normal points down you are looking
   *      at the back of the text, which is genuinely mirrored rather than merely upside down. Building
   *      the orientation from an explicit basis — right, up, +Y normal — makes that unrepresentable,
   *      where hand-composed Euler angles made it a coin flip.
   *   2. Text reads right-side-up on screen when its baseline-up direction points AWAY from the camera,
   *      because on a raked view the ground direction away from the viewer is the one that maps to
   *      up-screen. So each label's up is whichever of ±facing points away from the camera.
   *
   * The choice is made per SIDE, from the side's own outward axis, never per tile — that is what
   * guarantees an edge can never again reverse direction halfway along itself.
   *
   * It is also re-evaluated as the camera moves, because the rig orbits: a static bake is only correct
   * for one preset, and the labels would read backwards from the others. Re-evaluation mutates the
   * meshes directly on a throttled tick rather than going through React, so 32 labels tracking the
   * camera costs no re-renders.
   */
  const labels = useMemo(() => BOARD.map(s => ({
    space: s,
    text: spaceLabel(s),
    /** Outward ground axis for this space. Labels align to it; only its sign is chosen at runtime. */
    axis: new THREE.Vector3(s.facing[0], 0, s.facing[2]).normalize(),
    position: [
      s.position[0] + s.facing[0] * (s.kind === 'corner' ? 0 : TILE_INSET - 0.15),
      DECK_H / 2 + TILE_H * (s.kind === 'corner' ? 1.25 : 1) + 0.02,
      s.position[2] + s.facing[2] * (s.kind === 'corner' ? 0 : TILE_INSET - 0.15),
    ] as [number, number, number],
  })), []);

  // ── Label orientation, tracking the camera ────────────────────────────────────────────────
  const labelRefs = useRef<Array<THREE.Object3D | null>>([]);
  const orientClock = useRef(Infinity);   // Infinity so the first frame orients immediately.
  const lastSign = useRef<number[]>([]);

  /** Scratch vectors, allocated once. Per-frame `new THREE.Vector3()` is how a scene starts to hitch. */
  const scratch = useMemo(() => ({
    up: new THREE.Vector3(),
    right: new THREE.Vector3(),
    normal: new THREE.Vector3(0, 1, 0),
    camGround: new THREE.Vector3(),
    basis: new THREE.Matrix4(),
  }), []);

  useFrame(({ camera }, delta) => {
    orientClock.current += delta * 1000;
    if (orientClock.current < LABEL_ORIENT_INTERVAL_MS) return;
    orientClock.current = 0;

    // The camera's position flattened to the ground plane: only its bearing matters, not its height.
    scratch.camGround.set(camera.position.x, 0, camera.position.z);

    for (let i = 0; i < labels.length; i++) {
      const l = labels[i]!;
      const mesh = labelRefs.current[i];
      if (!mesh) continue;

      // The decision itself is `labelFacingSign` in board.ts — pure and tested, because this is the
      // logic that shipped mirrored twice.
      const sign = labelFacingSign(l.space, scratch.camGround.x, scratch.camGround.z);
      if (lastSign.current[i] === sign) continue;      // nothing to do until the camera crosses over
      lastSign.current[i] = sign;

      // up = the ground direction away from the camera; right = up × normal keeps the basis
      // right-handed, so the glyphs can never come out reversed.
      scratch.up.copy(l.axis).multiplyScalar(sign);
      scratch.right.copy(scratch.up).cross(scratch.normal);
      scratch.basis.makeBasis(scratch.right, scratch.up, scratch.normal);
      mesh.quaternion.setFromRotationMatrix(scratch.basis);
    }
  });

  return (
    <group>
      {/* The deck. Everything above is printed on this. */}
      <mesh geometry={deckGeom} material={deckMat} position={[0, 0, 0]} receiveShadow />

      <instancedMesh
        ref={actionRef}
        args={[cardGeom, cardMat, actions.length]}
        castShadow
        receiveShadow
        onPointerDown={handleClick(actions)}
      />
      <instancedMesh
        ref={stripeRef}
        args={[stripeGeom, stripeMat, actions.length]}
        castShadow
      />
      <instancedMesh
        ref={cornerRef}
        args={[cornerGeom, cornerMat, corners.length]}
        castShadow
        receiveShadow
        onPointerDown={handleClick(corners)}
      />

      {labels.map((l, i) => (
        <Text
          key={l.space.index}
          // Orientation is set imperatively by the camera-tracking tick above, never as a prop — a
          // `rotation` prop here would be re-applied on every React render and fight that tick.
          ref={(m: THREE.Object3D | null) => { labelRefs.current[i] = m; }}
          position={l.position}
          fontSize={l.space.kind === 'corner' ? 0.52 : 0.34}
          maxWidth={l.space.kind === 'corner' ? CORNER_W * 0.8 : CARD_W * 0.88}
          textAlign="center"
          anchorX="center"
          anchorY="middle"
          lineHeight={1.15}
          letterSpacing={l.space.kind === 'corner' ? 0.02 : -0.005}
          color={l.space.kind === 'corner' ? p.hema : p.ink}
          // Labels are ink on porcelain, not lit surfaces — tone mapping would grey them out.
          material-toneMapped={false}
          outlineWidth={0}
        >
          {l.space.kind === 'corner' ? l.text.toUpperCase() : l.text}
        </Text>
      ))}
    </group>
  );
}
