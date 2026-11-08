import type { CadDocument, CadPlacement } from './types';

export type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

export const CAD_IDENTITY_PLACEMENT: CadPlacement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length];
};
// Rounding keeps whole millimetres whole after a few moves.
const tidy = (value: number) => {
  const rounded = Math.round(value * 1e9) / 1e9;
  return rounded === 0 ? 0 : rounded;
};
// Quarter and half turns stay exact: their quaternions only hold 0, ½, √½ and 1.
const kExact = [0, 0.5, Math.SQRT1_2, 1];
const snap = (value: number) => {
  const exact = kExact.find(candidate => Math.abs(Math.abs(value) - candidate) < 1e-9);
  return exact === undefined ? value : exact === 0 ? 0 : Math.sign(value) * exact;
};

function multiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a,
    [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function rotateVector(q: readonly number[], v: Vec3): Vec3 {
  const [x, y, z, w] = q as Quat;
  // v + 2w(q×v) + 2q×(q×v)
  const t = cross([x, y, z], v).map(c => 2 * c) as Vec3,
    u = cross([x, y, z], t);
  return [v[0] + w * t[0] + u[0], v[1] + w * t[1] + u[1], v[2] + w * t[2] + u[2]];
}

/** The shortest turn that takes direction `from` onto `to`. */
function turnBetween(from: Vec3, to: Vec3): Quat {
  const a = unit(from),
    b = unit(to),
    cosine = dot(a, b);
  if (cosine < -1 + 1e-9) {
    // Opposite: half a turn about any axis square to both, preferring one in the part's plane.
    const axis = unit(Math.abs(a[2]) < 0.9 ? cross(a, [0, 0, 1]) : cross(a, [1, 0, 0]));
    return [axis[0], axis[1], axis[2], 0];
  }
  const [x, y, z] = cross(a, b),
    w = 1 + cosine,
    length = Math.hypot(x, y, z, w);
  return [x / length, y / length, z / length, w / length];
}

/** Where a point of the part, in sketch x, y and height z, ends up in the assembly. */
export function placePoint(placement: CadPlacement | undefined, point: Vec3): Vec3 {
  const { position, rotation } = placement ?? CAD_IDENTITY_PLACEMENT;
  const turned = rotateVector(rotation, point);
  return [turned[0] + position[0], turned[1] + position[1], turned[2] + position[2]];
}

/** The placement as a column-major 4×4 matrix, the order three.js reads. */
export function placementMatrix(placement: CadPlacement | undefined): number[] {
  const { position } = placement ?? CAD_IDENTITY_PLACEMENT,
    rotation = (placement ?? CAD_IDENTITY_PLACEMENT).rotation;
  const x = rotateVector(rotation, [1, 0, 0]),
    y = rotateVector(rotation, [0, 1, 0]),
    z = rotateVector(rotation, [0, 0, 1]);
  return [...x, 0, ...y, 0, ...z, 0, ...position, 1];
}

/** A face of a placed part, as clicked: a point on it and the direction it faces, both in assembly space. */
export interface CadFacePick {
  point: Vec3;
  normal: Vec3;
}

/**
 * Moves a part so the face clicked on it lies flat against the face clicked on another part, facing it, with the two
 * clicked points touching. The part turns as little as it can to get there.
 */
export function placeAgainst(current: CadPlacement | undefined, moving: CadFacePick, target: CadFacePick): CadPlacement {
  const { position, rotation } = current ?? CAD_IDENTITY_PLACEMENT;
  const turn = turnBetween(moving.normal, [-target.normal[0], -target.normal[1], -target.normal[2]]);
  // Turn about the clicked point, then carry that point onto the target's.
  const offset = rotateVector(turn, [position[0] - moving.point[0], position[1] - moving.point[1], position[2] - moving.point[2]]);
  const next = multiply(turn, rotation as Quat),
    length = Math.hypot(...next);
  return {
    position: offset.map((value, i) => tidy(value + target.point[i]!)) as Vec3,
    rotation: next.map(value => snap(value / length)) as Quat,
  };
}

export interface CadPlacementChange {
  partId: string;
  /** None lays the part out with the unplaced parts again. */
  placement: CadPlacement | undefined;
}

/** The document with parts placed, as one edit. Placement is its own edit, so it never touches a part's shape. */
export function setPartPlacements(document: CadDocument, changes: CadPlacementChange[]): CadDocument {
  const byPart = new Map(changes.map(change => [change.partId, change.placement]));
  return {
    ...document,
    revision: document.revision + 1,
    parts: document.parts.map(part => {
      if (!byPart.has(part.id)) return part;
      const next = { ...part, placement: byPart.get(part.id) };
      if (!next.placement) delete next.placement;
      return next;
    }),
  };
}
