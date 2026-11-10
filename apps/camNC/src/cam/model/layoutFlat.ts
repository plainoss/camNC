import * as THREE from 'three';
import type { BodyMesh, CamPartInfo } from '../camTypes';

const kGap = 30;

/**
 * Where each body goes in the "laid flat" view: rows by thickness (thickest first), wrapping like a shelf so the
 * spread stays roughly square. Returns a model→world matrix per body.
 */
export function layoutFlat(meshes: BodyMesh[], parts: CamPartInfo[]): THREE.Matrix4[] {
  const partById = new Map(parts.map(p => [p.id, p]));
  const order = meshes
    .map((m, i) => ({ i, part: partById.get(m.partId)! }))
    .sort((a, b) => b.part.thickness - a.part.thickness || b.part.size[0] - a.part.size[0]);
  const totalArea = order.reduce((s, o) => s + (o.part.size[0] + kGap) * (o.part.size[1] + kGap), 0);
  const maxRow = Math.max(Math.sqrt(totalArea) * 1.3, ...order.map(o => o.part.size[0]));
  const out: THREE.Matrix4[] = [];
  let x = 0,
    y = 0,
    rowH = 0,
    maxX = 0,
    rowT: number | undefined;
  for (const { i, part } of order) {
    const [w, h] = part.size;
    if (x > 0 && (x + w > maxRow || part.thickness !== rowT)) {
      x = 0;
      y -= rowH + kGap;
      rowH = 0;
    }
    rowT = part.thickness;
    out[i] = new THREE.Matrix4().makeTranslation(x, y - h, 0).multiply(new THREE.Matrix4().fromArray(meshes[i].flat));
    x += w + kGap;
    maxX = Math.max(maxX, x - kGap);
    rowH = Math.max(rowH, h);
  }
  // Centered on the origin: <Bounds> keeps the camera's direction to the center, so an off-center layout would be
  // seen from the side.
  const center = new THREE.Matrix4().makeTranslation(-maxX / 2, -(y - rowH) / 2, 0);
  return out.map(m => center.clone().multiply(m));
}

/** The model as designed, centered on the origin (see layoutFlat). */
export function centerAssembled(meshes: BodyMesh[]): THREE.Matrix4 {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const m of meshes) for (let i = 0; i < m.positions.length; i += 3) box.expandByPoint(v.fromArray(m.positions, i));
  const c = box.getCenter(new THREE.Vector3());
  return new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z);
}

/** How far the exploded view pulls parts out: a share of each one's distance from the middle, plus a share of the model's size. */
const kExplodeScale = 0.6;
const kExplodeReach = 0.2;

/**
 * The model as designed, centered, with each part pulled out from the middle so the joints between them show. Parts
 * that touch always come apart, however close their centers are.
 */
export function explodeAssembled(meshes: BodyMesh[], assembled = centerAssembled(meshes)): THREE.Matrix4[] {
  const boxes = meshes.map(m => {
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < m.positions.length; i += 3) box.expandByPoint(v.fromArray(m.positions, i));
    return box;
  });
  const whole = boxes.reduce((all, box) => all.union(box), new THREE.Box3()),
    middle = whole.getCenter(new THREE.Vector3()),
    reach = whole.getSize(new THREE.Vector3()).length() * kExplodeReach;
  return boxes.map((box, i) => {
    const away = box.getCenter(new THREE.Vector3()).sub(middle);
    // A part right in the middle goes up or down, alternating, so a stack still separates.
    const direction = away.lengthSq() > 1e-6 ? away.clone().normalize() : new THREE.Vector3(0, 0, i % 2 ? -1 : 1);
    const offset = away.multiplyScalar(kExplodeScale).addScaledVector(direction, meshes.length > 1 ? reach : 0);
    return new THREE.Matrix4().makeTranslation(offset.x, offset.y, offset.z).multiply(assembled);
  });
}

/** Explosion only translates parts, preserving each part's orientation and the studio's origin. */
export function interpolateExplosion(assembled: THREE.Matrix4, exploded: THREE.Matrix4[], progress: number): THREE.Matrix4[] {
  const amount = Math.min(1, Math.max(0, progress));
  const start = new THREE.Vector3().setFromMatrixPosition(assembled);
  return exploded.map(matrix => {
    const position = new THREE.Vector3().setFromMatrixPosition(matrix).lerp(start, 1 - amount);
    return assembled.clone().setPosition(position);
  });
}
