import type { FlipRegistration, HoldDown } from '@wbcnc/cam';
import { edgeDir, holdBox, kDefaultStickout, pathClearance, type HoldKind, type HoldPoint } from '@wbcnc/cam/holdPoints';
import { nestRects, type NestResult, type Placement, type Rect } from '@wbcnc/cam/nest';
import {
  fewerHolds,
  fixturesAround,
  fixtureFree,
  settle,
  fitsMachine,
  moreHolds,
  simplifyLoops,
  snapScrew,
  suggestHolds,
  suggestHoldsGrowing,
  workBox,
  type BoardSide,
  type Fixture,
  type SettleBoard,
  type SettlePart,
  type Spots,
} from '@wbcnc/cam/settle';
import type { BoardRequest, CamPartInfo } from './camTypes';
import { kDefaultHardware, type HoldHardware } from '@wbcnc/cam-settings';
import type { MaterialKey } from './planSettings';
import { holeChoicesForPart, type HoleChoices } from './holeChoices';
import { fitCompact, fitOnMachine, fitsAsIs, nestOnSize, wholeMm, wideMachine } from './boards/fitBoard';
import { fixtureOf, fixturesNeed, fixturesOn, holdPointOf } from './boards/fixtures';
import { apart, insideMargin, placedRect } from './boards/placement';
import { letter, onlyFor, thicknessKey } from './boards/keys';

export interface StockBoardV1 {
  id: string;
  thickness: number;
  w: number;
  h: number;
  /** How many of these boards there are; undefined = as many as needed. */
  quantity?: number;
}

export interface BoardV1 {
  id: string;
  /** Physical stock generation; the logical board id and all CAD references survive replacement. */
  physicalSheetId?: string;
  /** A, B, C … in the order the boards were made, or a name the user gave it. */
  name: string;
  thickness: number;
  material: MaterialKey;
  /** Fit the board to its parts, or a fixed size (e.g. from the stock list). */
  size: { fit: true } | { fit: false; w: number; h: number };
  /** What keeps the parts in place once their outlines are cut. */
  retention: Retention;
  /** With tabs: stop at each tab at the machine, a guided program removes them. */
  guidedTabs?: boolean;
  /** Tape under the board. */
  taped?: boolean;
  /** Where the board is clamped or screwed, as the user placed them. None: tape, or held down by hand. */
  fixtures?: Fixture[];
  tabs: { width: number; height: number; minCount: number };
  /** Free border inside the board edge, mm; default bit + 2, with tabs bit + 3.5 (`defaultMargin`). */
  margin?: number;
  /** Space between parts, mm; default bit + 4, with tabs 2 × bit + 3.5 (`boardGap`). */
  gap?: number;
  /** Stock thickness measured at the machine; default the parts' thickness + `kStockAllowance`. */
  measuredThickness?: number;
  /** Bodies on this board, as instance ids (see `instancesOf`). */
  items: string[];
  /**
   * The parts' undersides, after turning the board over: how it lines up then. Default: re-align with the camera
   * when a part has features underneath.
   */
  flip?: FlipRegistration | 'off';
  /** Pin diameter for a flip on dowel pins, mm (default 6). */
  dowelDiameter?: number;
  /** Per body (instance id): tabs the user dragged into place, part frame (as laid flat), mm. Unset: picked. */
  tabsAt?: Record<string, { x: number; y: number }[]>;
  /** References retained after a CAD boundary disappears, until the user repairs the affected tabs. */
  designIssues?: Record<string, string>;
  /** Bodies the user put on this board by hand: auto-fill leaves them here. */
  pinned?: string[];
  /**
   * Bodies on this board's list that the user dragged off it, onto the table: not nested and not cut, until they are put on
   * a board again. Where each lies: its upper left corner, on the table (mm, Y down, see `layoutTable`).
   */
  setAside?: Record<string, PartPosition>;
  /**
   * Where the parts are, and the board's size when fitted: stored, so nothing moves unless asked to. Nesting only fills in
   * bodies that have no spot here.
   */
  layout?: BoardLayout;
  /**
   * Where the board lies on the bed, set at the machine (dragging the outline): the machine X/Y of its XY zero (lower
   * left corner), side A and, turned over, side B. Loading one of its programs puts the program there again.
   */
  bed?: { a?: BedSpot; b?: BedSpot };
  /**
   * What of the board is cut, recorded at the machine: when cutting began and which of its programs ran (queue entry
   * keys). Once cut, its layout and holds are locked (the wood is cut that way) until "Start over".
   */
  cut?: BoardCut;
}

export type Retention = 'tabs' | 'skin' | 'none';

/** The board's parts as laid out: bodies (instance id) at their spots, on a board of this size. */
export interface BoardLayout {
  w: number;
  h: number;
  at: Record<string, PartPosition>;
}

/** A spot on the bed, machine coordinates, mm, and the angle the board lies at there (degrees, counterclockwise). */
export interface BedSpot {
  x: number;
  y: number;
  deg?: number;
}

/** What of a board is cut. */
export interface BoardCut {
  /** Accepted source geometry used on this physical board. */
  sourceKey?: string;
  /** When its first program was done, ms since the epoch. */
  at: number;
  /** The programs done (`QueueEntry.doneId`): planned again into another program, that one isn't cut. */
  keys: string[];
  /** Programs whose execution was requested; their stock is physically committed even before completion/review. */
  startedKeys?: string[];
  /** Execution-owned preparation marks; only an unrequested preparation may release its own claim. */
  startClaims?: Record<string, { doneId: string; priorStarted: boolean; priorAll?: true }>;
  /** Every program of the board ran. */
  all?: boolean;
}

/** The board has a program cut: its layout and holds stay as they are. */
export const isCut = (board: Pick<BoardV1, 'cut'>) => !!(board.cut?.keys.length || board.cut?.startedKeys?.length);

export const physicalSheetIdOf = (board: Pick<BoardV1, 'id' | 'physicalSheetId'>) => board.physicalSheetId ?? board.id;

/** Start a replacement piece of stock without changing its layout, holding choices, or logical identity. */
export function startOverBoard(board: BoardV1): BoardV1 {
  const { cut, ...rest } = board;
  void cut;
  return { ...rest, physicalSheetId: crypto.randomUUID() };
}

/**
 * A cut board with a copy of this part, if any. A choice for all of a part's copies would change the program that was
 * cut there, which then no longer counts as cut.
 */
export function cutBoardWith<B extends Pick<BoardV1, 'cut' | 'items'>>(boards: B[], instances: PartInstance[], partId: string) {
  const copies = new Set(instances.filter(i => i.partId === partId).map(i => i.id));
  return boards.find(b => isCut(b) && b.items.some(item => copies.has(item)));
}

/** "Cut" or "Partly cut", for a cut board. */
export const cutLabel = (board: Pick<BoardV1, 'cut'>) => (board.cut?.all ? 'Cut' : 'Partly cut');

/**
 * The fields a cut board keeps: everything that decides where its parts are and what holds it. What it may still
 * change: its name, its spot on the bed, the measured thickness, what's cut.
 */
const kAfterCut = new Set<string>(['name', 'bed', 'cut', 'measuredThickness']);

/** A change to a cut board that would change how it's cut (see `isCut`). */
export function changesCutBoard(before: BoardV1, after: BoardV1 | undefined) {
  if (!isCut(before)) return false;
  if (!after) return true;
  const strip = (b: BoardV1) =>
    JSON.stringify(
      Object.entries(b)
        .filter(([k, v]) => v !== undefined && !kAfterCut.has(k))
        .sort(([a], [b]) => a.localeCompare(b))
    );
  return strip(before) !== strip(after);
}

/** Where a body sits on its board: lower left corner of its (possibly turned) outline, board frame, mm. */
export interface PartPosition {
  x: number;
  y: number;
  /** Turned 90° counterclockwise. */
  rotated: boolean;
}

/** One body to cut: the k-th of a group of identical bodies. */
export interface PartInstance {
  /** Permanent native through-hole identities, in the same order as its source polygons. */
  holeIds?: string[];
  /** Has features on its underside: needs the board turned over for a second side. */
  needsFlip?: boolean;
  id: string;
  partId: string;
  name: string;
  size: [number, number, number];
  thickness: number;
  /** Its outlines and holes as laid flat, simplified: what fixtures keep clear of. Unknown: its rectangle. */
  outline?: Pick<SettlePart, 'outer' | 'holes'>;
}

/** Simplified once per part: fixtures are checked against it while they're dragged. */
const kOutlines = new WeakMap<CamPartInfo, Pick<SettlePart, 'outer' | 'holes'>>();
function outlineOf(part: CamPartInfo) {
  let known = kOutlines.get(part);
  if (!known) kOutlines.set(part, (known = { outer: simplifyLoops(part.shape.outlines), holes: simplifyLoops(part.shape.holes) }));
  return known;
}

/** What the cutting program is told: how the parts are held, from what's chosen for the board. */
export function holdDownOf(board: Pick<BoardV1, 'retention' | 'guidedTabs' | 'taped'>): HoldDown {
  if (board.retention === 'skin') return board.taped ? 'fixture-tape' : 'skin';
  if (board.retention === 'none') return 'none';
  // Anything else gets tabs, which block the job if they can't hold: never parts cut loose by accident.
  return board.guidedTabs ? 'tabs-guided' : 'tabs';
}

/**
 * The stick-out to assume until it's measured: the deepest cut (through the stock, 0.3 mm into the spoilboard) plus
 * 10 mm, so the collet nut clears the board; at least the old fixed default.
 */
export const defaultStickout = (board: Pick<BoardV1, 'thickness' | 'measuredThickness'>) =>
  Math.max(kDefaultStickout, Math.ceil((board.measuredThickness ?? board.thickness + kStockAllowance) + 0.3 + 10));

/** The lowest the collet nut gets on this board, mm above the stock's top: the stick-out less the deepest cut. */
export const nutAboveOf = (board: Pick<BoardV1, 'thickness' | 'measuredThickness'>, stickout?: number, cutBelow = 0.3) =>
  +((stickout ?? defaultStickout(board)) - stockTopOf(board) - cutBelow).toFixed(2);

/** What a new board copies from the one it's split off, and an auto-filled board from the old one of its thickness. */
export const holdSettingsOf = (b: BoardV1): Partial<BoardV1> => ({
  retention: b.retention,
  tabs: b.tabs,
  ...(b.guidedTabs && { guidedTabs: true }),
  ...(b.taped && { taped: true }),
  ...(b.margin !== undefined && { margin: b.margin }),
  ...(b.gap !== undefined && { gap: b.gap }),
});

export const kRetentionLabels: Record<Retention, string> = {
  tabs: 'Tabs',
  skin: 'Bottom skin',
  none: 'Nothing, I watch them',
};

/** "2 clamps, 1 screw". */
export function fixtureCount(fixtures: Pick<Fixture, 'kind'>[] = []) {
  const clamps = fixtures.filter(f => f.kind === 'clamp').length;
  const screws = fixtures.length - clamps;
  return [clamps && `${clamps} clamp${clamps > 1 ? 's' : ''}`, screws && `${screws} screw${screws > 1 ? 's' : ''}`]
    .filter(Boolean)
    .join(', ');
}

import { kTabWeb, defaultMargin, boardGap, freezeSpacing, spacingProblem, edgeNote } from './boards/spacing';
export { kTabWeb, defaultMargin, boardGap, freezeSpacing, spacingProblem, edgeNote };
export { fixtureOf, holdPointOf, placedRect };
/** Boards are bought a little thicker than the parts: cutting starts at thickness + this unless measured. */
export const kStockAllowance = 0.3;
export const stockTopOf = (board: Pick<BoardV1, 'thickness' | 'measuredThickness'>) =>
  board.measuredThickness ?? +(board.thickness + kStockAllowance).toFixed(2);
export const kDefaultTabs = { width: 5, height: 2, minCount: 3 };

export function instancesOf(parts: CamPartInfo[], milled: (partId: string) => boolean): PartInstance[] {
  return (
    parts
      // 3D parts default to not milled (camQueries); milling one anyway is the user's call.
      .filter(p => milled(p.id))
      .flatMap(p =>
        p.names.map((name, k) => ({
          id: `${p.id}#${k}`,
          partId: p.id,
          name,
          size: p.size,
          thickness: p.thickness,
          needsFlip: p.summary.needsFlip,
          ...(p.holeIds && { holeIds: p.holeIds }),
          outline: outlineOf(p),
        }))
      )
  );
}

/** What a board is called: "Board A" until it's given a name of its own. */
export const boardLabel = (board: Pick<BoardV1, 'name'>) => (/^([A-Z]|B\d+)$/.test(board.name) ? `Board ${board.name}` : board.name);

/** Why a board can't have this name: it's in messages at the machine and in the G-code file's name. */
export function boardNameProblem(name: string, boards: Pick<BoardV1, 'id' | 'name'>[], id: string): string | null {
  if (!name) return 'A board needs a name.';
  if (name.length > 30) return 'That name is too long: 30 characters at most.';
  if (/[/\\:*?"<>|]/.test(name)) return 'A board’s name goes in the G-code file’s name, so it can’t have any of / \\ : * ? " < > |.';
  if (boards.some(b => b.id !== id && b.name === name)) return `There already is a board called ${name}.`;
  return null;
}

export function newBoard(
  boards: BoardV1[],
  thickness: number,
  material: MaterialKey,
  items: string[] = [],
  id: string = crypto.randomUUID()
): BoardV1 {
  const used = new Set(boards.map(b => b.name));
  let i = 0;
  while (used.has(letter(i))) i++;
  return {
    id,
    name: letter(i),
    thickness: thicknessKey(thickness),
    material,
    size: { fit: true },
    retention: 'tabs',
    tabs: kDefaultTabs,
    items,
  };
}

/** A new board's material: thin boards (back panels, drawer bottoms: 6 mm or less) are usually plywood or HDF. */
export const defaultMaterial = (thickness: number, material: MaterialKey): MaterialKey =>
  thickness <= 6 && material !== 'mdf' ? 'plywood' : material;

/**
 * Keep the user's boards in sync with the parts to mill: drop bodies that are gone (or not milled any more), put new
 * ones on the first board of their thickness (making one if needed). Empty boards stay until deleted (the user may
 * be about to drag parts onto them).
 */
export function reconcileBoards(
  boards: BoardV1[] | undefined,
  instances: PartInstance[],
  material: MaterialKey,
  { preserveReferences = false } = {}
): BoardV1[] {
  const byId = new Map(instances.map(i => [i.id, i]));
  let out = (boards ?? []).map(b => {
    const items = preserveReferences
      ? [...b.items]
      : b.items.filter(id => byId.get(id)?.thickness !== undefined && thicknessKey(byId.get(id)!.thickness) === b.thickness);
    // Saved before `retention`: tabs, which say so if they can't hold.
    const held = { ...b, retention: b.retention ?? ('tabs' as const), items };
    const pins = b.pinned ? { ...held, pinned: b.pinned.filter(id => items.includes(id)) } : held;
    const kept = b.setAside ? { ...pins, setAside: onlyFor(b.setAside, items) } : pins;
    // Saved before layouts were stored: its parts get new spots, so what was cut on it no longer applies.
    if (!b.layout) {
      return kept.cut ? startOverBoard(kept) : kept;
    }
    return { ...kept, layout: { ...b.layout, at: onlyFor(b.layout.at, items) } };
  });
  const placed = new Set(out.flatMap(b => b.items));
  for (const inst of instances) {
    if (placed.has(inst.id)) continue;
    const t = thicknessKey(inst.thickness);
    const board = out.find(b => b.thickness === t);
    if (board) board.items.push(inst.id);
    // The same id every time for the same thickness: until the boards are saved (the Boards step), every change to the
    // job makes them afresh, and a new id would make them new boards (planned again, the one shown gone).
    else out = [...out, newBoard(out, t, defaultMaterial(t, material), [inst.id], `auto-${t}mm`)];
  }
  return out;
}

export interface BoardNest extends NestResult {
  /** The physical stock must fit, even when all its retained parts fit inside the work area. */
  machineFits?: boolean;
  gap: number;
  margin: number;
  /** The job's bit, mm: what the fixtures' clearances go by. */
  bit: number;
  /** Where the board is screwed or clamped: `board.fixtures`, in the same order. */
  holds: HoldPoint[];
  /** The bit's stick-out below the collet nut, mm, and how low the nut gets over the board on the deepest cut. */
  stickout: number;
  nutAbove: number;
}

export interface NestOptions {
  /** Native CAD edits keep placements. Uncut fitted boards may grow; fixed boards and geometric conflicts need repair. */
  preserveLayout?: boolean;
  /** Only where the parts go, no hold points. */
  holds?: boolean;
  stickout?: number;
  hardware?: HoldHardware;
  /**
   * The machine's work area (X × Y, mm): a board fitted to its parts stays within it and lies with its long side along
   * the machine's long axis. Parts that don't fit then are `unplaced` (see `keepWithinMachine`).
   */
  machine?: { w: number; h: number };
}

/**
 * A board's size for people: "571 × 739", or "–" for a fitted board with nothing on it yet (its size is only the
 * edge margins).
 */
export function boardSizeLabel(board: Pick<BoardV1, 'size'>, nest: Pick<BoardNest, 'board' | 'placements'>): string {
  if (board.size.fit && !nest.placements.length) return '–';
  return `${+nest.board.w.toFixed(1)} × ${+nest.board.h.toFixed(1)}`;
}

/**
 * The board as laid out: bodies at their stored spots (one that no longer works, off the board or on another part, is
 * ignored), then nesting only for bodies without a spot, around the others and the fixtures. A board with no layout yet
 * is simply nested tight: fixtures come after the parts, and `settleBoard` makes room for them.
 */
export function nestBoard(board: BoardV1, instances: PartInstance[], bit: number, opts: NestOptions = {}): BoardNest {
  const byId = new Map(instances.map(i => [i.id, i]));
  const ids = board.items.filter(id => byId.has(id) && !board.setAside?.[id]);
  const aside = board.items.filter(id => byId.has(id) && board.setAside?.[id]);
  const gap = board.gap ?? boardGap(bit, board.retention);
  const margin = board.margin ?? defaultMargin(bit, board.retention);
  const hw = opts.hardware ?? kDefaultHardware;
  const nutAbove = nutAboveOf(board, opts.stickout);
  const size =
    opts.preserveLayout && isCut(board) && board.layout
      ? { w: board.layout.w, h: board.layout.h }
      : board.size.fit
        ? undefined
        : { w: board.size.w, h: board.size.h };
  const machine = board.size.fit ? opts.machine : undefined;
  // A fitted layout bigger than the machine (stored before the machine was known): nested again, within it, around the
  // parts placed by hand that are on the machine.
  const oversize =
    !opts.preserveLayout && !!board.layout && !!machine && !isCut(board) && !fitsMachine(machine, board.layout.w, board.layout.h);
  const stored = oversize ? { at: onlyFor(board.layout!.at, board.pinned ?? []) } : board.layout;
  // The size to place on: fixed, or as the layout left it. A fitted board may still grow.
  const on = size ?? (stored && !oversize ? { w: board.layout!.w, h: board.layout!.h } : undefined);
  const holdsOn = (b: { w: number; h: number }) => (board.fixtures ?? []).map(f => holdPointOf(f, b, hw, nutAbove));

  const fixed: Placement[] = [];
  const fixedRects: Rect[] = [];
  const invalid = opts.preserveLayout
    ? board.items.filter(id => !byId.has(id) || thicknessKey(byId.get(id)!.thickness) !== board.thickness || !!board.designIssues?.[id])
    : [];
  for (const id of ids) {
    const pos = stored?.at[id];
    if (!pos) continue;
    const r = placedRect(pos, byId.get(id)!);
    // A cut board's parts are where they were cut, whatever the spacing says now.
    const limit = opts.preserveLayout && board.size.fit && !isCut(board) ? undefined : on;
    if (!insideMargin(r, margin, limit) || !fixedRects.every(o => apart(r, o, gap))) {
      if (opts.preserveLayout) invalid.push(id);
      else if (!isCut(board)) continue;
    }
    if (oversize && !insideMargin(r, margin, machine)) continue;
    fixed.push({ id, x: pos.x, y: pos.y, rotated: pos.rotated });
    fixedRects.push(r);
  }
  const items = ids.filter(id => !fixed.some(p => p.id === id)).map(id => ({ id, w: byId.get(id)!.size[0], h: byId.get(id)!.size[1] }));
  // Clear of what's there: the fixtures' footprints with room for the cut, less what the nest keeps from a part anyway.
  const keepOutOf = (h: HoldPoint): Rect => {
    const b = holdBox(h);
    const keep = pathClearance(h, bit / 2) - bit / 2 - (gap - bit);
    const [kx, ky] = [Math.max(keep, -b.w / 2), Math.max(keep, -b.h / 2)];
    return { x: b.x - kx, y: b.y - ky, w: b.w + 2 * kx, h: b.h + 2 * ky };
  };
  const around = (b: { w: number; h: number }) => [...fixedRects, ...holdsOn(b).map(keepOutOf)];
  let n: NestResult;
  if (size) {
    n = nestOnSize(items, size, gap, margin, around(size));
  } else {
    const roomOn = on && items.length ? nestRects(items, { gap, margin, keepOuts: around(on), board: on }) : undefined;
    // Growing up and to the right: fixtures on the other edges and screws stay where they are, so parts keep off them.
    const staying = (board.fixtures ?? [])
      .filter(f => f.kind === 'screw' || f.side === 'left' || f.side === 'bottom')
      .map(f => keepOutOf(holdPointOf(f, { w: 0, h: 0 }, hw, nutAbove)));
    const keep = [...fixedRects, ...staying];
    n =
      roomOn && !roomOn.unplaced.length
        ? roomOn
        : machine
          ? fitOnMachine(items, gap, margin, keep, machine)
          : fitCompact(items, gap, margin, keep);
  }

  const order = new Map(ids.map((id, i) => [id, i]));
  const placements = [...fixed, ...n.placements].sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  // A fitted board is cut from a sheet: whole mm, rounded up (570.4 × 738.9 -> 571 × 739), though not past the
  // machine. It never shrinks on its own.
  const fitted = {
    w: Math.max(n.board.w, placements.length && on ? on.w : 0),
    h: Math.max(n.board.h, placements.length && on ? on.h : 0),
  };
  const natural = size ?? wholeMm(fitted, machine);
  // Keep edited parts at their stored spots, but don't grow fitted stock past the machine. A layout that fits
  // turned is still valid; an already larger saved board is not silently shrunk to a different sheet.
  const capacity =
    machine && !fitsAsIs(machine, natural) && natural.w >= natural.h !== wideMachine(machine) ? { w: machine.h, h: machine.w } : machine;
  const out =
    !size && opts.preserveLayout && capacity && !fitsMachine(capacity, natural.w, natural.h)
      ? { w: Math.min(natural.w, Math.max(on?.w ?? 0, capacity.w)), h: Math.min(natural.h, Math.max(on?.h ?? 0, capacity.h)) }
      : natural;
  if (opts.preserveLayout) {
    for (const placement of placements) {
      const r = placedRect(placement, byId.get(placement.id)!);
      if (!insideMargin(r, margin, out) || (capacity && !insideMargin(r, 0, capacity))) invalid.push(placement.id);
    }
  }
  const unplaced = [...new Set([...n.unplaced, ...invalid, ...aside])];
  const rejected = new Set(unplaced);
  const area = placements.reduce((a, p) => a + (rejected.has(p.id) ? 0 : byId.get(p.id)!.size[0] * byId.get(p.id)!.size[1]), 0);
  return {
    ...n,
    unplaced,
    board: out,
    ...(opts.machine && { machineFits: fitsMachine(opts.machine, out.w, out.h) }),
    placements,
    yield: out.w * out.h > 0 ? Math.min(1, area / (out.w * out.h)) : 0,
    gap,
    margin,
    bit,
    holds: opts.holds === false ? [] : holdsOn(out),
    stickout: opts.stickout ?? defaultStickout(board),
    nutAbove,
  };
}

/**
 * No fitted board bigger than the machine: parts that don't fit on theirs within the work area move to another fitted
 * board of their thickness with room for them, else onto a new board (with the same hold settings), made as often as
 * needed. Cut boards, fixed-size boards and parts placed by hand stay; a part too big for the machine on its own stays
 * where it is (it shows as not fitting).
 */
export function keepWithinMachine(boards: BoardV1[], instances: PartInstance[], bit: number, opts: NestOptions): BoardV1[] {
  const machine = opts.machine;
  if (!machine) return boards;
  const nest = (b: BoardV1) => nestBoard(b, instances, bit, { ...opts, holds: false });
  const movable = (b: BoardV1) => b.size.fit && !isCut(b);
  let out = [...boards];
  for (let i = 0; i < out.length; i++) {
    const b = out[i];
    if (!movable(b)) continue;
    const over = nest(b).unplaced.filter(id => !b.pinned?.includes(id) && !b.setAside?.[id]);
    // Alone on a board it still doesn't fit: moving it wouldn't help.
    const spill = over.filter(id => !nest({ ...b, items: [id], pinned: [], layout: undefined, fixtures: [] }).unplaced.length);
    if (!spill.length) continue;
    out[i] = { ...b, items: b.items.filter(id => !spill.includes(id)) };
    let rest = spill;
    for (let j = 0; j < out.length && rest.length; j++) {
      const o = out[j];
      if (j === i || !movable(o) || o.thickness !== b.thickness) continue;
      const before = nest(o);
      if (before.unplaced.length) continue;
      const placed = new Set(nest({ ...o, items: [...o.items, ...rest] }).placements.map(p => p.id));
      // Only what fits with everything already on it.
      const take = rest.filter(id => placed.has(id));
      if (!take.length || !o.items.every(id => placed.has(id))) continue;
      out[j] = { ...o, items: [...o.items, ...take] };
      rest = rest.filter(id => !take.includes(id));
    }
    if (!rest.length) continue;
    // The same id every time for the same overflow (see `reconcileBoards`): this one is nested in turn, and spills on.
    let id = `${b.id}+`;
    while (out.some(o => o.id === id)) id += '+';
    out = [...out.slice(0, i + 1), { ...newBoard(out, b.thickness, b.material, rest, id), ...holdSettingsOf(b) }, ...out.slice(i + 1)];
  }
  return out;
}

/** The board with its nest stored: from then on its parts stay where they are. */
export function withLayout(board: BoardV1, nest: Pick<BoardNest, 'board' | 'placements'>): BoardV1 {
  const rest = { ...board };
  delete rest.layout;
  // A cut board keeps one even with no part left: it's how a board saved before layouts is told apart.
  if (!nest.placements.length && !isCut(board)) return rest;
  const at = Object.fromEntries(nest.placements.map(p => [p.id, { x: p.x, y: p.y, rotated: p.rotated }]));
  return { ...rest, layout: { w: nest.board.w, h: nest.board.h, at } };
}

/** What `settle` works on: the board's parts at these spots, on a board of this size. */
function settleInput(
  board: BoardV1,
  at: Record<string, PartPosition>,
  size: { w: number; h: number },
  instances: PartInstance[],
  bit: number,
  opts: NestOptions
): { input: SettleBoard; spots: Spots } {
  const hw = opts.hardware ?? kDefaultHardware;
  const nutAbove = nutAboveOf(board, opts.stickout);
  const keep = (kind: HoldKind, height: number) => pathClearance({ kind, height, nutAbove }, bit / 2) + bit / 2;
  const parts: SettlePart[] = [];
  const spots: Spots = {};
  for (const inst of instances) {
    const pos = at[inst.id];
    if (!pos) continue;
    const r = placedRect(pos, inst);
    const turn = (loops: [number, number][][]) =>
      pos.rotated ? loops.map(l => l.map(([x, y]): [number, number] => [inst.size[1] - y, x])) : loops;
    const rect: [number, number][] = [
      [0, 0],
      [inst.size[0], 0],
      [inst.size[0], inst.size[1]],
      [0, inst.size[1]],
    ];
    parts.push({ id: inst.id, w: r.w, h: r.h, outer: turn(inst.outline?.outer ?? [rect]), holes: turn(inst.outline?.holes ?? []) });
    spots[inst.id] = { x: pos.x, y: pos.y };
  }
  return {
    spots,
    input: {
      w: size.w,
      h: size.h,
      gap: board.gap ?? boardGap(bit, board.retention),
      margin: board.margin ?? defaultMargin(bit, board.retention),
      parts,
      sizes: { clampReach: hw.clamp.d, clampWidth: hw.clamp.w, screwD: hw.screw.d },
      keep: { clamp: keep('clamp', hw.clamp.height), screw: keep('screw', hw.screw.height) },
      keepAt: keep,
    },
  };
}

/** The board as it stands, for `settle` and its helpers. */
export function settleInputOf(
  board: BoardV1,
  nest: Pick<BoardNest, 'board' | 'placements'>,
  instances: PartInstance[],
  bit: number,
  opts: NestOptions = {}
) {
  return settleInput(board, withLayout(board, nest).layout?.at ?? {}, nest.board, instances, bit, opts);
}

const withSpots = (board: BoardV1, at: Record<string, PartPosition>, spots: Spots, w: number, h: number): BoardV1 => ({
  ...board,
  layout: {
    w,
    h,
    at: Object.fromEntries(Object.entries(at).map(([id, p]) => [id, { ...p, ...(spots[id] ?? {}) }])),
  },
});

export interface SettleOptions extends NestOptions {
  /** How hard to look: less while a fixture is being dragged. */
  budget?: number;
}

/**
 * The board with these fixtures, and only the parts in their way moved (see `settle`). A fitted board may grow. Null: no
 * room for them on this size.
 */
export function settleBoard(
  board: BoardV1,
  instances: PartInstance[],
  bit: number,
  fixtures: Fixture[],
  opts: SettleOptions = {}
): BoardV1 | null {
  const nest = nestBoard(board, instances, bit, { ...opts, holds: false });
  const at = withLayout(board, nest).layout?.at ?? {};
  const { input, spots } = settleInput(board, at, nest.board, instances, bit, opts);
  const r = settle(input, spots, fixtures, board.size.fit, opts.budget);
  return r && { ...withSpots(board, at, r.spots, r.w, r.h), fixtures };
}

/**
 * A fitted board whose holds are in the parts' way: a layout stays where it was stored, but a new clamp size, bit or
 * stick-out asks for more room around the holds. The parts move and the board grows as for a hold just placed. A fixed
 * size or a cut board stays as it is: there the job's own check (`jobHoldClashes`) points at the hold.
 */
export function keepFixturesClear(board: BoardV1, instances: PartInstance[], bit: number, opts: NestOptions = {}): BoardV1 {
  const fixtures = board.fixtures ?? [];
  if (opts.preserveLayout || !board.size.fit || isCut(board) || !board.layout || !fixtures.length) return board;
  const nest = nestBoard(board, instances, bit, { ...opts, holds: false });
  const { input, spots } = settleInputOf(board, nest, instances, bit, opts);
  if (fixtures.every(f => fixtureFree(input, spots, f))) return board;
  return settleBoard(board, instances, bit, fixtures, opts) ?? board;
}

/**
 * Laid out again: its bodies stay on it, none pinned any more, those set aside back on it, nested tight and then moved only
 * as far as the fixtures need. If they leave no such way, nested around them.
 */
export function relayoutBoard(board: BoardV1, instances: PartInstance[], bit: number, opts: NestOptions = {}): BoardV1 {
  const fresh = { ...board };
  delete fresh.setAside;
  delete fresh.pinned;
  return nestAfresh(fresh, instances, bit, opts);
}

/**
 * A board of this size, laid out for it: what's on it nests again, what has no room goes off it (it stays on its list, and
 * comes back when there is room), and it stays on the table. Screws and the clamps along its sides keep their distance to the
 * top edge, like the board's material does: the size comes or goes at the bottom.
 */
export function resizedBoard(
  board: BoardV1,
  nest: Pick<BoardNest, 'board'>,
  size: { w: number; h: number },
  instances: PartInstance[],
  bit: number,
  opts: NestOptions = {}
): BoardV1 {
  const dy = size.h - nest.board.h;
  return nestAfresh(
    {
      ...board,
      size: { fit: false, ...size },
      ...(board.fixtures && {
        fixtures: board.fixtures.map(f =>
          f.kind === 'screw' ? { ...f, y: f.y + dy } : f.side === 'left' || f.side === 'right' ? { ...f, at: f.at + dy } : f
        ),
      }),
    },
    instances,
    bit,
    opts
  );
}

/** The smallest whole 10 mm of this side (the other as it is) where the board's parts all still fit, or null if nothing up to `most` does. */
export function tightestSide(
  board: BoardV1,
  nest: Pick<BoardNest, 'board'>,
  side: 'w' | 'h',
  most: number,
  instances: PartInstance[],
  bit: number,
  opts: NestOptions = {}
): number | null {
  const fits = (v: number) =>
    !nestBoard({ ...board, layout: undefined, size: { fit: false, ...nest.board, [side]: v } }, instances, bit, {
      ...opts,
      holds: false,
    }).unplaced.filter(id => !board.setAside?.[id]).length;
  const step = 10;
  let v = Math.ceil(nest.board[side] / step) * step;
  if (fits(v)) {
    while (v > step && fits(v - step)) v -= step;
    return v;
  }
  while (v < most) {
    v += step;
    if (fits(v)) return v;
  }
  return null;
}

function nestAfresh(board: BoardV1, instances: PartInstance[], bit: number, opts: NestOptions): BoardV1 {
  const fresh = { ...board };
  delete fresh.layout;
  const bare = { ...fresh };
  delete bare.fixtures;
  const tight = withLayout(bare, nestBoard(bare, instances, bit, { ...opts, holds: false }));
  const hw = opts.hardware ?? kDefaultHardware;
  if (!board.fixtures?.length) return tight;
  // None of its parts fit: the fixtures stay, as far as they're on it.
  if (!tight.layout) return { ...tight, fixtures: board.size.fit ? board.fixtures : fixturesOn(board.fixtures, board.size, hw) };
  // As small as it gets with the fixtures still on it.
  const need = fixturesNeed(board.fixtures, hw);
  const sized = board.size.fit
    ? { ...tight, layout: { ...tight.layout, w: Math.max(tight.layout.w, need.w), h: Math.max(tight.layout.h, need.h) } }
    : tight;
  const fixtures = board.size.fit ? board.fixtures : fixturesOn(board.fixtures, sized.layout!, hw);
  const settled = settleBoard(sized, instances, bit, fixtures, { ...opts, budget: 600 });
  return settled ?? withLayout({ ...fresh, fixtures }, nestBoard({ ...fresh, fixtures }, instances, bit, opts));
}

const spacingOf = (b: BoardV1) => JSON.stringify([b.size, b.margin, b.gap, b.retention]);

/**
 * A change to the board's settings, applied to its layout: a new size, margin or gap moves only the parts it has to. Back
 * to "Fit to parts": laid out again, which is how it gets smaller. No way to keep the layout: nested afresh.
 */
export function respaceBoard(prev: BoardV1, next: BoardV1, instances: PartInstance[], bit: number, opts: NestOptions = {}): BoardV1 {
  if (spacingOf(prev) === spacingOf(next) || !prev.layout) return next;
  if (next.size.fit && !prev.size.fit) return relayoutBoard({ ...next, pinned: prev.pinned }, instances, bit, opts);
  const size = next.size.fit ? { w: prev.layout.w, h: prev.layout.h } : { w: next.size.w, h: next.size.h };
  const onIt = { ...next, fixtures: fixturesOn(next.fixtures, size, opts.hardware ?? kDefaultHardware) };
  const { input, spots } = settleInput(onIt, prev.layout.at, size, instances, bit, opts);
  const r = settle(input, spots, onIt.fixtures, next.size.fit, 600);
  if (r) return withSpots(onIt, prev.layout.at, r.spots, r.w, r.h);
  delete (onIt as Partial<BoardV1>).layout;
  return onIt;
}

/**
 * Suggested clamps for the board, on top of what's on it, with the parts nudged aside where needed. A board fitted to its
 * parts gets a border when no edge has room (see `suggestHoldsGrowing`); a fixed one stays its size.
 */
export function suggestFixtures(
  board: BoardV1,
  instances: PartInstance[],
  bit: number,
  opts: NestOptions & { machine?: { w: number; h: number } } = {}
): BoardV1 {
  const nest = nestBoard(board, instances, bit, { ...opts, holds: false });
  const at = withLayout(board, nest).layout?.at ?? {};
  const { input, spots } = settleInput(board, at, nest.board, instances, bit, opts);
  const existing = board.fixtures ?? [];
  const r = board.size.fit
    ? suggestHoldsGrowing(input, spots, existing, opts.machine)
    : { ...suggestHolds(input, spots, existing), ...nest.board };
  return { ...withSpots(board, at, r.spots, r.w, r.h), fixtures: r.fixtures };
}

/**
 * Exactly one clamp more or fewer than the board has, as a nudge from what Suggest holds gave: no part or other hold moves
 * and the board doesn't grow. No room for another, or none can go and leave the work surrounded: the board as it is.
 */
export function nudgeFixtures(board: BoardV1, instances: PartInstance[], bit: number, more: boolean, opts: NestOptions = {}): BoardV1 {
  const nest = nestBoard(board, instances, bit, { ...opts, holds: false });
  const at = withLayout(board, nest).layout?.at ?? {};
  const { input, spots } = settleInput(board, at, nest.board, instances, bit, opts);
  const existing = board.fixtures ?? [];
  const fixtures = (more ? moreHolds : fewerHolds)(input, spots, existing);
  return { ...withSpots(board, at, spots, nest.board.w, nest.board.h), fixtures };
}

/** A fixture at a point: a clamp grips the nearest edge there, a new screw lands on the most forgiving spot nearby. */
export function fixtureAt(
  kind: HoldKind,
  p: { x: number; y: number },
  board: BoardV1,
  nest: Pick<BoardNest, 'board' | 'placements'>,
  instances: PartInstance[],
  bit: number,
  opts: NestOptions & { exact?: boolean; clampWidth?: number } = {}
): Fixture {
  const { w, h } = nest.board;
  if (kind === 'screw') {
    if (opts.exact) return { kind, x: +p.x.toFixed(1), y: +p.y.toFixed(1) };
    const { input, spots } = settleInputOf(board, nest, instances, bit, opts);
    return { kind, ...snapScrew(input, spots, +p.x.toFixed(1), +p.y.toFixed(1)) };
  }
  const hw = opts.hardware ?? kDefaultHardware;
  const dir = edgeDir(p, { w, h });
  const side: BoardSide = dir.x === 1 ? 'left' : dir.x === -1 ? 'right' : dir.y === 1 ? 'bottom' : 'top';
  const along = side === 'left' || side === 'right';
  // A clamp of its own width stops where that one reaches the end of the edge.
  const half = (opts.clampWidth ?? hw.clamp.w) / 2;
  return { kind, side, at: Math.round(Math.max(half, Math.min((along ? h : w) - half, along ? p.y : p.x))) };
}

/** The board's second side: as chosen, else re-align with the camera when a part on it has features underneath. */
export function flipOf(board: BoardV1, instances: PartInstance[]): FlipRegistration | 'off' {
  if (board.flip) return board.flip;
  return instances.some(i => board.items.includes(i.id) && i.needsFlip) ? 'camera' : 'off';
}

export function boardRequest(
  board: BoardV1,
  nest: BoardNest,
  instances: PartInstance[],
  hold: { skin?: number; holes?: HoleChoices; leaveOut?: readonly string[] } = {}
): BoardRequest {
  const byId = new Map(instances.map(i => [i.id, i]));
  // A stored spot that no longer works stays in the layout, for when the edit is undone, but its part is unplaced: drawn
  // off the board (see `onBoardOnly`), and never an executable placement.
  const excluded = new Set([...(nest.unplaced ?? []), ...(hold.leaveOut ?? [])]);
  return {
    id: board.id,
    name: board.name,
    w: nest.board.w,
    h: nest.board.h,
    thickness: board.thickness,
    stockTop: stockTopOf(board),
    holdDown: holdDownOf(board),
    clearHoles: true,
    ...(board.taped && { taped: true }),
    holdPoints: nest.holds,
    tabs: board.tabs,
    ...(flipOf(board, instances) !== 'off' && {
      flip: { registration: flipOf(board, instances) as FlipRegistration, dowelDiameter: board.dowelDiameter },
    }),
    ...(hold.skin !== undefined && { skin: hold.skin }),
    parts: nest.placements
      .filter(p => nest.machineFits !== false && !excluded.has(p.id))
      .map(p => {
        const source = byId.get(p.id)!;
        const holes = holeChoicesForPart(source, hold.holes?.[source.partId]);
        return {
          id: p.id,
          partId: source.partId,
          name: source.name,
          x: p.x,
          y: p.y,
          rotated: p.rotated,
          ...(board.tabsAt?.[p.id]?.length && { tabsAt: board.tabsAt[p.id] }),
          ...(holes && { holes }),
        };
      }),
  };
}

/** Do these holds stand around the middle of the placed parts? */
export function holdsSurroundWork(
  fixtures: Fixture[],
  nest: Pick<BoardNest, 'board' | 'placements'>,
  hw: HoldHardware,
  instances: PartInstance[]
) {
  const parts = nest.placements.flatMap(p => {
    const inst = instances.find(i => i.id === p.id);
    return inst ? [{ id: p.id, ...placedRect(p, inst) }] : [];
  });
  const work = workBox({ ...nest.board, parts }, Object.fromEntries(parts.map(p => [p.id, p])));
  return fixturesAround({ ...nest.board, sizes: { clampReach: hw.clamp.d, clampWidth: hw.clamp.w, screwD: hw.screw.d } }, work, fixtures);
}

/** Whether the holds stand around the work: the one thing the Boards step says about holding. It checks where, not force. */
export function holdVerdict(
  board: Pick<BoardV1, 'fixtures' | 'taped'>,
  nest: Pick<BoardNest, 'board' | 'placements'>,
  hw: HoldHardware,
  instances: PartInstance[]
): { tone: 'ok' | 'warn' | 'none'; text: string } {
  const fixtures = board.fixtures ?? [];
  const names = fixtureCount(fixtures);
  if (board.taped) return { tone: 'ok', text: names ? `${names} and tape.` : 'Tape holds this board.' };
  if (!fixtures.length) return { tone: 'none', text: 'Nothing fastens this board. If that’s the plan, you hold it down by hand.' };
  const around = holdsSurroundWork(fixtures, nest, hw, instances);
  return around
    ? {
        tone: 'ok',
        text: `${names} around the work’s middle, which should stop it turning. Force isn’t checked here. The Plan step checks each piece as it’s cut.`,
      }
    : {
        tone: 'warn',
        text: `${names}: the board can still turn. A hold on the other side of the work’s middle would help. This is a note, not a block.`,
      };
}

/** What a change to the layout did: "Part 1, Part 3 move 15 mm right. Board size unchanged." */
export function layoutChange(
  before: Pick<BoardNest, 'board' | 'placements'>,
  after: Pick<BoardNest, 'board' | 'placements'>,
  instances: PartInstance[]
) {
  const moved = after.placements.flatMap(p => {
    const q = before.placements.find(x => x.id === p.id);
    return q && Math.hypot(p.x - q.x, p.y - q.y) > 0.5
      ? [{ name: instances.find(i => i.id === p.id)?.name ?? p.id, dx: p.x - q.x, dy: p.y - q.y }]
      : [];
  });
  const grew = after.board.w > before.board.w || after.board.h > before.board.h;
  if (!moved.length && !grew) return 'Fits as is. No part moves.';
  const [m] = moved;
  const how =
    m &&
    `${moved.map(x => x.name).join(', ')} ${moved.length > 1 ? 'move' : 'moves'} ${Math.round(Math.hypot(m.dx, m.dy))} mm ${
      Math.abs(m.dx) >= Math.abs(m.dy) ? (m.dx > 0 ? 'right' : 'left') : m.dy > 0 ? 'up' : 'down'
    }.`;
  return `${how ?? ''} ${grew ? `Board grows to ${after.board.w} × ${after.board.h}.` : 'Board size unchanged.'}`.trim();
}

export { layoutSummary } from './boards/summary';
export { dropPart, notAside, restoreBoards, setAsidePart, spotFree, type PartDrop } from './boards/partDrop';
export { autoFillFromStock, withinMachine } from './boards/autoFill';

export interface MissingPart {
  id: string;
  name: string;
  board: string;
}

/** Parts on a board that don't fit on it: they would silently not be cut. */
export function missingParts<B extends { board: BoardV1; nest: BoardNest }>(boards: B[], instances: PartInstance[]): MissingPart[] {
  const byId = new Map(instances.map(i => [i.id, i]));
  return boards.flatMap(b => b.nest.unplaced.map(id => ({ id, name: byId.get(id)?.name ?? id, board: b.board.name })));
}
