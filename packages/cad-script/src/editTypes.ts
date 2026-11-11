import type { ConstraintCommandTool } from '@wbcnc/cad-editor/constraintCommands';
import type { CadDrawnOn } from '@wbcnc/cad';
import type { CadExpectation } from './inspect';
export type Xy = readonly [number, number];
/** mm, or an expression such as `'width - 2*board'` that keeps following the design's variables. */
export type Len = number | string;
export type LenXy = readonly [Len, Len];
/** A direction in the assembly: X runs left to right, Y front to back, Z up. */
export type CadAxis = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
/** Anything in a sketch: returned when it's made, or looked up with `find` from a handle in the report. */
export interface CadRef {
  id: string;
}
export interface CadRegionRef {
  sketchId: string;
  regionId: string;
}
export interface CadCutRef {
  id: string;
}
export type CadFacePick = 'top' | 'underside' | { floorOf: CadCutRef };
/** One of the studio's base planes. */
export type CadPlane = 'top' | 'front' | 'right';
/** A face of a part that another part can be drawn on, from `part.face(...)`. */
export interface CadPartFace {
  readonly partId: string;
  readonly face: Extract<CadDrawnOn['on'], { partId: string }>['face'];
}

export interface SketchEdit {
  readonly id: string;
  /** Dimensioned and placed, so it's fully constrained. `at` is the lower-left corner; use `center` for the middle. */
  rect(options: { w: Len; h: Len; at?: LenXy; center?: LenXy }): {
    edges: { bottom: CadRef; right: CadRef; top: CadRef; left: CadRef };
    corners: CadRef[];
  };
  /** Dimensioned and placed, so it's fully constrained. */
  circle(options: { at: LenXy; d: Len }): CadRef & { center: CadRef };
  /** A closed loop through these points, each placed so the loop is fully constrained. Corners can then be filleted. */
  polygon(points: readonly Xy[]): { edges: CadRef[]; corners: CadRef[] };
  /**
   * A closed outline of lines and arcs, drawn from `from` and finished with `close()`. Every vertex is placed and each
   * arc has its radius or a tangency, so the loop comes out fully constrained.
   */
  path(from: LenXy): PathEdit;
  /** A single segment with no dimensions, which leaves it free to be constrained. */
  line(from: Xy, to: Xy): CadRef & { start: CadRef; end: CadRef };
  /** Counterclockwise around `at` from `from` degrees to `to` degrees. */
  arc(options: { at: Xy; r: number; from: number; to: number }): CadRef & { center: CadRef; start: CadRef; end: CadRef };
  /** Rounds corners that join two lines, sharing one radius, which can be an expression. */
  fillet(corners: readonly CadRef[], r: Len): CadRef[];
  /** A geometric relation between curves or points, under the same rules as the sketch editor's tools. */
  relate(relation: ConstraintCommandTool, ...items: CadRef[]): void;
  distance(a: CadRef, b: CadRef, value: Len, axis?: 'x' | 'y'): void;
  radius(curve: CadRef, value: Len): void;
  place(point: CadRef, at: LenXy): void;
  /**
   * Copies of these curves in a row, and in rows when `rows` is given, linked so they keep the first one's shape. Pick the
   * copies' regions with `regionAt`. A count can be an expression, rounded down to say how many fit, such as
   * `'(height - 2*margin)/pitch + 1'`. A step along one axis can be one too, such as `[0, 'pitch']`.
   */
  pattern(
    items: readonly (CadRef | { edges: readonly CadRef[] | Record<string, CadRef> })[],
    options: { count: Len; step: LenXy; rows?: { count: Len; step: LenXy } }
  ): void;
  /** Looks up a handle from the report. */
  find(handle: string): CadRef;
  /** The innermost region at a point, as a click picks it. Resolved now to a stable ID, so solving can't move the pick. */
  regionAt(x: number, y: number): CadRegionRef;
}
export interface PathEdit {
  lineTo(to: LenXy): PathEdit;
  /**
   * An arc to `to`. With `r`, it turns counterclockwise unless `clockwise`, the short way round unless `large`. With
   * `tangent`, it carries on smoothly from the segment before it, and its radius follows from where it ends.
   */
  arcTo(to: LenXy, how: { r: Len; clockwise?: boolean; large?: boolean } | { tangent: true }): PathEdit;
  /** Joins the end back to the start with a line, unless it's already there. */
  close(options?: { straight?: boolean }): { edges: CadRef[]; corners: CadRef[] };
}
export interface PartEdit {
  readonly id: string;
  readonly name: string;
  /** The outline sketch. Its outer loop is the part's shape, and inner loops are through-holes unless given a depth. */
  readonly profile: SketchEdit;
  thickness(mm: Len): void;
  /**
   * Relieves the part's inside corners with dogbones for a bit of this diameter, so square-cornered joints close. Corners
   * on the outline of a pocket that runs off the part stay square. `null` takes the relief off.
   */
  relief(diameter: Len | null): void;
  sketchOn(face: CadFacePick): SketchEdit;
  /** An existing face sketch, by its handle in the report. */
  sketch(handle: string): SketchEdit;
  /** `depth` is mm, an expression that follows the variables, or `'through'`. */
  cut(region: CadRegionRef, options: { depth: Len | 'through' }): CadCutRef;
  remove(feature: CadCutRef): void;
  /** Finds an existing cut by its report handle, including cuts whose depth was a number. */
  existingCut(handle: string): ExistingCutEdit;
  /** What this part should measure when finished. A valid design isn't necessarily the one you meant. */
  expect(expectation: CadExpectation): void;
  /**
   * Where the part sits in the assembly: `at` is where its sketch origin goes, and `x` and `y` say which way its sketch
   * axes point there. Its thickness points along x × y. A position given as an expression follows the variables.
   */
  place(options: CadPlaceOptions): void;
  /**
   * Another of this part, placed like `place`. A mirrored copy is the part's mirror image across its sketch's y axis
   * (x becomes -x), for a left and right pair that aren't alike; CAM cuts it as a part of its own. It can be a
   * `cutParts` tool or ordinary Cut out target by itself.
   */
  copy(options: CadPlaceOptions & { mirrored?: boolean; name?: string }): PartCopy;
  /**
   * A face of this part to draw another part on: `'top'`, `'underside'`, or the edge face looking a way in the studio,
   * such as `'+x'`. It's found now, by where the part is, and kept by what it is, so it stays the same face when the part
   * is resized or moved.
   */
  face(which: 'top' | 'underside' | CadAxis): CadPartFace;
  /**
   * Draws this part on a base plane or on another part's face, so it sits there and moves with it. Its sketch's x and y
   * run as the face's do, and its thickness grows out from the face, or into it with `inward`. `offset` moves it along
   * the face's normal. `check` reports each face's frame in words.
   */
  drawOn(on: CadPlane | CadPartFace, options?: { offset?: Len; inward?: boolean }): void;
  /**
   * Copies of the part in a row along a studio axis, `spacing` apart. The count and spacing can follow variables. Each
   * copy can be a `cutParts` tool or ordinary Cut out target by itself; one the count later drops cuts nothing, and the check warns.
   */
  pattern(options: { axis: 'x' | 'y' | 'z'; count: Len; spacing: Len }): readonly PartCopy[];
}
/** One copy of a part, to cut with or into on its own. A source `cutParts` reference includes every copy. */
export interface PartCopy {
  readonly id: string;
  readonly name: string;
  /** A new face sketch on this copy only. Coordinates stay in the source part's local frame. */
  sketchOn(face: CadFacePick): SketchEdit;
  /** Cuts this copy only, using its own face sketch or an existing family region. */
  cut(region: CadRegionRef, options: { depth: Len | 'through' }): CadCutRef;
}
export interface CadPlaceOptions {
  at: readonly [Len, Len, Len];
  x?: CadAxis;
  y?: CadAxis;
}
export interface DesignEdit {
  /** Builds ordinary steps and globally unique variables in a new named folder. */
  folder(name: string, script: CadScript): { id: string; name: string };
  /** Edits an existing folder by name or handle, with part lookup restricted to its members. */
  existingFolder(nameOrHandle: string, script: CadScript): { id: string; name: string };
  /** Finds an existing part by name or report handle. Missing and ambiguous names are errors. */
  part(name: string, options?: { thickness?: Len; relief?: Len }): PartEdit;
  /** Adds a new part explicitly. Duplicate names are refused. */
  newPart(name: string, options?: { thickness?: Len; relief?: Len }): PartEdit;
  /** Finds an existing copy by its own name or handle, never creating a part. */
  existingCopy(nameOrHandle: string): PartCopy;
  /** Finds a feature-list step by its handle or exact label. */
  step(nameOrHandle: string): ScriptStepEdit;
  /** Snapshots a copy as a separate editable part and permanently excludes its pattern position. */
  detachCopy(copy: PartCopy | string, name?: string): PartEdit;
  removePart(part: PartEdit | string): void;
  removeCopy(copy: PartCopy | string): void;
  removePattern(part: PartEdit | string): void;
  removeStep(step: ScriptStepEdit | string): void;
  removeVariable(nameOrHandle: string): void;
  /** Adds a variable, or changes the one with this name, and returns its name. Later values can use it in expressions. */
  variable(name: string, expression: string): string;
  /**
   * Cuts the `with` parts out of the target parts wherever they reach in, with `clearance` mm of room: housings, grooves,
   * rebates and mortises that follow both parts. The clearance grows every side of an opening inside the target and
   * deepens a blind one; a side that runs off the target's edge stays open. With `split`, two parts that cross share the
   * material where they meet instead: `'half'` for a half-lap, `{ fingers: n }` for a finger joint at a corner.
   * `cornerRelief` relieves the inside corners of this step's openings for a round cutter: `{ dogbone: diameter }` with
   * the diameter of the bit that will cut them, or `'off'` for square corners. Left out, the target part's own setting applies.
   */
  cutParts(
    targets: PartEdit | PartCopy | readonly (PartEdit | PartCopy)[],
    options: {
      with: PartEdit | PartCopy | readonly (PartEdit | PartCopy)[];
      clearance?: Len;
      split?: 'half' | { fingers: Len };
      cornerRelief?: 'off' | { dogbone: Len };
    }
  ): void;
  /** An expression's value now: in mm for a length, or a plain number for a count or ratio. */
  value(expression: Len): number;
}
export type CadScript = (design: DesignEdit) => void;

export interface ExistingCutEdit extends CadCutRef {
  depth(value: Len | 'through'): void;
  suppress(value: boolean): void;
  remove(): void;
}
/** Settings that can be changed on an existing feature-list step. Unsupported settings are refused. */
export interface ScriptStepSettings {
  thickness?: Len;
  depth?: Len | 'through';
  clearance?: Len;
  tools?: readonly (PartEdit | PartCopy)[];
  targets?: readonly (PartEdit | PartCopy)[];
  count?: Len;
  spacing?: Len;
  axis?: 'x' | 'y' | 'z';
  offset?: Len;
  radius?: Len;
  suppressed?: boolean;
}
export interface ScriptStepEdit {
  readonly id: string;
  readonly kind: import('@wbcnc/cad').DesignStep['kind'];
  set(settings: ScriptStepSettings): void;
  remove(): void;
}
