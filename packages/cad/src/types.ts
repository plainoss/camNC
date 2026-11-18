import type { CadConstruction } from './constructionTypes';

/** CAD source is independent of the solver and the CAM tessellation. All lengths are mm. */
export interface CadPoint {
  x: number;
  y: number;
}

interface EntityBase {
  id: string;
  construction?: boolean;
  /** An edge of the face the part is drawn on, kept where that face is. It can't be edited, only drawn onto. */
  faceEdge?: boolean;
  /** A face edge taken into the drawing with Use: part of its outline rather than construction, still kept on the face. */
  taken?: true;
}
export interface CadPointEntity extends EntityBase, CadPoint {
  type: 'point';
  fixed?: boolean;
  /**
   * Used from another part's corner, as the reference's Use: the point stays where that corner is seen on this sketch's
   * plane, on the part's top or its bottom, and follows it when that part changes.
   */
  used?: { partId: string; copyId?: string; pointId: string; side: 'top' | 'bottom' };
  /** Explicit Point-tool geometry survives removal of curves that reuse it. */
  standalone?: boolean;
}
export interface CadLineEntity extends EntityBase {
  type: 'line';
  startId: string;
  endId: string;
  /** A selectable spline tangent segment reuses its parent's real point parameters. */
  owner?: CadSplineHandleOwner;
}
export interface CadSplineHandleOwner {
  type: 'splineHandle';
  splineId: string;
  end: 'start' | 'end';
}
export interface CadCircleEntity extends EntityBase {
  type: 'circle';
  centerId: string;
  radius: number;
}
/** Arcs run counterclockwise from startAngle to endAngle (radians, with wraparound). */
export interface CadArcEntity extends EntityBase {
  type: 'arc';
  centerId: string;
  startId: string;
  endId: string;
  radius: number;
  startAngle: number;
  endAngle: number;
}
/** Exact rational quadratic; rho=.5 is parabolic, lower values elliptic, higher hyperbolic. */
export interface CadConicEntity extends EntityBase {
  type: 'conic';
  startId: string;
  endId: string;
  controlId: string;
  rho: number;
}
/** A clamped Bezier curve; its degree is controlPointIds.length - 1. */
export interface CadBezierEntity extends EntityBase {
  type: 'bezier';
  startId: string;
  endId: string;
  controlPointIds: string[];
}
/** Native B-spline geometry interpolating its separately editable fit points. */
export interface CadSplineEntity extends EntityBase {
  type: 'spline';
  startId: string;
  endId: string;
  controlPointIds: string[];
  fitPointIds: string[];
  fitParameters: number[];
  degree: number;
  /** Full knot vector, including repeated knots. Closed splines use a wrapped periodic basis. */
  knots: number[];
  weights: number[];
  closed?: boolean;
}
/** Native ellipse with selectable diameter endpoints maintained by the solver. */
export interface CadEllipseEntity extends EntityBase {
  type: 'ellipse';
  centerId: string;
  focusId: string;
  majorStartId: string;
  majorEndId: string;
  minorStartId: string;
  minorEndId: string;
  /** Semi-minor radius. */
  radius: number;
  /** Which diameter was placed first, for sequential creation values. */
  primaryAxis: 'major' | 'minor';
}
export type CadNurbsEntity = CadConicEntity | CadBezierEntity | CadSplineEntity | CadEllipseEntity;
export type CadEntity = CadPointEntity | CadLineEntity | CadCircleEntity | CadArcEntity | CadNurbsEntity;

interface ConstraintBase {
  id: string;
  label?: string;
}
/** User placement in a dimension's geometric frame; independent of camera scale. */
export type CadDimensionPlacement =
  | {
      kind: 'linear';
      fraction: number;
      normalOffset: number;
      /** Signed endpoint overshoot in millimetres. */
      overshoot?: number;
    }
  | {
      kind: 'radial';
      angle: number;
      radiusRatio: number;
      /** Fixed radial residual in millimetres, added after bounded radius scaling. */ radiusOffset?: number;
    }
  | { kind: 'angle'; radius: number; angleOffset: number }
  /** Offset from the frame's origin, for a frame without a usable span. */
  | { kind: 'fallback'; offset: CadPoint }
  /** Sketch coordinates, for a dimension whose geometry gives no frame (a missing reference). */
  | { kind: 'absolute'; position: CadPoint };
interface DimensionBase extends ConstraintBase {
  labelPlacement?: CadDimensionPlacement;
  /** A reference measurement does not add solver equations or remove freedom. */
  driven?: boolean;
  /** The value as typed. When it uses design variables it drives the value; otherwise it's only shown. The value is always the last good result. */
  expression?: string;
}

/** One signed driver owns the complete family of copied offset supports. */
export type CadOffsetMember =
  | { kind: 'line' | 'arc'; sourceId: string; targetId: string; side: 1 | -1; endpoints: boolean }
  | { kind: 'circle'; sourceId: string; targetId: string; side: 1 | -1 };

/** Logical cell IDs survive count edits and deletion exclusions; inactive IDs remain reserved. */
export interface CadPatternInstance {
  x: number;
  y: number;
  idMap: Record<string, string>;
  activeIds: string[];
  constructionOverrides?: Record<string, boolean>;
}
export interface CadPatternExclusion {
  seedKey: string;
  x: number;
  y: number;
}
interface CadPatternBase extends ConstraintBase {
  seedKeys: string[];
  masterX: number;
  masterY: number;
  countX: number;
  countY: number;
  instances: CadPatternInstance[];
  exclusions: CadPatternExclusion[];
}

export interface CadLinearPattern extends CadPatternBase {
  type: 'linearPattern';
  stepX: CadPoint;
  stepY: CadPoint;
  /** Counts and spacings as typed, kept when they use design variables so the pattern follows them. */
  expressions?: CadLinearPatternExpressions;
}
/** A count rounds down, so it can say how many fit. A spacing keeps its direction and sets its length in mm. */
export interface CadLinearPatternExpressions {
  countX?: string;
  countY?: string;
  spacingX?: string;
  spacingY?: string;
}
export interface CadCircularPattern extends CadPatternBase {
  type: 'circularPattern';
  centerId: string;
  /** Signed overall sweep in degrees. Closed patterns divide it by count; open patterns by count minus one. */
  angle: number;
  closed: boolean;
}
export type CadSketchPattern = CadLinearPattern | CadCircularPattern;
export type CadSlotMember =
  | { kind: 'line' | 'arc'; sourceId: string; targetId: string; side: 1 | -1; normalEnds: ('start' | 'end')[] }
  | { kind: 'circle'; sourceId: string; targetId: string; side: 1 | -1 };
export interface CadSlot extends ConstraintBase {
  type: 'slot';
  sourceIds: string[];
  generatedIds: string[];
  idMap: Record<string, string>;
  widthEntityId: string;
  members: CadSlotMember[];
  capIds: string[];
}
export type CadConstraint =
  | CadSketchPattern
  | CadSlot
  | (ConstraintBase & { type: 'symmetricCurves'; entityAId: string; entityBId: string; lineId: string; focusSign?: 1 | -1 })
  | (ConstraintBase & { type: 'regularPolygon'; circleId: string; edgeIds: string[]; mode: 'inscribed' | 'circumscribed' })
  | (ConstraintBase & { type: 'horizontal' | 'vertical'; entityId: string })
  | (ConstraintBase & { type: 'horizontalPoints' | 'verticalPoints'; pointAId: string; pointBId: string })
  | (ConstraintBase & { type: 'coincident'; pointAId: string; pointBId: string })
  | (ConstraintBase & { type: 'symmetricPoints'; pointAId: string; pointBId: string; lineId: string })
  | (ConstraintBase & { type: 'pointOnLine' | 'pointOnCircle' | 'midpoint'; pointId: string; entityId: string })
  | (ConstraintBase & { type: 'pointOnCurve'; pointId: string; entityId: string; parameter: number; parameterFixed?: boolean })
  | (DimensionBase & {
      type: 'distance' | 'distanceX' | 'distanceY';
      pointAId: string;
      pointBId: string;
      value: number;
      /** A dimension created from a line is deleted with that line; explicit point-pair dimensions omit this. */
      sourceEntityId?: string;
    })
  | (DimensionBase & {
      type: 'pointArcDistance';
      pointId: string;
      entityId: string;
      value: number;
      side: 'inside' | 'outside';
      radiusSide?: 'near' | 'far';
    })
  | (DimensionBase & {
      type: 'lineCircleDistance';
      entityAId: string;
      entityBId: string;
      value: number;
      side: 'inside' | 'outside';
      radiusSide?: 'near' | 'far';
    })
  | (DimensionBase & {
      type: 'circleCircleDistance';
      entityAId: string;
      entityBId: string;
      value: number;
      radiusASign: 1 | -1;
      radiusBSign: 1 | -1;
      direction: 1 | -1;
      /** Between circles with one centre: the angle, in radians, of the common radius the dimension is drawn along. */
      angle?: number;
    })
  | (DimensionBase & { type: 'pointLineDistance'; pointId: string; entityId: string; value: number })
  /** A normal distance between two infinite lines also requires their parallelism. */
  | (DimensionBase & { type: 'lineLineDistance'; entityAId: string; entityBId: string; value: number })
  | (DimensionBase & { type: 'radius' | 'diameter'; entityId: string; value: number })
  | (DimensionBase & { type: 'positionX' | 'positionY'; pointId: string; value: number })
  | (DimensionBase & { type: 'offset'; value: number; members: CadOffsetMember[] })
  | (ConstraintBase & { type: 'parallel' | 'perpendicular' | 'equal' | 'tangent'; entityAId: string; entityBId: string })
  /** Angle values use degrees in the document, unlike entity arc angles. */
  | (DimensionBase & {
      type: 'angle';
      entityAId: string;
      entityBId: string;
      value: number;
      orientation?: 1 | -1;
      reversedA?: boolean;
      reversedB?: boolean;
    });
export type CadDimension = Extract<CadConstraint, { value: number }>;
export type NewCadDimension = CadDimension extends infer C ? (C extends CadDimension ? Omit<C, 'id'> & { id?: string } : never) : never;
export type CadDimensionMode = 'auto' | 'distance' | 'distanceX' | 'distanceY' | 'angle';
export type NewCadConstraint = CadConstraint extends infer C ? (C extends CadConstraint ? Omit<C, 'id'> & { id?: string } : never) : never;

export interface CadSketch {
  id: string;
  entities: CadEntity[];
  constraints: CadConstraint[];
}
export interface CadPart {
  id: string;
  name: string;
  /** The feature list's names for this part's sketch and its extrude, when renamed there. Renaming either leaves the part's name alone. */
  sketchName?: string;
  extrudeName?: string;
  thickness: number;
  /** The thickness as typed, kept when it uses design variables. */
  thicknessExpression?: string;
  sketch: CadSketch;
  /**
   * `false` while the sketch is finished but not extruded: a sketch feature, not yet a part. It's left out of the parts,
   * the 3D view and machining until Extrude makes a part of it.
   */
  extrude?: false;
  /**
   * Moved by a transform without copying, as the reference's Transform does with Copy part off: by X, Y and Z, or a
   * distance along a picked direction. Applied after the part is placed on its plane or face, so it moves with that face.
   */
  moved?:
    | {
        by: [number, number, number];
        byExpressions?: [string | null, string | null, string | null];
        /** Turned first, as Rotate and mate connectors turn a part, then moved by `by`. */
        turn?: CadTurn;
      }
    | (CadDirection & { distance: number });
  /**
   * Extruded up to a plane or a part's face instead of a typed thickness: the thickness is the distance from the sketch's
   * plane to it, and follows it when it moves.
   */
  upTo?: CadDrawnOn['on'];
  /** A plane made to sketch on that the extrude goes up to, offset from `upTo`; it follows that plane. */
  upToDatum?: string;
  /** Extruded half to each side of the sketch's plane. */
  symmetric?: true;
  /** Its extrude switched off in the feature list: its sketch stays, as a sketch not yet extruded does. */
  suppressed?: true;
  /**
   * The regions of the sketch extruded, by their stable IDs. Left out, the whole sketch is: its outer outline, with the
   * loops inside it as holes.
   */
  regions?: string[];
  /**
   * Another part's or sketch feature's ID, whose sketch this one extrudes instead of its own, as the reference extrudes
   * one sketch several times. Its `sketch` is a copy the design keeps in step with that one (`resolveExtrudeSteps`), so
   * editing the sketch there carries through; it's never edited here.
   */
  sketchOf?: string;
  /**
   * The New extrude, of another part, that also made this part: of regions of that extrude's sketch that lie apart from
   * its own. That extrude is one feature making several parts, listed once; this part follows its settings
   * (`resolveExtrudeSteps`) and is edited through it.
   */
  extrudedWith?: string;
  /** Extrudes the solid face named by drawnOn; its profile follows that face without a separate sketch step. */
  faceProfile?: boolean;
  /**
   * Extrude → Add: the picked regions join this part, extruded from the same sketch, rather than making a part of
   * their own. The step isn't a part itself. An empty string is an Add waiting for a merge scope.
   */
  addTo?: string;
  /**
   * Extrude → Add with Merge with all: a part of its own that joins, with them, every earlier part it runs into, as a
   * Boolean › Union of them would. It has no `addTo`; running into none, it stays a part of its own.
   */
  mergeAll?: true;
  /**
   * Extrude › Intersect: of the parts before it, only what this extrude shares with them is kept, in the place of the one
   * it runs into. One that runs into none leaves no part at all, and says so.
   */
  intersect?: true;
  /**
   * Extrude → Remove: the picked regions, or every closed region but what's left of the face, are cut into the board
   * the sketch is drawn on, this deep. A plane-based extrusion removes its volume from earlier bodies, optionally
   * limited to `targets`. The step isn't a part itself.
   */
  remove?: { depth: CadCutDepth; depthExpression?: string; targets?: string[] };
  /**
   * A Hole step: a Remove whose sketch's points are the holes' centres, each cut as a round hole this wide, as deep as
   * `remove` says. The sketch's lines and curves only place the points.
   */
  hole?: { diameter: number; diameterExpression?: string };
  /**
   * Fillet steps: the part's edges through its thickness, at these corners of its sketch, rounded to a radius. The sketch
   * itself keeps its sharp corners; the part is rounded where it's made.
   */
  fillets?: CadEdgeFillet[];
  /** Mirror › Add steps, after its fillets: the part joined with its own mirror image across a plane or a face. */
  mirrorJoins?: CadMirrorJoin[];
  /**
   * A Split: the part cut in two by a plane standing across its sketch plane. The part keeps the side the plane's
   * `line` normal points to; the other side is a part of its own, `pieceOf` it. `fromCopy`: it was a copy of another
   * part, taken out of its pattern to be split, so its sketch and extrude are that part's, not steps of its own.
   */
  split?: CadPartSplit;
  /** What it's made of, from the material library: its weight follows from its density. Not a step of the design. */
  material?: CadPartMaterial;
  /** Regions Extrude → Add steps join to this part. The design writes it from those steps; it's never edited. */
  addedRegions?: string[];
  /** Where the part sits in the assembly. Unplaced parts are laid out side by side. It never changes the part's own shape. */
  placement?: CadPlacement;
  /** What the part was drawn on. When it's set, the placement follows from it, so the part moves with that face. */
  drawnOn?: CadDrawnOn;
  /**
   * A board drawn edge-on, as the reference's thin extrude: its sketch is one line where the board's edge sits on its
   * plane or face, pushed `depth` along the face's normal. The board is `thickness` thick across the line, beside it
   * (to its right, walking the line from its start) or centred on it.
   */
  thin?: CadThinExtrude;
  /** A thin extrude of a picked shape: walls around its outline, with no floor. Ignored when the part is a `thin` board. */
  thinWall?: CadThinWall;
  /**
   * The open lines of the sketch a thin extrude walls instead of a shape: each becomes a strip, Thickness 1 to its right
   * walking it from its start and Thickness 2 to its left, or centred on it with Mid plane. A Remove cuts them as slots.
   */
  thinEdges?: string[];
  /**
   * The piece of this part a through cut split it into that the part keeps, a region of one of its face sketches; the
   * others are parts of their own, `pieceOf` it. The design writes both from its Remove steps; they're never edited.
   */
  piece?: CadPartPiece;
  /** A piece of another part, split off it by a through cut: made by the design, which keeps it in step. */
  pieceOf?: { partId: string; by: string };
  /**
   * A bone in every inside corner, so a bit of this diameter cuts it fully and a part that fits into it goes all the
   * way in. The diameter is the design's bit: a bigger bit in the job can't reach into the bones.
   */
  cornerRelief?: { diameter: number; diameterExpression?: string };
  /** More of the same part elsewhere in the assembly, each edited along with it. */
  copies?: CadPartCopy[];
  /** Copies in a row, kept in `copies` as the pattern lays them out. */
  pattern?: CadPartPattern;
  /** Ordered: a sketch can sit on the floor of an earlier cut. Parts without features are plain flat profiles. */
  features?: CadFeature[];
}
/**
 * A part's sketch x and y, with its thickness as z, turned by `rotation` (a unit quaternion x, y, z, w) and then moved by
 * `position`, in mm.
 */
export interface CadPartPiece {
  sketchId: string;
  regionId: string;
  /** The Remove step whose through cut split the part. */
  by: string;
}
export interface CadThinWall {
  /** mm out from the shape's outline, or both ways around it when centred. */
  thickness1: number;
  thickness1Expression?: string;
  /** mm in from the outline. */
  thickness2: number;
  thickness2Expression?: string;
  /** Centred on the outline, Thickness 1 in all. */
  midPlane?: true;
}
export interface CadThinExtrude {
  /** mm the board reaches from its plane or face. */
  depth: number;
  depthExpression?: string;
  /** Centred on the line, rather than beside it. */
  midPlane?: boolean;
}
/** A part drawn on a base plane, or on a face of another part: its top, underside, or the edge face along an outline line. */
export interface CadDrawnOn {
  /** The datum plane it's drawn on, if any: `on` and `offset` then follow that plane. */
  datum?: string;
  on: { plane: 'top' | 'front' | 'right' } | { partId: string; copyId?: string; face: 'top' | 'underside' | { edge: string } };
  /** How far from the plane or face the part starts, in mm along its normal. */
  offset: number;
  offsetExpression?: string;
  /** Grows into the face rather than out from it. */
  inward?: boolean;
}
/** A turn about a line: through `about`, along `axis`, by `degrees` counterclockwise looking against the axis. */
export interface CadTurn {
  about: [number, number, number];
  axis: [number, number, number];
  degrees: number;
  degreesExpression?: string;
}
export interface CadPlacement {
  position: [number, number, number];
  rotation: [number, number, number, number];
  /** Each position as typed, kept when it uses design variables so the part follows them, as dimensions do. */
  positionExpressions?: [string | null, string | null, string | null];
}
/**
 * Another of the same part. A mirrored copy is its mirror image across the sketch's y axis, as a left side is of a right
 * one: it's cut as a part of its own, since turning the part over doesn't make it.
 */
/**
 * A Mirror › Add step: the part and its mirror image across a plane, a part's face or a plane made to sketch on (`datum`),
 * made one part. The plane must stand across the part's sketch plane. `line` is where it crosses that sketch plane, in
 * the sketch's own coordinates, worked out as the design is laid out: a point on it and its unit normal.
 */
export interface CadMirrorJoin {
  id: string;
  across: CadDrawnOn['on'];
  datum?: string;
  suppressed?: true;
  line?: { x: number; y: number; nx: number; ny: number };
}

export interface CadPartMaterial {
  name: string;
  /** kg/m³. */
  density: number;
}

export interface CadPartSplit {
  id: string;
  across: CadDrawnOn['on'];
  datum?: string;
  suppressed?: true;
  fromCopy?: true;
  /** Where the plane crosses the sketch plane, in the sketch's coordinates, worked out as the design is laid out. */
  line?: { x: number; y: number; nx: number; ny: number };
}

export interface CadPartCopy {
  id: string;
  /**
   * A transform by a distance along a picked direction: the copy sits that far from the part along the plane's or face's
   * normal, wherever that face is now. It sets `offset` whenever the design is laid out.
   */
  along?: CadDirection & { distance: number; distanceExpression?: string };
  /** Switched off in the feature list: the design is built as if it weren't there, and it keeps its settings. */
  suppressed?: true;
  placement?: CadPlacement;
  mirrored?: boolean;
  /** Its own name, rather than the part's with a number. */
  name?: string;
  /**
   * The number in its name, given when it's added so later copies and pattern changes don't renumber it. Copies saved
   * without one are numbered by their order. A copy with its own name still holds its number, so clearing the name gives
   * back the same one.
   */
  number?: number;
  /** The part pattern that made it, which places it and keeps it in step with the count. */
  pattern?: string;
  /**
   * How far it's moved from the part along the studio's axes, as a transform copies a part. Its placement follows from
   * it, so it moves with the part. The position can use variables; the rotation is unused.
   */
  offset?: CadPlacement;
  /** Turned about a line from where the part is, before `offset` moves it, as Rotate and mate connectors copy a part. */
  turn?: CadTurn;
  /**
   * A mirror image of the part across a plane, a part's face, or a plane made to sketch on (`datum`). Its placement
   * follows from where the part and that plane are, so it stays mirrored as either moves. It's always `mirrored`.
   * Copy faces retain across.copyId, preserving the selected physical instance.
   */
  mirror?: { across: CadDrawnOn['on']; datum?: string };
}
/** Copies of a part in a row along an axis, each `spacing` on from the last. */
/** A direction taken from a plane or a part's face, as the reference picks one: out of it, or into it with `flip`. */
export interface CadDirection {
  along: CadDrawnOn['on'];
  flip?: boolean;
}
export interface CadPartPattern {
  id: string;
  /** Picked from a plane or face; it overrides `axis` while that face is there, and follows it when it moves. */
  direction?: CadDirection;
  /** Along a picked edge, as a unit vector, when there's no `direction`. It stays as picked. */
  vector?: [number, number, number];
  /** Switched off in the feature list: no copies, and the count and spacing are kept. */
  suppressed?: true;
  axis: 'x' | 'y' | 'z';
  /** How many in all, counting the part itself. */
  count: number;
  countExpression?: string;
  /** mm from one to the next; a negative spacing goes the other way. */
  spacing: number;
  spacingExpression?: string;
  /** Detached logical positions, numbered from one after the source; they stay skipped through count edits. */
  excluded?: number[];
  /** Turns copies about a line in assembly space instead of spacing them in a row. */
  circular?: CadCircularPartPattern;
  /** The row laid out to both sides of the original rather than after it. A Remove's feature pattern only, for now. */
  centered?: true;
  /** A second direction, making a grid: count × second count instances. A Remove's feature pattern only, for now. */
  second?: {
    vector: [number, number, number];
    count: number;
    spacing: number;
    spacingExpression?: string;
    countExpression?: string;
    centered?: true;
  };
  /**
   * Grid positions left out, as [along the first direction, along the second], counting from 0 at the first instance of
   * each row: the original, or the first before it when centred.
   */
  skipped?: [number, number][];
}
export interface CadCircularPartPattern {
  /** A point on the picked axis, in assembly space. The picked line stays where it was picked. */
  origin: [number, number, number];
  axis: [number, number, number];
  /** Degrees across the whole pattern when equally spaced, or between successive instances otherwise. */
  angle: number;
  angleExpression?: string;
  /** Defaults to true. A full turn divides by the count, avoiding a second instance on top of the seed. */
  equalSpacing?: boolean;
  opposite?: boolean;
}
/** The face a sketch is drawn on. All sketches share the part's x and y, seen from above, whichever face they're on. */
export type CadFaceRef = 'top' | 'underside' | { floorOf: string };
export interface CadFaceSketch {
  type: 'sketch';
  id: string;
  on: CadFaceRef;
  sketch: CadSketch;
  /** This copy only, in the source part's local coordinates. Kept while a pattern's count leaves the copy absent. */
  copyId?: string;
  /** The Extrude → Remove step whose sketch this is, kept in step with it by the design. It's never edited here. */
  removedBy?: string;
}
/** mm below the sketch's face. Zero leaves the region uncut, which is how an inner loop stops being a through-hole. */
export type CadCutDepth = number | 'through';
export interface CadCut {
  type: 'cut';
  id: string;
  /** The part's profile sketch or a face sketch. */
  sketchId: string;
  regionId: string;
  copyId?: string;
  depth: CadCutDepth;
  /** The depth as typed, kept when it uses design variables so the cut follows them. */
  depthExpression?: string;
  /** Switched off: the part evaluates as if the cut weren't there, and it keeps its depth for when it's back on. */
  suppressed?: boolean;
  /** The Extrude → Remove step that makes this cut, or the Extrude → Add that steps its part down, kept in step with it. */
  removedBy?: string;
}
export type CadFeature = CadFaceSketch | CadCut;
export type CadLengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

/** The one saved document format. */
export const CAD_DOCUMENT_VERSION = 1;

export interface CadDocument {
  /** Display/input unit only. Geometry and persisted expressions remain in millimeters. */
  lengthUnit?: CadLengthUnit;
  version: typeof CAD_DOCUMENT_VERSION;
  id: string;
  name: string;
  /** Increases on source edits; solving preserves the source revision. */
  revision: number;
  /** Design variables, such as `width` and `board`, that dimensions and thicknesses can use. */
  variables?: CadVariable[];
  /** Steps that cut parts out of other parts, in order. */
  partCuts?: CadPartCut[];
  /** Explicit physical moves remain source records even when their target is temporarily unavailable. */
  copyTransforms?: CadPhysicalTransform[];
  /** Ordered union of part-cut and copy-transform IDs. Generation features retain their existing semantics. */
  operationOrder?: string[];
  /** Source-ID prefix evaluated with legacy fixed-tool semantics when upgrading an existing design. */
  legacyPartCutIds?: string[];
  /** Planes made to sketch on: a base plane or a part's face, moved out along its normal. */
  planes?: CadDatumPlane[];
  /** Named groups over neighbouring source steps. They never replace or regenerate their contents. */
  folders?: CadFolder[];
  /** Authored facts/assumptions, never stored geometry acceptance or strength claims. */
  constructions?: CadConstruction[];
  parts: CadPart[];
}
/** A physical target is explicit; omitting copyId never turns a family reference into a seed selection. */
export type CadPhysicalTarget = { kind: 'seed'; partId: string } | { kind: 'copy'; partId: string; copyId: string };
export interface CadRigidTransformValues {
  by: [number, number, number];
  byExpressions?: [string | null, string | null, string | null];
  turn?: CadTurn;
  suppressed?: true;
}
/** The old flat saved-copy record remains unchanged. */
export interface CadCopyTransform extends CadRigidTransformValues {
  id: string;
  partId: string;
  copyId: string;
  seed?: never;
}
/**
 * An independent root's original physical instance, after generation and any earlier spatial operations.
 * Experimental V4 copy-only readers require copyId and explicitly refuse this mutually exclusive seed variant.
 */
export interface CadSeedTransform extends CadRigidTransformValues {
  id: string;
  partId: string;
  seed: true;
  copyId?: never;
}
export type CadPhysicalTransform = CadCopyTransform | CadSeedTransform;
/** Derived world poses are separate from source creation placements; evaluating twice must not move a copy twice. */
export interface CadEvaluation {
  parts: EvaluatedCadPart[];
  diagnostics: CadDiagnostic[];
  placements?: Record<string, CadPlacement>;
  available?: string[];
}
export interface CadFolder {
  id: string;
  name: string;
  /** Whole parts in source order, including their own sketches, features and copies. */
  partIds: string[];
  partCutIds?: string[];
  planeIds?: string[];
  collapsed?: true;
  /** A mask over the contents, independent of every step's own suppression flag. */
  suppressed?: true;
}
/** A plane offset from a base plane or a part's face, as a step of its own, to draw parts on. */
export interface CadDatumPlane {
  id: string;
  name: string;
  on: CadDrawnOn['on'];
  /** mm out along the normal of what it's on; negative goes the other way. */
  offset: number;
  offsetExpression?: string;
}
/**
 * Cuts the tool parts out of the target parts wherever they reach in, as placed, with `clearance` mm of room around
 * them: grooves for backs, housings for shelves, mortises for tenons. It follows both parts' sizes and places.
 */
export interface CadPartCut {
  id: string;
  /** Switched off in the feature list: nothing is cut, and the step keeps its settings. */
  suppressed?: true;
  /** Part IDs cut with the part and all its copies; `<partId>:<copyId>` cuts with only that copy, as placed and mirrored. */
  tools: string[];
  /** Part IDs target the whole family; `<partId>:<copyId>` targets only that physical copy, retaining missing slot IDs. */
  targets: string[];
  /**
   * mm of room around each tool. It widens every side of the opening that lies inside the target, both across the
   * tool and at a closed end, and deepens a blind cut by as much. A side that runs off the target's edge stays open.
   */
  clearance: number;
  clearanceExpression?: string;
  /** Omitted inherits the receiving part; null disables relief for only this step's openings. */
  cornerRelief?: { diameter: number; diameterExpression?: string } | null;
  /** Alternate cuts along the shared in-plane overlap (its longer axis for parallel extrusions), from its positive world end. */
  split?: 'half' | { fingers: number; fingersExpression?: string };
  /** The tools are used up by a cut-out. Split joints always keep both parts, even when this is saved as true. */
  consumeTools?: true;
  /**
   * Set when it's a Boolean step: `union` joins the tools into the first target, `subtract` cuts as "cut parts" does,
   * and `intersect` keeps only what they share. Absent, it's a "cut parts" step.
   */
  operation?: CadBooleanOperation;
}
export type CadBooleanOperation = 'union' | 'subtract' | 'intersect';
/** A named value. Its kind follows from the expression: a length or angle unit, or a plain number. */
export interface CadVariable {
  id: string;
  name: string;
  expression: string;
  /** Association only: variable names remain unique across the entire document. */
  folderId?: string;
  /** The design step it's listed before, as made while that step was edited: the feature list shows it there. */
  before?: string;
}

export interface CadDiagnostic {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  partId?: string;
  entityIds?: string[];
  constraintIds?: string[];
  /** Where on the part, in its sketch's coordinates, e.g. the corners a bone didn't fit in. */
  points?: CadPoint[];
}
export interface EvaluatedCadLoop {
  /** Stable lineage: curve IDs, never coordinates or list indices. */
  id: string;
  entityIds: string[];
  points: CadPoint[];
  kind: 'outer' | 'hole';
}
export interface EvaluatedCadPart {
  partId: string;
  name: string;
  thickness: number;
  outline: CadPoint[];
  holes: CadPoint[][];
  loops: EvaluatedCadLoop[];
  /** Cuts beyond the through-holes above, in feature order. Absent on plain profiles. */
  cuts?: EvaluatedCadCut[];
  /** Edges along its faces that Fillet steps round over, in step order. Absent when there are none. */
  rounds?: EvaluatedCadRound[];
  /** Complete cut sets for copies that differ, in the original's sketch frame before mirroring. Missing copies use `cuts`. */
  copyCuts?: Record<string, EvaluatedCadCut[]>;
  /** A copy can fill a profile hole with No cut, or turn it into a pocket. Evaluated material only, never saved source. */
  copyProfiles?: Record<string, Pick<EvaluatedCadPart, 'outline' | 'holes' | 'loops'>>;
}
export interface EvaluatedCadCut {
  id: string;
  regionId: string;
  side: 'top' | 'underside';
  /** mm below that side's surface: where the cut starts and its floor. */
  from: number;
  to: number;
  through: boolean;
  /** Counterclockwise, in the part's sketch coordinates. Not clipped to the part. */
  outline: CadPoint[];
  /** Regions nested in the outline, left uncut by this cut. */
  islands: CadPoint[][];
  /** For a cut another part makes: its opening as a box in the part's sketch coordinates, before any corner bones. */
  opening?: { x0: number; y0: number; x1: number; y1: number };
  /** The tool's own footprint inside that opening, before clearance: where its corners sit. */
  tool?: { x0: number; y0: number; x1: number; y1: number };
  /** For a cut another part makes: the bit diameter its opening's corners are relieved for, when they are. */
  relief?: number;
}
/** An edge along a face of the part, rounded over with a quarter circle: the face and the wall below it meet on the curve. */
export interface EvaluatedCadRound {
  filletId: string;
  /** The rounded loop: `outline`, a through hole's loop ID, or a cut's ID. */
  loopId: string;
  side: 'top' | 'underside';
  /** mm in from that side's surface where the edge sits: 0 on the surface itself, a cut's floor depth for one on it. */
  at: number;
  radius: number;
  /** The edge, in the part's sketch coordinates. */
  points: CadPoint[];
  /** Where the part's material is: inside the loop for its outline, outside it for a hole or a cut's opening. */
  material: 'inside' | 'outside';
}
export type CadEntityFreedom = 'fully-constrained' | 'underconstrained' | 'unknown';
export interface CadSketchSolveStatus {
  partId: string;
  dof: number;
  status: 'solved' | 'conflict' | 'invalid';
  /** Optional native rank analysis at this solution, never inferred from explicit fixed flags. */
  entityStatus?: Record<string, CadEntityFreedom>;
  entityAnalysis?: { elapsedMs: number; probes: number; complete?: boolean; limitedBy?: 'budget' | 'failure' | 'engine-reset' };
}
export interface CadSolveResult extends CadEvaluation {
  document: CadDocument;
  status: 'solved' | 'conflict' | 'invalid';
  sketches: CadSketchSolveStatus[];
  /**
   * Every sketch solved without an error and the features were built from them, so the errors left come from building
   * them: a part's outline, or a feature such as an Extrude whose picked region is gone. A sketch closes despite the
   * latter; the feature shows as broken.
   */
  featuresEvaluated?: true;
}

/**
 * Edges of a Fillet step along a face of the part: where its top or underside, or a pocket's floor, meets a wall going
 * into the part. The round runs all the way along each loop.
 */
export interface CadFilletRim {
  side: 'top' | 'underside';
  /** The loops whose edge on that side is rounded: `outline`, a through hole's loop ID, or a cut's ID for its opening. */
  loops: string[];
  /** Picked as the face these loops bound, rather than edge by edge: it's listed as that one face. */
  face?: true;
}

/**
 * One Fillet step: corners of a part's sketch, rounded to a radius, as the edges through the part there, and edges along
 * its faces, rounded over.
 */
export interface CadEdgeFillet {
  id: string;
  /** Corner points of the part's sketch, each where two straight sides meet. */
  corners: string[];
  /** Edges along the part's faces, such as both edges of a cup's rim. */
  rims?: CadFilletRim[];
  radius: number;
  radiusExpression?: string;
  suppressed?: true;
}
