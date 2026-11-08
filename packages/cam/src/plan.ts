import {
  boardBits,
  boardWork,
  camBoard,
  holdOptionsOf,
  holdsOnParts,
  jobHoldClashes,
  rotateAboutOrigin,
  splitByBit,
  usesTabs,
  type BoardSpec,
  type HoldDown,
} from './board';
import { dowelClearance, dowelProblem, dowelSpots, sideBSpec, type FlipRegistration } from './flip';
import type { PartFeatures } from './features';
import { postProgram, toGcode } from './gcode';
import { maxOf, minOf } from './geom';
import { holdCheck, holdTimeline } from './hold';
import type { HoldPoint } from './holdPoints';
import { readGcode } from './analyze';
import { checkGcodeSafety, checkProgramSafety } from './safety';
import { progressOver, type OnProgress } from './progress';
import { DEFAULT_TABS } from './settings';
import { setupSheet, type SetupSummary } from './setupSummary';
import { freePartsProgram, kDefaultSkin } from './tabPlan';
import { tabRemovalProgram, type TabStop } from './tabRemoval';
import { estimateProgramTime, type ProgramTimeEstimate } from './timing';
import type { BoardCarving } from './vcarve';
import {
  DEFAULT_SETTINGS,
  stepdownFor,
  type CamSettings,
  type HoleChoice,
  type HoleMiddle,
  type Operation,
  type PartCam,
} from './toolpaths';

// Plans a board of parts as the app cuts it: the programs, their numbers and safety checks, what holds the parts, and
// what's left for after the cutting. Parts come from `BoardPartSource`, so a caller decides how features are made and
// cached.

/** Where a board's parts come from, by part ID. */
export interface BoardPartSource {
  /** Its size (x, y, thickness) and features, and the bit diameter its inside corners are relieved for, if they are. */
  part(partId: string): { size: [number, number, number]; features: PartFeatures; cornerRelief?: number };
  /** Its underside's features with depths from its own bottom, turned over about Y when the part lies rotated, else X. */
  underside(partId: string, rotated: boolean): PartFeatures;
}

export interface OpSummary {
  name: string;
  /** For people: "Pocket 4.2 deep", "Outline: rough + final pass". */
  label: string;
  kind: Operation['kind'];
  tool: { number: number; diameter: number; shape?: 'flat' | 'v'; angle?: number };
  zTop: number;
  zBottom: number;
  /** Distinct depths the operation cuts at (pocket stepdowns, outline roughing + final). */
  depthSteps: number;
  /** The deepest single step down, mm, from where the operation starts cutting. */
  stepdown: number;
  /** Cutting feeds used, fastest first (the final pass may be slower). */
  feeds: number[];
  timeMin: number;
  /** One step of a guided program after the cutting (see `ReleaseProgram`): shown together as that program's row. */
  program?: { kind: ReleaseProgram['kind']; title: string; note: string };
}

/**
 * Planned with the board, run after its cutting (after side B, when there is one) in this order: freeing bottom-skin
 * parts or the layer on the tape, then the guided tab removal. The Plan step shows it, the machine queue runs it.
 */
export interface ReleaseProgram {
  kind: 'free' | 'tabs';
  /** "Cut the parts free", "Remove the tabs". */
  title: string;
  gcode: string;
  timeMin: number;
  /** Automatic motion/dwell estimate; operator pauses and unresolved moves stay explicit. */
  timing?: ProgramTimeEstimate;
  setup?: SetupSummary;
  setupSheet?: string;
  tool: number;
  diameter: number;
  /** Stops for a person: holding a part, taking one out. The spindle confirmation every program starts with doesn't count. */
  pauses: number;
  /** "8 pauses: take out each part". */
  note: string;
  ops: OpSummary[];
  /** Broken safety rules: block the job like any other program's. */
  safety: string[];
  /** Cut with the board turned over (the skins or tabs on top), after side B. */
  turned: boolean;
  /** Freeing: the parts in program order, with a spot to point at (program coordinates). */
  parts?: { name: string; at: { x: number; y: number } }[];
  /** Tab removal: the tabs, and where to hold the part (program coordinates). */
  tabs?: TabStop[];
  /** Tab removal: one pause per part (all its tabs, then take it out), not one before every tab. */
  perPart?: boolean;
}

export interface PlanResult {
  /** The accepted geometry this plan was generated from, independent of draft edits. */
  sourceKey?: string;
  gcode: string;
  timeMin: number;
  warnings: string[];
  /** Broken safety rules (empty when fine): never shown as a downloadable program then. */
  safety: string[];
  ops: OpSummary[];
  /** Bit diameters in the order the program uses them. */
  bits: number[];
  /**
   * What to run: one program per bit (FluidNC can't zero Z during an M0 pause, so bit swaps happen between programs).
   * `gcode` is all of them in order, for previews.
   */
  programs: {
    tool: number;
    diameter: number;
    /** The bit's name, for people: "90° V-bit ⌀6". */
    name?: string;
    gcode: string;
    timeMin: number;
    timing?: ProgramTimeEstimate;
    setup?: SetupSummary;
    setupSheet?: string;
  }[];
  size: [number, number, number];
  path: [number, number, number][][];
  /**
   * With tabs: per part, which tabs hold it once its outline is cut through (the stock beyond a tab must be wide
   * enough and reach the board's edge). A part with too few is not held: the job is blocked.
   */
  hold?: { part: string; tabs: { at: { x: number; y: number }; anchored: boolean }[]; anchored: number; ok: boolean }[];
  /**
   * What comes loose during the job, at the step where it happens (see `holdTimeline`). `block`: the job is blocked
   * (stock that can turn or lift; a part that should be held but isn't). Without `block`: as the user chose (nothing
   * holds the parts).
   */
  timeline?: {
    step: number;
    after: string;
    kind: 'board' | 'pivot' | 'loose' | 'pocket';
    what: string;
    at: { x: number; y: number };
    block: boolean;
    message: string;
  }[];
  /** Hold points the bit would hit (blocks the job). */
  holdClash?: { x: number; y: number }[];
  /** Per part: tabs placed (`tabs` of them; `wanted` when fewer fit than asked), a bottom skin, or nothing that holds it. */
  holding?: { name: string; how: 'placed' | 'skin' | 'unheld'; tabs: number; wanted?: number; moved?: boolean }[];
  /** Bottom skin thickness, mm, for the parts that have one. */
  skin?: number;
  /** The board is taped down: the skin is the layer on the tape, cut for all parts in one go at the end. */
  taped?: boolean;
  /** The board's second side, after turning it over top to bottom: the programs for the parts' undersides. */
  sideB?: PlanResult;
  /** How side B lines up; for dowels, where the pins go (and why there's no room for them). */
  flip?: { registration: FlipRegistration; dowels?: { x: number; y: number }[]; dowelDiameter?: number; problem?: string };
  /** What's left for after the cutting, in machine queue order. */
  release?: ReleaseProgram[];
  /** The piece in the middle of each through hole that leaves one: cleared, sucked up, or to be fixed by hand. */
  holeMiddles?: HoleMiddle[];
}

/** A board to generate: which bodies sit where. */
export interface BoardRequest {
  id: string;
  name: string;
  w: number;
  h: number;
  thickness: number;
  /** Stock top Z (thickness + allowance, or measured). */
  stockTop: number;
  /** Board lying askew on the bed: the program is turned about the XY zero (degrees, counterclockwise). */
  rotationDeg?: number;
  /** The board turned over can lie at another angle than side A (camera registration); unset: as side A. */
  sideBRotationDeg?: number;
  holdDown: HoldDown;
  /** Tape under the board. */
  taped?: boolean;
  /** Where the board is screwed or clamped down (board frame). None: tape, or held down by hand. */
  holdPoints?: HoldPoint[];
  tabs: { width: number; height: number; minCount: number };
  parts: {
    id: string;
    partId: string;
    name: string;
    x: number;
    y: number;
    rotated: boolean;
    /** Tabs dragged into place, part frame, mm. */
    tabsAt?: { x: number; y: number }[];
    /** The user's choices for the middles of its through holes. */
    holes?: Record<number, HoleChoice>;
  }[];
  /** Clear the middles of through holes where that's quick. */
  clearHoles?: boolean;
  /** A second side for the parts' undersides, and how it lines up after turning the board over. */
  flip?: { registration: FlipRegistration; dowelDiameter?: number };
  /** Bottom skin thickness, mm. */
  skin?: number;
  /** Artwork V-carved into side A's top before any part is cut. */
  carvings?: BoardCarving[];
}

/** The tab hold check's share of the work of planning a board, per unit of its parts' work. */
const kHoldCheckShare = 0.1;

/** One program for a whole board: its parts at their nested positions, operations grouped by bit. */
export function planBoard(
  board: BoardRequest,
  settings: Partial<CamSettings>,
  source: BoardPartSource,
  { perPart = false, onProgress }: { perPart?: boolean; onProgress?: OnProgress } = {}
): PlanResult {
  const spec = boardSpec(board, source);
  // The steps, weighed by how long they took on boards of parts and carvings: laying out side A (and again unturned,
  // for the hold checks, when the board is turned on the bed), its G-code and checks, side B the same, and whether
  // everything stays put.
  const work = onProgress ? boardWork(spec) : { parts: 0, carvings: 0, checks: 0 };
  const sideA = work.parts + work.carvings + work.checks;
  const post = 0.35 * sideA;
  const sideB = board.flip ? work.parts + work.checks : 0;
  const postB = 0.35 * sideB;
  const unturned = board.rotationDeg ? sideA : 0;
  const holds = (0.7 + kHoldCheckShare) * work.parts;
  const progress = progressOver(onProgress, sideA + post + sideB + postB + unturned + holds);
  // Started: the caller counts the time from here.
  onProgress?.(0);
  const flip = board.flip;
  // On dowels: side A drills the pins (and their mirrors) where there's room on the board.
  let problem: string | undefined;
  if (flip?.registration === 'dowels') {
    const diameter = flip.dowelDiameter ?? 6;
    problem = dowelProblem(spec, diameter, settings);
    const at = problem ? undefined : dowelSpots(spec, diameter, dowelClearance(settings));
    if (at) spec.dowels = { at, diameter, depth: 6 };
    else
      problem ??= `No room for two ⌀${diameter} dowel pins clear of the parts: make the board bigger, or re-align with the camera instead.`;
  }
  const cam = camBoard(spec, settings, progress.step(sideA));
  progress.done(sideA);
  // Corners relieved for a smaller bit than the board is cut with still come out rounded, and a joint won't close.
  const widest = Math.max(0, ...cam.operations.map(op => op.tool.diameter));
  const warned = new Set<string>();
  for (const p of board.parts) {
    const relief = source.part(p.partId).cornerRelief;
    if (relief === undefined || widest <= relief + 1e-6 || warned.has(p.partId)) continue;
    warned.add(p.partId);
    cam.warnings.push(
      `${p.name}: its inside corners are relieved for a ⌀${relief} bit, but this board is cut with a ⌀${widest} bit, so they stay rounded.`
    );
  }
  // The second side cuts the undersides: the warning that they need one is answered.
  if (flip) cam.warnings = cam.warnings.filter(w => !w.includes('flipped'));
  const size: [number, number, number] = [board.w, board.h, board.stockTop];
  let plan = summarize(
    cam,
    `Board ${board.name}`,
    size,
    settings,
    board.thickness,
    board.name,
    sideRotation(board, false),
    progress.step(post)
  );
  progress.done(post);
  if (flip) {
    const b = camBoard(
      sideBSpec({ ...spec, carvings: undefined, rotationDeg: sideRotation(board, true) }, p => undersideOf(source, p.id, board, p.rotated)),
      { ...settings, cutThrough: false },
      progress.step(sideB)
    );
    progress.done(sideB);
    plan = {
      ...plan,
      flip: { registration: flip.registration, dowels: spec.dowels?.at, dowelDiameter: spec.dowels?.diameter, problem },
      ...(b.operations.length
        ? {
            sideB: summarize(
              b,
              `Board ${board.name} side B`,
              size,
              settings,
              board.stockTop,
              board.name,
              sideRotation(board, true),
              progress.step(postB)
            ),
          }
        : // With nothing it can cut, side B has no program, but why it has nothing still matters.
          { warnings: [...plan.warnings, ...b.warnings.map(warning => `Side B: ${warning}`)] }),
    };
  }
  // The hold check runs on the board as laid out, before it's turned to lie like the stock on the bed.
  progress.done(postB);
  const flat = board.rotationDeg ? camBoard({ ...spec, rotationDeg: 0 }, settings, progress.step(unturned)) : cam;
  progress.done(unturned);
  const holding = (cam.holding ?? []).map(h => ({
    name: h.name,
    how: h.how,
    tabs: h.tabs.length,
    ...(h.wanted && { wanted: h.wanted }),
    ...(h.moved && { moved: true }),
  }));
  // Skins and tabs are taken care of last: after side B, when there is one, with the board turned over.
  const release = releasePrograms(flat, board, settings, !!plan.sideB, perPart);
  // Holds in the way of any move of any program: side B and the turned programs find them in the same spots on the wood.
  const clashes = spec.holdPoints?.length
    ? {
        holdClash: [
          ...new Set([
            ...jobHoldClashes({ ...spec, sideBRotationDeg: board.sideBRotationDeg }, flat.stockTop, [
              ...plan.programs,
              ...(plan.sideB?.programs ?? []).map(p => ({ ...p, turned: true })),
              ...release,
            ]),
            ...holdsOnParts(spec),
          ]),
        ].map(h => ({ x: h.x, y: h.y })),
      }
    : {};
  plan = { ...plan, ...stability(flat, spec, settings), ...clashes, ...(release.length && { release }) };
  progress.done(holds - kHoldCheckShare * work.parts);
  // A skin (or the layer on the tape) holds every part until the end.
  if (board.holdDown === 'skin' || board.holdDown === 'fixture-tape')
    return {
      ...plan,
      holding,
      skin: board.skin ?? kDefaultSkin,
      ...(board.holdDown === 'fixture-tape' && { taped: true }),
    };
  if (!usesTabs(board.holdDown)) return plan;
  return { ...plan, hold: holdCheck(flat, board, holdOptionsOf(spec, settings)), holding, skin: board.skin ?? kDefaultSkin };
}

/**
 * Does everything stay put during the job? What comes loose at which step (stock with too few holds, parts cut free
 * with nothing holding them, tabs or skins a pocket cuts away). On the board as laid out (not turned on the bed).
 */
function stability(flat: PartCam, spec: BoardSpec, settings: Partial<CamSettings>): Pick<PlanResult, 'timeline'> {
  if (spec.holdDown === 'fixture-tape') return {};
  const how = (part: string) => flat.holding?.find(h => h.name === part)?.how;
  // Nothing holds the parts, as the user chose: say so, don't block.
  const watched = spec.holdDown === 'none';
  const after = (op: string) => {
    const [, part] = op.match(/^(.+): [^:]*$/) ?? [];
    return part ? `the outline of ${part}` : op;
  };
  // With no fixture at all, the one note about the board says it: not one more per piece of stock.
  const events = holdTimeline(flat, spec, holdOptionsOf(spec, settings)).filter(ev => spec.holdPoints?.length || ev.kind !== 'pivot');
  const timeline = events.map(ev => {
    // What can turn or lift is the user's call (tape, a hand on it): said, never blocked. A part with nothing holding it
    // and a pocket through its tabs or skin aren't.
    const block = ev.kind === 'pocket' || (ev.kind === 'loose' && !watched);
    if (ev.kind === 'board')
      return {
        ...ev,
        block,
        message: ev.holds
          ? `This board has only ${ev.holds} screw${ev.holds === 1 ? '' : 's'} or clamp${ev.holds === 1 ? '' : 's'} around its middle, so it can still turn. One on the other side of the middle stops that.`
          : 'Nothing fastens this board. If that’s the plan, hold it down by hand or tape it.',
      };
    if (ev.kind === 'pocket')
      return {
        ...ev,
        block,
        message: `A pocket cuts away ${ev.cut === 'skin' ? 'the bottom skin' : 'the tabs'} holding ${ev.what}, so it would come free with the bit at depth. Give it ${ev.cut === 'skin' ? 'a skin thicker than the pocket is deep, or tabs on another edge' : 'room for tabs on other edges, or a skin thicker than the pocket is deep'}, on the Boards step.`,
      };
    const message =
      ev.kind === 'pivot'
        ? `After cutting ${after(ev.after)}, a piece of the board ${
            (ev.holds ?? 0) >= 3
              ? `has ${ev.holds} screws or clamps, but all to one side of it`
              : `is held by ${ev.holds === 0 ? 'no' : `only ${ev.holds}`} screw${ev.holds === 1 ? '' : 's'} or clamp${ev.holds === 1 ? '' : 's'}`
          }, so it can turn or lift. Keep an eye on it, or add one (ringed on the board).`
        : how(ev.what) === 'unheld'
          ? `${ev.what} has no two opposite edges where tabs would hold it, so it would come loose when its outline is cut through. On the Boards step, move it, or switch the board to a bottom skin.`
          : `${ev.what} comes loose when its outline is cut through${watched ? ', as you chose: nothing holds the parts. Keep an eye on it.' : ': no tabs into stock that is held.'}`;
    return { ...ev, block, message };
  });
  return { timeline };
}

/**
 * The guided programs after the cutting, from the board as laid out (not turned on the bed): `freePartsProgram` for
 * parts that keep a skin or the layer on the tape, `tabRemovalProgram` for "tabs + guided removal". They follow the
 * outlines' finished paths.
 */
function releasePrograms(flat: PartCam, board: BoardRequest, settings: Partial<CamSettings>, turned: boolean, perPart: boolean) {
  const feed = settings.finishFeed ?? (settings.feed ?? 1800) * (settings.finalFeedFactor ?? 0.5);
  const plungeFeed = settings.plungeFeed ?? 480;
  const finalZ = settings.finalZ ?? -0.3;
  const flipped = turned ? { turned: { h: board.h } } : {};
  const taped = board.holdDown === 'fixture-tape';
  const out: ReleaseProgram[] = [];
  const pauses = (n: number, what: string) => `${n} ${n === 1 ? 'pause' : 'pauses'}: ${what}`;
  const add = (
    kind: ReleaseProgram['kind'],
    title: string,
    note: (n: number) => string,
    cam: PartCam,
    layer: number,
    more: Partial<ReleaseProgram>
  ) => {
    if (!cam.operations.length) return;
    const count = cam.operations.filter(o => o.pauseAfter || o.pauseBefore).length;
    const minZ = turned ? flat.stockTop - layer + finalZ : finalZ;
    const made = releaseProgram(kind, title, note(count), count, cam, board, settings, minZ, rotationDeg);
    out.push({ ...made, turned, ...more });
  };
  const rotationDeg = sideRotation(board, turned);
  const turn = rotateAboutOrigin(rotationDeg);
  if (flat.holding?.some(h => h.how === 'skin')) {
    const program = freePartsProgram(flat, {
      feed,
      plungeFeed,
      finalZ,
      ...flipped,
      pause: !taped, // Taped down: nothing to take out in between.
      stepdown: t => stepdownFor(t, { ...DEFAULT_SETTINGS, ...settings }),
    });
    add(
      'free',
      'Cut the parts free',
      n => (taped ? 'No pauses: take the parts off the tape at the end' : pauses(n, n === 1 ? 'take out the part' : 'take out each part')),
      turnCam(program.cam, turn),
      board.skin ?? kDefaultSkin,
      { parts: program.parts.map(p => ({ ...p, at: turn2(turn, p.at) })) }
    );
  }
  if (board.holdDown === 'tabs-guided') {
    const program = tabRemovalProgram(flat, {
      feed,
      plungeFeed,
      ...flipped,
      ...(perPart && { perPart }),
    });
    add(
      'tabs',
      'Remove the tabs',
      n => pauses(n, perPart ? (n === 1 ? 'take out the part' : 'take out each part') : 'hold the part at each tab'),
      turnCam(program.cam, turn),
      board.tabs.height,
      { perPart, tabs: program.tabs.map(t => ({ ...t, at: turn2(turn, t.at), hold: turn2(turn, t.hold) })) }
    );
  }
  return out;
}

/**
 * G-code, numbers and safety checks of one guided program. `minZ`: turned over, the program cuts from the new top, so
 * the limit is what it has to cut through plus the usual depth past it, not the depth below the spoilboard's surface.
 */
function releaseProgram(
  kind: ReleaseProgram['kind'],
  title: string,
  note: string,
  pauses: number,
  cam: PartCam,
  board: BoardRequest,
  settings: Partial<CamSettings>,
  minZ: number,
  rotationDeg: number
): ReleaseProgram {
  const { tool } = cam.operations[0];
  const size: [number, number, number] = [board.w, board.h, board.stockTop];
  const { gcode, setup } = postProgram(cam, {
    partName: `Board ${board.name}: ${title}`,
    board: board.name,
    stockSize: size,
    spindleRpm: settings.spindleRpm,
    spindle: settings.spindle,
  });
  const timing = estimateProgramTime(gcode);
  setup.timing = timing;
  return {
    kind,
    title,
    gcode,
    timeMin: timing.estimatedAutomaticSeconds / 60,
    timing,
    setup,
    setupSheet: setupSheet(setup),
    tool: tool.number,
    diameter: tool.diameter,
    pauses,
    note,
    ops: opSummaries(cam, cam.stockTop).map(op => ({ ...op, program: { kind, title, note } })),
    safety: checkGcodeSafety(gcode, {
      stockTop: cam.stockTop,
      size: [size[0], size[1]],
      rotationDeg,
      minZ,
      toolRadius: tool.diameter / 2,
    }).map(i => `${title}: ${i.message}`),
    turned: false,
  };
}

/** The angle a side of the board lies at on the bed. Turned over it can lie differently; unless corrected, like side A. */
const sideRotation = (board: BoardRequest, turned: boolean) => (turned ? board.sideBRotationDeg : undefined) ?? board.rotationDeg ?? 0;
/** Board coordinates -> the program's: turned like the board lies on the bed. */
const turn2 = (turn: ReturnType<typeof rotateAboutOrigin>, p: { x: number; y: number }) => {
  const [x, y] = turn([p.x, p.y, 0]);
  return { x, y };
};
const turnCam = (cam: PartCam, turn: ReturnType<typeof rotateAboutOrigin>): PartCam => ({
  ...cam,
  stockSummary: undefined,
  stockFootprint: cam.stockFootprint?.map(path =>
    path.map(point => {
      const [x, y] = turn([point.x, point.y, 0]);
      return { x, y };
    })
  ),
  operations: cam.operations.map(op => ({ ...op, passes: op.passes.map(p => ({ ...p, pts: p.pts.map(turn) })) })),
});

function boardSpec(board: BoardRequest, source: BoardPartSource): BoardSpec {
  return {
    ...board,
    // Turned over, the cut-free lap depends on how well the board was realigned: the main program finishes the walls.
    finishWallsAtRelease: !board.flip,
    tabs: { ...DEFAULT_TABS, ...board.tabs },
    parts: board.parts.map(p => {
      const { size, features } = source.part(p.partId);
      return {
        id: p.id,
        name: p.name,
        features,
        // Tabs and skins keep clear of the pockets side B will cut.
        ...(board.flip && { underside: undersideOf(source, p.id, board, p.rotated) }),
        size,
        x: p.x,
        y: p.y,
        rotated: p.rotated,
        ...(p.tabsAt && { tabsAt: p.tabsAt }),
        ...(p.holes && { holes: p.holes }),
      };
    }),
  };
}

/** Depths of a part's underside measured from the stock's new top (its old bottom), as side B sees it. */
function undersideOf(source: BoardPartSource, instanceId: string, board: BoardRequest, rotated: boolean): PartFeatures {
  const partId = board.parts.find(p => p.id === instanceId)!.partId;
  const f = source.underside(partId, rotated);
  const dz = board.stockTop - source.part(partId).size[2];
  return dz
    ? {
        ...f,
        thickness: f.thickness + dz,
        levels: f.levels.map(l => ({ ...l, z: l.z + dz })),
        pockets: f.pockets.map(p => ({ ...p, floorZ: p.floorZ + dz })),
      }
    : f;
}

/** "left: Pocket 2 z=3.5" -> "left · Pocket 4.5 deep" (board programs prefix the part). */
const label = (name: string, top: number, title?: string) => {
  const split = name.lastIndexOf(': ');
  const [prefix, op] = split > 0 && split + 2 < name.length ? [name.slice(0, split), name.slice(split + 2)] : [undefined, name];
  const z = op.match(/z=([\d.]+)/);
  const text = title
    ? title[0].toUpperCase() + title.slice(1)
    : z
      ? `Pocket ${+(top - +z[1]).toFixed(2)} deep`
      : op.startsWith('Hole')
        ? 'Through hole'
        : op.startsWith('Outline')
          ? 'Outline: rough + final pass'
          : op;
  return prefix ? `${prefix} · ${text}` : text;
};

/** Per-operation numbers, safety rules and a preview of a generated program. */
/** `partTop`: the parts' top face, which pocket depths are measured from (the stock may be thicker). */
/**
 * Per-operation numbers, safety rules and a preview of a generated job, as one program per bit (FluidNC can't zero
 * Z during a pause, so bits are swapped between programs). `partTop`: the parts' top face, which pocket depths are
 * measured from (the stock may be thicker).
 */
export function summarize(
  cam: PartCam,
  name: string,
  size: [number, number, number],
  settings: Partial<CamSettings>,
  partTop = cam.stockTop,
  board?: string,
  rotationDeg = 0,
  onProgress?: OnProgress
): PlanResult {
  const split = splitByBit(cam);
  // Writing each program's G-code and timing it, then checking it: both about as long as it has points.
  const points = split.map(p => p.operations.reduce((sum, op) => sum + op.passes.reduce((n, pass) => n + pass.pts.length, 0), 0));
  const progress = progressOver(onProgress, 2 * points.reduce((sum, n) => sum + n, 0));
  const programs = split.map((p, i) => {
    const tool = p.operations[0].tool;
    const { gcode, setup } = postProgram(p, {
      partName: split.length > 1 ? `${name}, bit T${tool.number} D=${tool.diameter}` : name,
      board,
      stockSize: size,
      spindleRpm: settings.spindleRpm,
      spindle: settings.spindle,
    });
    const timing = estimateProgramTime(gcode);
    setup.timing = timing;
    progress.done(points[i]);
    return {
      tool: tool.number,
      diameter: tool.diameter,
      ...(tool.name && { name: tool.name }),
      gcode,
      timeMin: timing.estimatedAutomaticSeconds / 60,
      timing,
      setup,
      setupSheet: setupSheet(setup),
    };
  });
  const ops = opSummaries(cam, partTop);
  const safety = programs.flatMap((p, i) => {
    const issues = checkProgramSafety(split[i], p.gcode, {
      stockTop: cam.stockTop,
      size: [size[0], size[1]],
      rotationDeg,
      minZ: settings.finalZ ?? -0.3,
      toolRadius: p.diameter / 2,
    }).map(issue => issue.message);
    progress.done(points[i]);
    return issues;
  });
  // The whole job, for the preview and the totals.
  const moves = programs.flatMap(p => readGcode(p.gcode));
  return {
    gcode: programs.map(p => p.gcode).join('\n'),
    timeMin: programs.reduce((t, p) => t + p.timeMin, 0),
    warnings: cam.warnings,
    safety,
    ops,
    bits: boardBits(cam),
    programs,
    size,
    path: moves.filter(m => !m.rapid && Math.min(m.from[2], m.to[2]) < cam.stockTop - 1e-3).map(m => [m.from, m.to]),
    ...(cam.holeMiddles && { holeMiddles: cam.holeMiddles }),
  };
}

/** The numbers of each operation. `partTop`: the parts' top face, which pocket depths are measured from. */
function opSummaries(cam: PartCam, partTop: number): OpSummary[] {
  const one = (ops: typeof cam.operations) => estimateProgramTime(toGcode({ ...cam, operations: ops })).estimatedAutomaticSeconds / 60;
  return cam.operations.map(op => {
    const zs = op.passes.flatMap(p => p.pts.map(q => q[2]));
    const levels = new Set(op.passes.map(p => minOf(p.pts.map(q => q[2])).toFixed(2)));
    // Where it starts cutting: a deeper pocket starts at the floor of the one before.
    const zTop = op.kind === 'pocket' ? Math.min(cam.stockTop, maxOf(zs)) : cam.stockTop;
    const depths = [zTop, ...[...levels].map(Number).sort((a, b) => b - a)];
    return {
      name: op.name,
      // The title's depths are from the part's top; a thicker stock (allowance) doesn't change them.
      label: label(op.name, partTop, op.title),
      kind: op.kind,
      tool: {
        number: op.tool.number,
        diameter: op.tool.diameter,
        ...(op.tool.shape === 'v' && { shape: 'v' as const, angle: op.tool.angle }),
      },
      zTop,
      zBottom: minOf(zs),
      depthSteps: levels.size,
      stepdown: Math.max(...depths.slice(1).map((z, i) => depths[i] - z)),
      feeds: [...new Set(op.passes.flatMap(p => p.feeds.slice(1)))].sort((a, b) => b - a),
      timeMin: one([op]),
    };
  });
}
