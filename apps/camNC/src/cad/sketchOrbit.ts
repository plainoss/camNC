/**
 * How far an open sketch's view is turned away from looking straight at its plane, as a unit quaternion `[x, y, z, w]`
 * in the plane's own frame: x along the drawing's right, y along its up, z out of the plane toward the viewer. The view
 * only turns when it's dragged or `n` is pressed, as in the reference.
 */
export type SketchTurn = readonly [number, number, number, number];

export const straightOn: SketchTurn = [0, 0, 0, 1];

type Vector = [number, number, number];

const multiply = (a: SketchTurn, b: SketchTurn): SketchTurn => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

const about = (axis: Vector, angle: number): SketchTurn => {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};

const rotate = ([x, y, z, w]: SketchTurn, [vx, vy, vz]: Vector): Vector => {
  // v + 2w(q × v) + 2q × (q × v)
  const cx = y * vz - z * vy,
    cy = z * vx - x * vz,
    cz = x * vy - y * vx;
  return [vx + 2 * (w * cx + y * cz - z * cy), vy + 2 * (w * cy + z * cx - x * cz), vz + 2 * (w * cz + x * cy - y * cx)];
};

/** The view's right, up and toward-the-viewer directions, in the plane's frame. */
export const turnAxes = (turn: SketchTurn) => ({
  right: rotate(turn, [1, 0, 0]),
  up: rotate(turn, [0, 1, 0]),
  back: rotate(turn, [0, 0, 1]),
});

/** Radians the view turns for each pixel dragged. */
const kPerPixel = Math.PI / 400;

/** The view turned by a drag of `dx`, `dy` pixels: sideways about the view's up, up and down about its right. */
export function turnedBy(turn: SketchTurn, dx: number, dy: number): SketchTurn {
  if (!dx && !dy) return turn;
  const { right, up } = turnAxes(turn);
  const length = Math.hypot(dx, dy);
  // Dragging right swings the far side of the plane toward the viewer, as orbiting does.
  const axis = [0, 1, 2].map(i => (up[i]! * dx + right[i]! * dy) / length) as Vector;
  const next = multiply(about(axis, -length * kPerPixel), turn);
  const size = Math.hypot(...next);
  return next.map(value => value / size) as unknown as SketchTurn;
}

const isStraightOn = (turn: SketchTurn) => Math.abs(turn[3]) > 0.9999;

/** `n`: straight at the plane, or when already there, straight at its other side. */
export const normalTurn = (turn: SketchTurn): SketchTurn => (isStraightOn(turn) ? [0, 1, 0, 0] : straightOn);

/**
 * How the drawing, laid out flat as if seen straight on, lands on screen once the view is turned: the 2D part of the
 * projection, about the drawing's centre, as a CSS `matrix(a, b, c, d, 0, 0)`. Screen and drawing both run y down.
 */
export function drawingMatrix(turn: SketchTurn): [number, number, number, number] {
  const { right, up } = turnAxes(turn);
  // A drawing point (x, y down) is the plane point (x, -y); the screen shows its right and up components, y down.
  return [right[0], -up[0], -right[1], up[1]];
}

/** Whether the plane is seen too nearly edge-on to draw on: a click couldn't say where on it it is. */
export const edgeOn = (turn: SketchTurn) => {
  const [a, b, c, d] = drawingMatrix(turn);
  return Math.abs(a * d - b * c) < 0.05;
};
