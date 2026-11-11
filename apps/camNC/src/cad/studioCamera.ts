import { cadSketchFrame, type CadDocument, type CadPart } from '@wbcnc/cad';
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { CadViewport } from '@wbcnc/cad-editor/viewState';
import type { SketchTurn } from './sketchOrbit';

type Vec = [number, number, number];
export interface StudioCameraState {
  center: Vec;
  back: Vec;
  up: Vec;
  height: number;
  /** Width over height of the view, so its width is known too. */
  aspect?: number;
  key?: string;
  seq?: number;
}
export interface StudioCameraRef {
  current: StudioCameraState | null;
}
interface Frame {
  origin: Vec;
  x: Vec;
  y: Vec;
  normal: Vec;
}
const v = (a: Vec) => new Vector3(...a);
const basis = (frame: Frame) => new Matrix4().makeBasis(v(frame.x), v(frame.y), v(frame.x).cross(v(frame.y)));

/** Keep the same picture when the drawing takes over from the studio's orbiting camera. */
export function sketchFromCamera(
  camera: StudioCameraState,
  frame: Frame,
  aspect: number
): { view: CadViewport; turn: SketchTurn; shift: [number, number] } {
  const back = v(camera.back).normalize();
  const normal = v(frame.x).cross(v(frame.y)).normalize();
  const denominator = back.dot(normal);
  const up = v(camera.up).addScaledVector(back, -v(camera.up).dot(back)).normalize();
  const right = up.clone().cross(back).normalize();
  // Edge-on, the centre ray never meets the plane. Keep its screen offset instead of snapping the camera normal to it.
  const at =
    Math.abs(denominator) < 1e-6
      ? v(camera.center).addScaledVector(normal, v(frame.origin).sub(v(camera.center)).dot(normal))
      : v(camera.center).addScaledVector(back, v(frame.origin).sub(v(camera.center)).dot(normal) / denominator);
  const delta = at.clone().sub(v(camera.center));
  const shift: [number, number] = [delta.dot(right), -delta.dot(up)];
  const relative = at.sub(v(frame.origin));
  const x = relative.dot(v(frame.x)),
    y = relative.dot(v(frame.y));
  const rotation = basis(frame)
    .transpose()
    .multiply(new Matrix4().makeBasis(right, up, back));
  const turn = new Quaternion().setFromRotationMatrix(rotation).toArray() as [number, number, number, number];
  const h = camera.height,
    w = h * aspect;
  return { view: { x: x - w / 2, y: -y - h / 2, w, h }, turn, shift };
}

/** The drawing's pan, zoom and orbit become the studio's camera when the sketch closes. */
export function cameraFromSketch(
  frame: Frame,
  view: CadViewport,
  turn: SketchTurn,
  previous?: StudioCameraState | null,
  shift: [number, number] = [0, 0]
): StudioCameraState {
  const world = basis(frame).multiply(new Matrix4().makeRotationFromQuaternion(new Quaternion(...turn)));
  return {
    center: v(frame.origin)
      .addScaledVector(v(frame.x), view.x + view.w / 2)
      .addScaledVector(v(frame.y), -(view.y + view.h / 2))
      .addScaledVector(new Vector3().setFromMatrixColumn(world, 0), -shift[0])
      .addScaledVector(new Vector3().setFromMatrixColumn(world, 1), shift[1])
      .toArray(),
    back: new Vector3().setFromMatrixColumn(world, 2).toArray(),
    up: new Vector3().setFromMatrixColumn(world, 1).toArray(),
    height: view.h,
    key: previous?.key,
    seq: previous?.seq,
  };
}

/** Read the camera from either 3D viewport before its canvas is unmounted. */
export function carriedSketchCamera(
  document: CadDocument,
  part: CadPart | undefined,
  camera: StudioCameraState | null,
  root: HTMLElement | null
) {
  const frame = part && cadSketchFrame(document, part);
  const bounds = root?.querySelector('[data-testid="workspace-3d"] canvas, [data-testid="part-3d"] canvas')?.getBoundingClientRect();
  return camera && frame && bounds?.height ? sketchFromCamera(camera, frame, bounds.width / bounds.height) : null;
}

/** Save the drawing's actual letterboxed viewport before returning to the 3D canvas. */
export function captureSketchCamera(
  document: CadDocument,
  part: CadPart | undefined,
  camera: StudioCameraRef,
  view: CadViewport,
  turn: SketchTurn,
  shift: [number, number],
  box: { width: number; height: number } | null
) {
  const frame = part && cadSketchFrame(document, part);
  if (!frame || !box?.height) return;
  const scale = Math.min(box.width / view.w, box.height / view.h);
  camera.current = cameraFromSketch(
    frame,
    {
      x: view.x + view.w / 2 - box.width / scale / 2,
      y: view.y + view.h / 2 - box.height / scale / 2,
      w: box.width / scale,
      h: box.height / scale,
    },
    turn,
    camera.current,
    shift
  );
}
