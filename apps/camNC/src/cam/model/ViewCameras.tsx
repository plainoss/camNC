import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { StudioCameraRef } from '@/cad/studioCamera';

export interface ViewRequest {
  name: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso' | 'fit' | 'normal';
  seq: number;
  /** For `normal`: the way the camera looks from, out of a plane or face, and which way is up on it. For a cube edge or corner: the way it looks from, with Z up. */
  direction?: [number, number, number];
  up?: [number, number, number];
}

const kViewDirections = {
  front: [0, -1, 0],
  back: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  iso: [0.2, -0.75, 1],
} satisfies Record<Exclude<ViewRequest['name'], 'fit' | 'normal'>, [number, number, number]>;

/**
 * Point the camera at the box from the front-right, above (Z up), and orbit around its center. It does so once there's
 * something to see and again when `fitKey` changes, such as on switching to the exploded view, but never because what's
 * shown changed: hiding a part or editing one leaves the camera where it is. Explicit view requests also refit it.
 */
export function FitCamera({
  box,
  fitKey,
  viewRequest,
  cameraState,
  initialDirection,
}: {
  box: THREE.Box3;
  fitKey?: string;
  viewRequest?: ViewRequest;
  cameraState?: StudioCameraRef;
  initialDirection?: [number, number, number];
}) {
  const camera = useThree(s => s.camera) as THREE.PerspectiveCamera | THREE.OrthographicCamera;
  const controls = useThree(s => s.controls) as OrbitControlsImpl | null;
  const aspect = useThree(s => s.size.width / s.size.height);
  const invalidate = useThree(s => s.invalidate);
  const fitted = useRef<{ key?: string; seq?: number; controls: OrbitControlsImpl | null } | null>(null);
  useFrame(() => {
    if (!cameraState || !fitted.current || !controls || !('isOrthographicCamera' in camera)) return;
    cameraState.current = {
      center: controls.target.toArray(),
      back: camera.getWorldDirection(new THREE.Vector3()).negate().toArray(),
      up: new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).toArray(),
      height: (camera.top - camera.bottom) / camera.zoom,
      aspect,
      key: fitKey,
      seq: viewRequest?.seq,
    };
  });
  useEffect(() => {
    // Nothing to see yet, or no size to see it at.
    if (box.isEmpty() || !(aspect > 0) || !Number.isFinite(aspect)) return;
    // Fitted already, for this key and with the controls that orbit it.
    if (fitted.current && fitted.current.key === fitKey && fitted.current.controls === controls && fitted.current.seq === viewRequest?.seq)
      return;
    const saved = (!fitted.current || !fitted.current.controls) && cameraState?.current;
    fitted.current = { key: fitKey, controls, seq: viewRequest?.seq };
    if (saved && saved.key === fitKey && saved.seq === viewRequest?.seq && 'isOrthographicCamera' in camera) {
      const center = new THREE.Vector3(...saved.center);
      camera.position.copy(center).addScaledVector(new THREE.Vector3(...saved.back), 20000);
      camera.up.set(...saved.up);
      camera.lookAt(center);
      camera.zoom = (camera.top - camera.bottom) / saved.height;
      camera.near = 1;
      camera.far = 40000;
      camera.updateProjectionMatrix();
      controls?.target.copy(center);
      controls?.update();
      invalidate();
      return;
    }
    if (controls?.enableDamping) {
      // Finish any orbit or pan still easing out, so it doesn't carry on from the view placed here.
      controls.enableDamping = false;
      controls.update();
      controls.enableDamping = true;
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x / Math.min(aspect, 1.6), size.y, size.z) * 0.62;
    const ortho = 'isOrthographicCamera' in camera;
    const tan = ortho ? 1 : Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    let dist = radius / tan;
    if (ortho && !viewRequest) dist = Math.max(dist, 105);
    const name = viewRequest?.name ?? 'iso';
    const direction =
      name === 'fit'
        ? camera.getWorldDirection(new THREE.Vector3()).negate()
        : name === 'normal' || viewRequest?.direction
          ? new THREE.Vector3(...(viewRequest?.direction ?? [0, 0, 1])).normalize()
          : new THREE.Vector3(...(ortho && !viewRequest ? (initialDirection ?? [0.77, -1, 0.17]) : kViewDirections[name])).normalize();
    if (name === 'normal') camera.up.set(...(viewRequest?.up ?? [0, 1, 0]));
    else if (name !== 'fit') {
      const vertical = Math.abs(direction.z) > 1 - 1e-10;
      camera.up.set(0, vertical ? 1 : 0, vertical ? 0 : 1);
    }
    if (viewRequest) {
      // Fit every corner in the requested camera frame, including its depth toward the camera.
      const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
      const up = new THREE.Vector3().crossVectors(direction, right);
      dist = 0;
      for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z]) {
            const corner = new THREE.Vector3(x, y, z).sub(center);
            dist = Math.max(
              dist,
              (ortho ? 0 : corner.dot(direction)) + Math.max(Math.abs(corner.dot(right)) / (tan * aspect), Math.abs(corner.dot(up)) / tan)
            );
          }
      dist = Math.max(dist * 1.1, 1);
    }
    if (ortho) camera.zoom = (camera.top - camera.bottom) / (dist * 2);
    const reach = ortho ? 20000 : dist;
    camera.position.copy(center).addScaledVector(direction, reach);
    camera.near = ortho ? 1 : dist / 100;
    camera.far = ortho ? 40000 : dist * 20;
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.copy(center);
      controls.update();
    }
    // The view draws only when something changes, and moving the camera is a change.
    invalidate();
  }, [box, camera, controls, aspect, fitKey, viewRequest, invalidate, cameraState, initialDirection]);
  return null;
}

/** A camera looking straight at a sketch's plane, showing exactly what the sketch's drawing shows, as in a sketch's normal view. */
export interface SketchView {
  /** The sketch's frame in the model: its origin, its x and y, and the way its plane faces (the camera's side). */
  origin: [number, number, number];
  x: [number, number, number];
  y: [number, number, number];
  normal: [number, number, number];
  /** The middle of what's shown, and how wide and high, in the sketch's own mm. */
  center: [number, number];
  width: number;
  height: number;
  /** Screen-plane offset in mm when the camera's centre ray doesn't intersect an edge-on sketch plane. */
  shift?: [number, number];
  /** The view's right, up and toward-the-viewer directions in the sketch's frame, once it's turned off straight on. */
  turned?: { right: [number, number, number]; up: [number, number, number]; back: [number, number, number] };
}

export function SketchCamera({ view, model }: { view: SketchView; model: THREE.Matrix4 }) {
  const set = useThree(s => s.set);
  const size = useThree(s => s.size);
  const invalidate = useThree(s => s.invalidate);
  const camera = useMemo(() => new THREE.OrthographicCamera(), []);
  useEffect(() => {
    set({ camera });
  }, [camera, set]);
  useEffect(() => {
    const v = (a: [number, number, number]) => new THREE.Vector3(...a);
    const at = v(view.origin).addScaledVector(v(view.x), view.center[0]).addScaledVector(v(view.y), view.center[1]).applyMatrix4(model);
    // Far enough out along the plane's normal to see everything in front of it, looking back at it.
    const reach = 20000;
    // A direction given in the sketch's frame, in the model's.
    const along = ([a, b, c]: [number, number, number]) =>
      v(view.x).multiplyScalar(a).addScaledVector(v(view.y), b).addScaledVector(v(view.normal), c);
    const right = view.turned ? along(view.turned.right) : v(view.x);
    const up = view.turned ? along(view.turned.up) : v(view.y);
    if (view.shift) at.addScaledVector(right, -view.shift[0]).addScaledVector(up, view.shift[1]);
    camera.position.copy(at).addScaledVector(view.turned ? along(view.turned.back) : v(view.normal), reach);
    camera.up.copy(view.turned ? along(view.turned.up) : v(view.y));
    camera.lookAt(at);
    // A face's frame can be mirrored, its x × y facing away from its normal: the picture is mirrored with it, as its
    // drawing is.
    const mirrored = v([1, 0, 0]).applyQuaternion(camera.quaternion).dot(right) < 0;
    camera.left = ((mirrored ? 1 : -1) * view.width) / 2;
    camera.right = ((mirrored ? -1 : 1) * view.width) / 2;
    camera.top = view.height / 2;
    camera.bottom = -view.height / 2;
    camera.near = 1;
    camera.far = reach * 2;
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, view, model, size, invalidate]);
  return null;
}
