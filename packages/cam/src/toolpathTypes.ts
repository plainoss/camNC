import type { PathsD } from 'clipper2-ts';
import type { SpindleSwitch } from './gcode';
import type { Vec3 } from './geom';
import type { CornerFeedSettings, MotionRole } from './motion';
import type { PlanAccuracy } from './accuracy';
import type { StockSummary } from './finalizePlan';
import type { PocketTransitionPolicy } from './stock';
import { MATERIALS, type Material, type TabSettings } from './settings';
import type { PartHolding } from './tabPlan';

export interface Tool {
  number: number;
  /** Stable tool-library identity, independent of its editable name. */
  guid?: string;
  presetId?: string;
  presetName?: string;
  /** Cutting diameter in mm: a flat end mill's, or a V-bit's widest (at the top of its cone). */
  diameter: number;
  /** Default `flat`. A `v` bit has a cone of `angle` and cuts deeper where it should cut wider. */
  shape?: 'flat' | 'v';
  /** A V-bit's included angle, degrees (90 for a 90° bit). */
  angle?: number;
  /** A V-bit's flat at the tip, mm (0: pointed). */
  tipDiameter?: number;
  name?: string;
  /** Depth per pass with this bit (its cutting data); default: the material's share of the diameter. */
  stepdown?: number;
  /** The rest of this bit's cutting data; default: the job's (`CamSettings`). */
  feed?: number;
  plungeFeed?: number;
  rampFeed?: number;
  leadFeed?: number;
  leadOutFeed?: number;
  finishFeed?: number;
  reducedFeed?: number;
  transitionFeed?: number;
  /** Spindle speed of the program this bit cuts (M3 S). */
  rpm?: number;
  /** Sideways step between pocket rings, mm. */
  stepover?: number;
  finalFeedFactor?: number;
  /** Length of cut, mm: deeper cuts get a warning. */
  fluteLength?: number;
  flutes?: number;
  /** Measured distance from the collet nut to the tip, mm. */
  stickout?: number;
}

export interface CamSettings {
  /** Only for the G-code (`GcodeOptions.spindle`): the toolpaths are the same. */
  spindle?: SpindleSwitch;
  tools: Tool[];
  material: Material;
  feed: number;
  plungeFeed: number;
  /** Defaults to the effective plunge feed. */
  rampFeed?: number;
  /** Tangent entry/exit feeds default to the cutting feed. */
  leadFeed?: number;
  leadOutFeed?: number;
  finishFeed?: number;
  reducedFeed?: number;
  transitionFeed?: number;
  /** Undefined uses tool-size-based defaults; false disables geometric corner reduction. */
  cornerFeed?: CornerFeedSettings | false;
  profileEntry?: 'plunge' | 'ramp';
  /** Configured feature-to-motion tolerance. Source error is included only when explicitly declared. */
  geometryTolerance?: number;
  sourceTolerance?: number;
  /** Newly swept planar material area per minute, evaluated over each resolved block. Axial entries are separate. */
  maxPlanarRemovalRate?: number;
  minimumCuttingFeed?: number;
  /** Explicit original blank boundary; omit when surrounding stock is unknown. */
  blankFootprint?: PathsD;
  stepoverFactor: number;
  /** Spindle speed the program starts the spindle at (M3 S), for a bit without its own. */
  spindleRpm?: number;
  /** Max stepdown in mm for pockets and outline roughing; default: the material's factor × the bit diameter. */
  maxStepdown?: number;
  /** Max stepdown for outline roughing, overriding the general cutting depth. */
  profileStepdown?: number;
  /** Optional maximum profile finishing depth increment; omit for one full-depth finish. */
  profileFinishStepdown?: number;
  /** Roughing passes stop this high above the stock bottom... */
  profileRoughBottom: number;
  /** ...leaving this much radial stock for the final pass: the outline's wall allowance. */
  leaveStock: number;
  /**
   * Pocket wall allowance: roughing stays this far off the walls, then bounded-depth wall passes cut them to size.
   * 0 = off: the wall ring is cut at every depth.
   */
  pocketWallAllowance: number;
  /** Maximum axial depth of wall/floor finishing; defaults to the roughing stepdown. */
  pocketFinishStepdown?: number;
  /**
   * The same for pockets open to the edge (rabbets), where it's on by default: rows cut toward the walls stop this
   * far off them, then bounded-depth climb passes finish the walls. 0 = the last row cuts the walls.
   */
  openWallAllowance?: number;
  pocketFinishFeedFactor: number;
  /** Rounds the corners of inner pocket rings (not the wall ring) so the bit doesn't stop and turn; 0 = sharp. */
  innerCornerRadius: number;
  /** Final outline pass goes down to here (below the stock bottom). */
  finalZ: number;
  /**
   * The outline's final pass stops here instead (above the stock bottom): a bottom skin holds the part in the board
   * until it's freed at the machine. Holes still go through.
   */
  outlineFloor?: number;
  /** With `outlineFloor` and a light `leaveStock`: skip the final lap, the cut-free program trims the wall as it frees the part. */
  outlineFinishAtRelease?: boolean;
  finalFeedFactor: number;
  climb: boolean;
  rampAngleDeg: number;
  /** Clearance heights, relative to the stock top. */
  safeHeight: number;
  retractHeight: number;
  tabs: TabSettings | false;
  /**
   * Z of the stock top when the board is thicker than the part (allowance, or measured at the machine). Cuts start
   * there; the part's top face is not faced. Default: the part's top.
   */
  stockTop?: number;
  /** Cut through holes and outlines (off for a flipped second setup that only does the bottom pockets). */
  cutThrough: boolean;
}

export const DEFAULT_TOOL: Tool = { number: 1, diameter: 3.175, name: 'flat end mill' };

export const DEFAULT_SETTINGS: CamSettings = {
  tools: [DEFAULT_TOOL],
  material: MATERIALS.oak,
  feed: 1800,
  plungeFeed: 480,
  stepoverFactor: 0.4,
  profileRoughBottom: 1,
  leaveStock: 0.1,
  pocketWallAllowance: 0,
  pocketFinishFeedFactor: 1,
  innerCornerRadius: 0.3,
  finalZ: -0.3,
  finalFeedFactor: 0.5,
  climb: true,
  rampAngleDeg: 3,
  profileEntry: 'ramp',
  geometryTolerance: 0.05,
  safeHeight: 5,
  retractHeight: 2,
  tabs: false,
  cutThrough: true,
};

/** A continuous cutting move. The tool reaches pts[0] either by retract/rapid/plunge or by a direct feed move. */
export interface Pass {
  pts: Vec3[];
  /** Feed of the move ending at pts[i]; feeds[0] is used for the approach. */
  feeds: number[];
  roles?: MotionRole[];
  /** Known side of the remaining wall material; omitted when no geometric side is established. */
  materialSide?: 'left' | 'right';
  phase?: 'rough' | 'finish';
  entry?: 'plunge' | 'ramp';
  link: 'retract' | 'direct';
  /** The straight link to pts[0] runs through material already cleared at this depth (may be longer than D). */
  clearLink?: boolean;
  /** Generated cutting stepover; its explicit prefix is independently rechecked after ordering and at post. */
  cuttingTransition?: { from: Vec3; to: Vec3 };
}

export interface Operation {
  name: string;
  /** `vcarve`: a V-bit following the artwork's inward offsets, deeper where it is wider. */
  kind: 'pocket' | 'profile' | 'vcarve';
  /** What it cuts: board programs put inner features (pockets, holes) before outlines. */
  feature: 'pocket' | 'hole' | 'outline';
  tool: Tool;
  /** Resolved approach feed, retained when the post must replace an unproved link with a plunge. */
  plungeFeed?: number;
  pocketTransition?: PocketTransitionPolicy;
  passes: Pass[];
  /** Pause (M0) before this operation with this message, e.g. guided tab removal. */
  pauseBefore?: string;
  /** For people, in the words of the Model step's feature list: "9 pockets 4.2 deep + edge groove to 4.2". */
  title?: string;
  /** Planning choices that required a conservative entry fallback. */
  warnings?: string[];
  /** Pause (M0) after this operation with this message, the spindle off and the bit up (e.g. "take the part out"). */
  pauseAfter?: string;
  /**
   * On a board: the part or carving this operation cuts, whose name `name` starts with ("<owner>: <operation>"). The
   * id tells two of the same name apart. In a program that frees parts, the pause marker (`pauseMarker`) names it.
   */
  owner?: { name: string; id?: string };
  /** The final lap left to the cut-free program, and a point in the cleared kerf to reach it from. */
  finishAtRelease?: { loop: Vec3[]; approach: Vec3 };
}

/** What an operation cuts: its owner on a board, the operation itself in a program for one part. */
export const ownerOf = (op: Operation): NonNullable<Operation['owner']> => op.owner ?? { name: op.name };

/** The piece a through hole's cut would leave in its middle. */
export interface HoleMiddle {
  /** Index in the part's `throughHoles`. */
  hole: number;
  /** Its longer side, mm. */
  size: number;
  /** About how much longer the job takes with it cleared. */
  addMinutes: number;
  /** `vacuum`: small enough to be sucked up. `loose`: left in place, nothing holds it. `screwed`: a hold point is on it. */
  state: 'vacuum' | 'cleared' | 'loose' | 'screwed';
  /** The user's choice, over what the size and time would pick. */
  choice?: HoleChoice;
  /** On a board: the part (instance id). */
  part?: string;
}

export type HoleChoice = 'clear' | 'leave';

/**
 * Waste a profile path leaves because the bit can't reach into it: notches narrower than the bit, such as finger
 * joint slots, or sharp inside corners. One entry per loop for the pieces that span their notch, one for the others.
 */
export interface OutlineNotches {
  /** The loop: an index into the part's outlines, or into its through holes when `inside`. */
  outline: number;
  inside?: true;
  count: number;
  /** mm, the narrowest piece's: the widest disk that fits in it. */
  width: number;
  /** The bit's, mm. */
  diameter: number;
  /** Each piece fills its notch up to the mouth: the path runs straight across, and the notch isn't cut at all. */
  spans: boolean;
  /** mm² left, all pieces together. */
  area: number;
  /** Each piece's middle, in the part's own coordinates (as its features are). */
  at: { x: number; y: number }[];
  /** On a board: the part (instance id). */
  part?: string;
}

export interface PartCam {
  stockTop: number;
  operations: Operation[];
  warnings: string[];
  /** Boards with tabs or a skin: how each part is held (tabs where they hold, a skin, or nothing). */
  holding?: PartHolding[];
  /** Absolute Z of moves between operations, above the stock and any holds. */
  safeZ?: number;
  /** The same for retract links between passes. */
  retractZ?: number;
  /** Original blank material; through holes and final cutouts are not initial air. */
  stockFootprint?: PathsD;
  /** Through holes that leave a piece in their middle: what happens to it. */
  holeMiddles?: HoleMiddle[];
  /** Notches and sharp corners the outline and hole paths can't reach. */
  outlineNotches?: OutlineNotches[];
  /** Configured stage limits, not a measured source/CAD accuracy certificate. */
  accuracy?: PlanAccuracy;
  stockSummary?: StockSummary;
}
