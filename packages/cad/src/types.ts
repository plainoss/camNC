/** CAD source is independent of the solver and the CAM tessellation. All lengths are mm. */
export interface CadPoint {
  x: number;
  y: number;
}

interface EntityBase {
  id: string;
  construction?: boolean;
}
export interface CadPointEntity extends EntityBase, CadPoint {
  type: 'point';
  fixed?: boolean;
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
  /** Legacy absolute annotation input; numeric dimensions migrate to labelPlacement. */
  labelPosition?: CadPoint;
}
/** User placement in a dimension's geometric frame; independent of camera scale. */
export type CadDimensionPlacement =
  | { kind: 'linear'; fraction: number; normalOffset: number; /** Signed endpoint overshoot in millimetres. */ overshoot?: number }
  | {
      kind: 'radial';
      angle: number;
      radiusRatio: number;
      /** Fixed radial residual in millimetres, added after bounded radius scaling. */ radiusOffset?: number;
      /** Legacy absolute distance input retains its original authority. */ distance?: number;
    }
  | { kind: 'angle'; radius: number; angleOffset: number; frame?: 'local' }
  | { kind: 'fallback'; offset: CadPoint };
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
  thickness: number;
  /** The thickness as typed, kept when it uses design variables. */
  thicknessExpression?: string;
  sketch: CadSketch;
  /** Where the part sits in the assembly. Unplaced parts are laid out side by side. It never changes the part's own shape. */
  placement?: CadPlacement;
  /**
   * A bone in every inside corner, so a bit of this diameter cuts it fully and a part that fits into it goes all the
   * way in. The diameter is the design's bit: a bigger bit in the job can't reach into the bones.
   */
  cornerRelief?: { diameter: number; diameterExpression?: string };
  /** More of the same part elsewhere in the assembly, each edited along with it. */
  copies?: CadPartCopy[];
  /** Ordered: a sketch can sit on the floor of an earlier cut. Parts without features are plain flat profiles. */
  features?: CadFeature[];
}
/**
 * A part's sketch x and y, with its thickness as z, turned by `rotation` (a unit quaternion x, y, z, w) and then moved by
 * `position`, in mm.
 */
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
export interface CadPartCopy {
  id: string;
  placement?: CadPlacement;
  mirrored?: boolean;
}
/** The face a sketch is drawn on. All sketches share the part's x and y, seen from above, whichever face they're on. */
export type CadFaceRef = 'top' | 'underside' | { floorOf: string };
export interface CadFaceSketch {
  type: 'sketch';
  id: string;
  on: CadFaceRef;
  sketch: CadSketch;
}
/** mm below the sketch's face. Zero leaves the region uncut, which is how an inner loop stops being a through-hole. */
export type CadCutDepth = number | 'through';
export interface CadCut {
  type: 'cut';
  id: string;
  /** The part's profile sketch or a face sketch. */
  sketchId: string;
  regionId: string;
  depth: CadCutDepth;
  /** The depth as typed, kept when it uses design variables so the cut follows them. */
  depthExpression?: string;
  /** Switched off: the part evaluates as if the cut weren't there, and it keeps its depth for when it's back on. */
  suppressed?: boolean;
}
export type CadFeature = CadFaceSketch | CadCut;
export interface CadDocument {
  /** 2 when any part has features, so builds that don't know them refuse the file. */
  version: 1 | 2;
  id: string;
  name: string;
  /** Increases on source edits; solving preserves the source revision. */
  revision: number;
  /** Design variables, such as `width` and `board`, that dimensions and thicknesses can use. */
  variables?: CadVariable[];
  parts: CadPart[];
}
/** A named value. Its kind follows from the expression: a length or angle unit, or a plain number. */
export interface CadVariable {
  id: string;
  name: string;
  expression: string;
}

export interface CadDiagnostic {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  partId?: string;
  entityIds?: string[];
  constraintIds?: string[];
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
export interface CadSolveResult {
  document: CadDocument;
  status: 'solved' | 'conflict' | 'invalid';
  diagnostics: CadDiagnostic[];
  parts: EvaluatedCadPart[];
  sketches: CadSketchSolveStatus[];
}
