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
