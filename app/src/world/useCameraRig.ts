/**
 * Binds the pure `CameraRig` to the R3F camera, and to the pointer.
 *
 * The rig is deliberately Three-free and fully tested (`camera.test.ts`). This hook is the only
 * place the two systems touch, which keeps the contract in one file and keeps the tests honest.
 *
 * Damping note: the rig advances on real elapsed time, not on frame count. On a 144 Hz monitor a
 * frame-count-based spring is 2.4× faster than on 60 Hz — the classic reason motion "feels different
 * on my machine."
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CameraRig, FOV_DEG, type FramingId, type YawPresetId } from './camera';

export interface CameraRigHandle {
  rig: CameraRig;
  /** True on the frame the rig came to rest — a good moment to run deferred work. */
  settledRef: React.MutableRefObject<boolean>;
}

export function useCameraRig(
  preset: YawPresetId,
  framing: FramingId,
  focus: { x: number; y: number; z: number } | null,
): CameraRigHandle {
  const rig = useMemo(() => new CameraRig(preset, framing), []); // eslint-disable-line react-hooks/exhaustive-deps
  const settledRef = useRef(false);
  const { camera, gl } = useThree();

  // Store drives the rig, never the reverse. One-way data flow means a stuck transition can't
  // desync the UI's idea of where the camera is.
  useEffect(() => { rig.goToPreset(preset); }, [preset, rig]);
  useEffect(() => {
    rig.setFraming(framing, focus ?? undefined);
  }, [framing, focus, rig]);

  useEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = FOV_DEG;
      camera.near = 0.5;
      camera.far = 220;
      camera.updateProjectionMatrix();
    }
  }, [camera]);

  // Pointer → nudge. Bound to the canvas element, not the window, so dragging a floating surface
  // over the canvas never leans the camera.
  useEffect(() => {
    const el = gl.domElement;
    let last: { x: number; y: number } | null = null;
    let pointerId: number | null = null;

    const down = (e: PointerEvent) => {
      // Left button only. Right-drag is reserved; middle-drag is a browser scroll gesture.
      if (e.button !== 0) return;
      pointerId = e.pointerId;
      last = { x: e.clientX, y: e.clientY };
      rig.beginDrag();
      // Capture so the lean survives the pointer leaving the canvas mid-drag — without this the
      // camera sticks at whatever angle it had when the cursor crossed the edge.
      el.setPointerCapture(e.pointerId);
    };

    const move = (e: PointerEvent) => {
      if (last === null || e.pointerId !== pointerId) return;
      rig.drag(e.clientX - last.x, e.clientY - last.y);
      last = { x: e.clientX, y: e.clientY };
    };

    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      last = null;
      pointerId = null;
      rig.endDrag();
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [gl, rig]);

  const lookAt = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    rig.update(delta * 1000);
    const pose = rig.pose();
    camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
    lookAt.set(pose.lookAt[0], pose.lookAt[1], pose.lookAt[2]);
    // `up` is a constant on the rig, so roll is structurally impossible.
    const [ux, uy, uz] = rig.up;
    camera.up.set(ux, uy, uz);
    camera.lookAt(lookAt);
    settledRef.current = rig.isSettled;
  });

  return { rig, settledRef };
}
