import type { CadDocument, CadPlacement, CadTurn } from './types';

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

/** The placement turned by `degrees` about an axis through `point`, counterclockwise looking against `axis`. */
export function turnAbout(current: CadPlacement | undefined, point: Vec3, axis: Vec3, degrees: number): CadPlacement {
  const { position, rotation } = current ?? CAD_IDENTITY_PLACEMENT;
  const [x, y, z] = unit(axis),
    half = (degrees * Math.PI) / 360,
    turn: Quat = [x * Math.sin(half), y * Math.sin(half), z * Math.sin(half), Math.cos(half)];
  const offset = rotateVector(turn, [position[0] - point[0], position[1] - point[1], position[2] - point[2]]);
  return {
    position: offset.map((value, i) => tidy(value + point[i]!)) as Vec3,
    rotation: multiply(turn, rotation as Quat).map(snap) as Quat,
  };
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

/** A turn as an axis and an angle, or none for no turn at all. */
function asTurn(about: Vec3, turn: Quat): CadTurn | undefined {
  const sine = Math.hypot(turn[0], turn[1], turn[2]);
  if (sine < 1e-9) return undefined;
  const degrees = tidy((2 * Math.atan2(sine, turn[3]) * 180) / Math.PI);
  return { about, axis: [turn[0] / sine, turn[1] / sine, turn[2] / sine].map(tidy) as Vec3, degrees };
}

/** A point and direction on a moved part, back where they were before `turn` and `by` moved it. */
export function unmovedPick(pick: CadFacePick, moved: { by: Vec3; turn?: CadTurn } | undefined): CadFacePick {
  if (!moved) return pick;
  const point: Vec3 = [pick.point[0] - moved.by[0], pick.point[1] - moved.by[1], pick.point[2] - moved.by[2]];
  if (!moved.turn) return { point, normal: pick.normal };
  const back = turnAbout(CAD_IDENTITY_PLACEMENT, [0, 0, 0], moved.turn.axis, -moved.turn.degrees).rotation;
  const { about } = moved.turn;
  const offset = rotateVector(back, [point[0] - about[0], point[1] - about[1], point[2] - about[2]]);
  return { point: offset.map((value, i) => value + about[i]!) as Vec3, normal: rotateVector(back, pick.normal) };
}

/**
 * The move that mates a part's connector `from` to another's `to`, as the reference's mate connectors do: the part turns
 * about `from` so the two faces meet, facing each other, then moves so the two points touch.
 */
export function mateMove(from: CadFacePick, to: CadFacePick): { by: Vec3; turn?: CadTurn } {
  const turn = asTurn(from.point, turnBetween(from.normal, [-to.normal[0], -to.normal[1], -to.normal[2]]));
  return { by: to.point.map((value, i) => tidy(value - from.point[i]!)) as Vec3, ...(turn && { turn }) };
}

export interface CadPlacementChange {
  partId: string;
  /** One of the part's copies, rather than the part itself. */
  copyId?: string;
  /** None lays the part out with the unplaced parts again. */
  placement: CadPlacement | undefined;
}

const placed = <T extends { placement?: CadPlacement }>(item: T, placement: CadPlacement | undefined): T => {
  const next = { ...item, placement };
  if (!placement) delete next.placement;
  return next;
};

/** The document with parts and copies placed, as one edit. Placement is its own edit, so it never touches a part's shape. */
export function setPartPlacements(document: CadDocument, changes: CadPlacementChange[]): CadDocument {
  return {
    ...document,
    revision: document.revision + 1,
    parts: document.parts.map(part => {
      const own = changes.filter(change => change.partId === part.id);
      if (!own.length) return part;
      let next = part;
      for (const change of own)
        next = change.copyId
          ? { ...next, copies: next.copies?.map(copy => (copy.id === change.copyId ? placed(copy, change.placement) : copy)) }
          : placed(next, change.placement);
      return next;
    }),
  };
}

/** A rotation's quaternion from where it turns the x, y and z axes. */
function quaternionOf([x, y, z]: [Vec3, Vec3, Vec3]): Quat {
  const trace = x[0] + y[1] + z[2];
  let q: Quat;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(y[2] - z[1]) / s, (z[0] - x[2]) / s, (x[1] - y[0]) / s, s / 4];
  } else if (x[0] > y[1] && x[0] > z[2]) {
    const s = Math.sqrt(1 + x[0] - y[1] - z[2]) * 2;
    q = [s / 4, (y[0] + x[1]) / s, (z[0] + x[2]) / s, (y[2] - z[1]) / s];
  } else if (y[1] > z[2]) {
    const s = Math.sqrt(1 + y[1] - x[0] - z[2]) * 2;
    q = [(y[0] + x[1]) / s, s / 4, (z[1] + y[2]) / s, (z[0] - x[2]) / s];
  } else {
    const s = Math.sqrt(1 + z[2] - x[0] - y[1]) * 2;
    q = [(z[0] + x[2]) / s, (z[1] + y[2]) / s, s / 4, (x[1] - y[0]) / s];
  }
  const length = Math.hypot(...q);
  return q.map(value => snap(value / length)) as Quat;
}

/**
 * Where a part's mirror image across a plane goes, as a copy that's mirrored in its own sketch (x turned to -x): the
 * mirrored part's sketch axes are the part's reflected, with x reversed so the turn stays a rotation.
 */
export function mirroredPlacement(placement: CadPlacement, plane: { origin: Vec3; normal: Vec3 }): CadPlacement {
  const n = unit(plane.normal);
  const reflect = (v: Vec3): Vec3 => {
    const along = 2 * dot(v, n);
    return [v[0] - along * n[0], v[1] - along * n[1], v[2] - along * n[2]];
  };
  const [x, y, z] = (
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ] as Vec3[]
  ).map(axis => reflect(rotateVector(placement.rotation, axis)));
  const from = placement.position.map((value, axis) => value - plane.origin[axis]!) as Vec3;
  const position = reflect(from).map((value, axis) => tidy(value + plane.origin[axis]!)) as Vec3;
  return { position, rotation: quaternionOf([x!.map(value => -value) as Vec3, y!, z!]) };
}
