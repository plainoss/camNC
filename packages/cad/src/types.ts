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
}
export interface CadPointEntity extends EntityBase, CadPoint {
  type: 'point';
  fixed?: boolean;
  /**
   * Used from another part's corner, as the reference's Use: the point stays where that corner is seen on this sketch's
   * plane, on the part's top or its bottom, and follows it when that part changes.
   */
  used?: { partId: string; pointId: string; side: 'top' | 'bottom' };
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
   * Extrude → Add: the picked regions join this part, extruded from the same sketch, rather than making a part of
   * their own. The step isn't a part itself.
   */
  addTo?: string;
  /**
   * Extrude → Remove: the picked regions, or every closed region but what's left of the face, are cut into the board
   * the sketch is drawn on, this deep. The step isn't a part itself.
   */
  remove?: { depth: CadCutDepth; depthExpression?: string };
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
  on: { plane: 'top' | 'front' | 'right' } | { partId: string; face: 'top' | 'underside' | { edge: string } };
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
}
/** The face a sketch is drawn on. All sketches share the part's x and y, seen from above, whichever face they're on. */
export type CadFaceRef = 'top' | 'underside' | { floorOf: string };
export interface CadFaceSketch {
  type: 'sketch';
  id: string;
  on: CadFaceRef;
  sketch: CadSketch;
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
  depth: CadCutDepth;
  /** The depth as typed, kept when it uses design variables so the cut follows them. */
  depthExpression?: string;
  /** Switched off: the part evaluates as if the cut weren't there, and it keeps its depth for when it's back on. */
  suppressed?: boolean;
  /** The Extrude → Remove step that makes this cut, kept in step with it by the design. */
  removedBy?: string;
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
  /** Steps that cut parts out of other parts, in order. */
  partCuts?: CadPartCut[];
  /** Planes made to sketch on: a base plane or a part's face, moved out along its normal. */
  planes?: CadDatumPlane[];
  parts: CadPart[];
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
  targets: string[];
  /**
   * mm of room around each tool. It widens every side of the opening that lies inside the target, both across the
   * tool and at a closed end, and deepens a blind cut by as much. A side that runs off the target's edge stays open.
   */
  clearance: number;
  clearanceExpression?: string;
  /** Alternate cuts along the shared in-plane overlap (its longer axis for parallel extrusions), from its positive world end. */
  split?: 'half' | { fingers: number; fingersExpression?: string };
  /** The tools are used up by a cut-out. Split joints always keep both parts, even when this is saved as true. */
  consumeTools?: true;
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
  /** Complete cut sets for copies that differ, in the original's sketch frame before mirroring. Missing copies use `cuts`. */
  copyCuts?: Record<string, EvaluatedCadCut[]>;
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

/** One Fillet step: corners of a part's sketch, rounded to a radius, as the edges through the part there. */
export interface CadEdgeFillet {
  id: string;
  /** Corner points of the part's sketch, each where two straight sides meet. */
  corners: string[];
  radius: number;
  radiusExpression?: string;
  suppressed?: true;
}
