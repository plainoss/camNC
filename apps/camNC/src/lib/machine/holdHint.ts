import { gcodeWords, hasWord, type Word } from './gcodeWords';
import { explainPause, isPause, type Line, memoized, type PauseHint, parsedProgram, pauseAt, positionWindow } from './pauseHints';

/** What the controller says while the job is in Hold. */
export interface HoldContext {
  /** FluidNC's `SD:` percent now. */
  percent: number | undefined;
  /** The furthest `SD:` percent seen in this job (FluidNC reads forward only). */
  readTo: number | undefined;
  /** camNC sent the feed hold (Pause, Stop). */
  holdRequested: boolean;
  mpos: { z: number } | undefined;
  /** `undefined` while the work offset is not known yet. */
  wpos: { z: number } | undefined;
  /**
   * The spindle as the controller reports its state (A:S or A:C), not the FS speed, which a disabled spindle can keep.
   * `on` from any report: FluidNC reports a spindle change right away (GCode.cpp `gc_ovr_changed()` after
   * `spindle->setState`, which makes the next report carry Ov and A), so it only errs towards the generic card. `off`
   * only from a report sent during this hold, the state while held. `undefined` otherwise.
   */
  spindle?: 'on' | 'off';
  /** The bit is where it was when camNC started this job. `false` when unknown, e.g. after a reload. */
  stillSinceStart?: boolean;
  /** Units of the reported positions (FluidNC's `$Report/Inches`), `undefined` when not known: then no Z is compared. */
  positionUnits?: 'mm' | 'inch';
}

/** How close (mm) Z must be to the height the program went to before the pause. */
const kAtZ = 0.05;

/**
 * What to explain while the job is in Hold: the M0 the controller stopped at, or `null` for the generic Hold card. When
 * unsure it is `null`: the generic card is right in the middle of a cut, a pause's steps are not.
 *
 * - The start pause, before the spindle runs, has its own signal: the reader cannot pass the first M0 without Resume,
 *   so while it has read no further and the bit is at the safe Z before it, the job has not started cutting, whoever
 *   held it. Missing that card would let a router switched by hand stay off when the cut begins. Its spindle start
 *   (M3) comes right after the M0, so that must not have run either: the spindle reported off, or the reader provably
 *   short of the end of the M3 line. A spindle reported running never gets it.
 * - A hold camNC sent is a feed hold, wherever the job is.
 * - Every other M0 also needs the bit where the program put it before that M0: a hold from the machine's button or
 *   another client, with the reader blocked just before the M0 (at the M5, say), reports nearly the same position.
 *   That holds for M0s without a camNC marker (other posts) too: at or above the last Z before the M0, if the program
 *   lifted to it (see {@link bitAtOrAbove}).
 * - A first M0 with no move before it (Fusion's "Turn ON 15000RPM") has no Z to compare with. It needs the reader to
 *   be short of the first move after it, or the bit not to have moved since camNC started the job: then nothing has
 *   been cut yet. Missing it would let a router switched by hand stay off for the cut.
 */
export function holdHint(gcode: string, c: HoldContext): PauseHint | null {
  if (c.percent === undefined) return null;
  // Parsed once per program: this runs with every status report while the job is held.
  const program = parsedProgram(gcode);
  const { lines, size } = program;
  if (!size) return null;
  const first = memoized(program, 'first pause', () => lines.findIndex(isPause));
  const start = memoized(program, 'first pause hint', () => (first >= 0 ? explainPause(lines, first, gcode) : null));
  if (start?.marker?.kind === 'start') {
    const readTo = (Math.max(c.readTo ?? c.percent, c.percent) / 100) * size;
    // Within the window: the percent may stand for a byte a little past the M0 even while the reader waits there. On a
    // file of many MB that window reaches into the first cut, so the bit must also be at the safe Z it went to first,
    // where it always is at the real start pause.
    const window = positionWindow(size);
    const atStart = readTo <= lines[first]!.end + window && bitWhereThePauseLeftIt(lines, first, false, c);
    // On a file of more than ~100 kB the window also reaches past the M3 and the dwell after the M0, into the travel at
    // safe Z with the spindle on: only the controller's spindle state tells those apart.
    const spindleNotStarted =
      c.spindle === 'off' ||
      (c.spindle !== 'on' && readTo + window < memoized(program, 'first spindle start', () => spindleStartEnd(lines, first)));
    if (atStart && spindleNotStarted) return start;
  }
  if (c.holdRequested) return null;
  const index = pauseAt(lines, size, c.percent);
  if (index < 0) return null;
  const hint = explainPause(lines, index, gcode);
  // A spindle reported running is past every pause camNC or a post writes after M5 (a tool change: lift, M5, M0): held in
  // the lift just before it, the bit can already be at that height. The done card needs the park height instead.
  if (c.spindle === 'on' && hint.marker?.kind !== 'done') return null;
  if (!hint.marker) {
    if (index === first && !memoized(program, 'moves before first pause', () => lines.slice(0, first).some(movesOrProbes))) {
      // FluidNC cannot read past the M0 without Resume. While the furthest it can have read (the reported position plus
      // the window) is short of the first move after it, the bit has not moved; that survives a reload. On a file so
      // large that the window reaches that move, only the bit not having moved since camNC started the job tells.
      const readTo = (Math.max(c.readTo ?? c.percent, c.percent) / 100) * size;
      const firstMove = memoized(program, 'first move after first pause', () => beforeFirstMoveAfter(lines, first));
      const unmoved = readTo + positionWindow(size) <= firstMove;
      return unmoved || c.stillSinceStart === true ? hint : null;
    }
    // A post's tool change or other stop comes after its M5, so the spindle must be known to have stopped: 'off' from a
    // report sent during this hold. Unknown (after a reload or reconnect in the hold) is the generic card until one comes.
    if (c.spindle !== 'off') return null;
    return bitAtOrAbove(lines, index, c) ? hint : null;
  }
  // Past the start pause's reader position above, the job is past it.
  if (hint.marker.kind === 'start') return null;
  return bitWhereThePauseLeftIt(lines, index, hint.marker.kind === 'done', c) ? hint : null;
}

/** End byte of the first spindle start (M3/M4) after line `index`, or the end of the file. */
function spindleStartEnd(lines: Line[], index: number) {
  for (let i = index + 1; i < lines.length; i++) {
    const words = gcodeWords(lines[i]!.code);
    if (words && hasWord(words, 'M', 3, 4)) return lines[i]!.end;
  }
  return lines.at(-1)!.end;
}

/** A line that moves an axis or probes, so that the bit may be anywhere after it. Unreadable lines count too. */
const movesOrProbes = (line: Line) => {
  const words = gcodeWords(line.code);
  if (!words) return true;
  return hasWord(words, 'G', 0, 1, 2, 3, 28, 30, 38.2, 38.3, 38.4, 38.5, 53) || words.some(w => 'XYZABC'.includes(w.letter));
};

/** 1 inch in mm. */
const kMmPerInch = 25.4;

/** The bit's Z in the units of the program's last Z move before the pause, if the units are known for sure. */
function reportedZ(at: ZBefore, c: HoldContext) {
  const z = at.machine ? c.mpos?.z : c.wpos?.z;
  if (z === undefined) return undefined;
  // FluidNC reports positions in mm unless `$Report/Inches` is set, which shows in the report's decimals (see the
  // stream parser). Unknown (other firmware, or before `$I` answered): nothing is compared.
  const reported = c.positionUnits;
  if (!reported) return undefined;
  return reported === at.units ? z : reported === 'inch' ? z * kMmPerInch : z / kMmPerInch;
}

/** {@link kAtZ} in the program's units. */
const atZ = (at: ZBefore) => (at.units === 'mm' ? kAtZ : kAtZ / kMmPerInch);

/**
 * Whether the bit is where the program sent it before the M0 at `index`: parked at the G53 Z for the done pause, at or
 * above the safe Z (work coordinates) for a take-out or tab pause.
 */
function bitWhereThePauseLeftIt(lines: Line[], index: number, done: boolean, c: HoldContext) {
  const at = zBefore(lines, index);
  if (!at || at.machine !== done || at.atLeast) return false;
  const z = reportedZ(at, c);
  if (z === undefined) return false;
  return done ? Math.abs(z - at.z) <= atZ(at) : z >= at.z - atZ(at);
}

/**
 * For an M0 of another post: the bit at or above the last Z the program moved to before it, in its coordinates. Only
 * evidence when that Z was a lift: a rapid (G0, G53 G0, G28/G30), or a feed move up to above every Z cut so far. Feed
 * moves at that work Z after it are cuts there, so then only a Z above every cut before it counts. After a cut (an operator stop with the bit still down), a hold with the reader just before the M0 reports the same position.
 */
function bitAtOrAbove(lines: Line[], index: number, c: HoldContext) {
  const at = zBefore(lines, index);
  const z = at?.lift ? reportedZ(at, c) : undefined;
  return !!at && z !== undefined && z >= at.z - atZ(at);
}

interface ZBefore {
  z: number;
  /** G53: machine coordinates. */
  machine: boolean;
  units: 'mm' | 'inch';
  /**
   * After G28/G30: the bit is at the stored position, which the program does not tell. It counts as at least as high as
   * the last G53 Z before it, so `z` is only a lower bound.
   */
  atLeast?: boolean;
  /** The move to `z` was a lift (see {@link bitAtOrAbove}), not a cut. */
  lift: boolean;
}

/**
 * The Z the program last moved to before line `index`, in which coordinates and units. `null` if unknown: no Z move
 * yet, no units (G20/G21) set, or since then a probe, or relative moves (G91) at that point. A work Z also becomes
 * unknown after an offset, tool length offset or coordinate system change (G10, G43, G49, G54–G59.3, G92); a machine Z
 * (G53) does not, as these do not move the bit. After G28/G30 it is the last G53 Z as a lower bound, see
 * {@link ZBefore.atLeast}.
 */
function zBefore(lines: Line[], index: number) {
  // It reads the whole program up to the M0, and the machine view asks with every report while held.
  let memo = zBeforeMemo.get(lines);
  if (!memo) zBeforeMemo.set(lines, (memo = new Map()));
  if (!memo.has(index)) memo.set(index, readZBefore(lines, index));
  return memo.get(index)!;
}

const zBeforeMemo = new WeakMap<Line[], Map<number, ZBefore | null>>();
/** G codes after which the Z of an earlier work move no longer says where the bit is in the current coordinates. */
// biome-ignore format: a list of G codes
const kZFrameChanges = [10, 28.1, 30.1, 43, 43.1, 49, 54, 55, 56, 57, 58, 59, 59.1, 59.2, 59.3, 92, 92.1, 92.2, 92.3];
const kProbes = [38.2, 38.3, 38.4, 38.5];
/** Motion modes (G0, G1, G2, G3, probes, G80), as their G number. */
const kMotionModes = [0, 1, 2, 3, ...kProbes, 80];

/**
 * The highest cut after a probe or frame change: the Z of earlier cuts no longer compares with work Z moves after it.
 * Before any cut there is nothing to compare, so a header's G54/G49/G92 or a Z probe keeps later lifts recognisable.
 */
const cutsUnknown = (highestCut: number) => (highestCut === -Infinity ? -Infinity : Infinity);

function readZBefore(lines: Line[], index: number): ZBefore | null {
  let relative = false;
  let units: 'mm' | 'inch' | undefined;
  let last: ZBefore | null = null;
  /** The motion mode in force, `undefined` until the program sets one. */
  let motion: number | undefined;
  /** The work Z (mm) the bit is at, `undefined` when not known. */
  let workZ: number | undefined;
  /** The highest work Z (mm) a feed move (or one of unknown motion) ended at or ran at: Infinity when not known. */
  let highestCut = -Infinity;
  /** The last work Z move went above every Z cut before it. */
  let aboveCuts = false;
  /** The last G53 Z move, the lower bound for G28/G30. */
  let lastMachine: { z: number; units: 'mm' | 'inch' } | null = null;
  const mm = (z: number, u: 'mm' | 'inch') => (u === 'mm' ? z : z * kMmPerInch);
  for (let i = 0; i < index; i++) {
    const words: Word[] | null = gcodeWords(lines[i]!.code);
    // FluidNC rejects such a line; what it would have done is unknown.
    if (!words) {
      last = null;
      workZ = undefined;
      highestCut = Infinity;
      continue;
    }
    // G90.1/G91.1 only set the arc centre mode: G90 and G91 exactly.
    if (hasWord(words, 'G', 90)) relative = false;
    if (hasWord(words, 'G', 91)) relative = true;
    if (hasWord(words, 'G', 21)) units = 'mm';
    if (hasWord(words, 'G', 20)) units = 'inch';
    const mode = kMotionModes.find(m => hasWord(words, 'G', m));
    if (mode !== undefined) motion = mode;
    const z = words.find(w => w.letter === 'Z');
    const axes = words.some(w => 'XYZABC'.includes(w.letter));
    // G28/G30 go to a stored position: Z too when named, or with no axis named.
    if (hasWord(words, 'G', 28, 30)) {
      if (z || !axes) {
        last = lastMachine ? { ...lastMachine, machine: true, atLeast: true, lift: true } : null;
        workZ = undefined;
      }
      continue;
    }
    // A probe moves the bit to wherever it touches.
    if (hasWord(words, 'G', ...kProbes)) {
      last = null;
      workZ = undefined;
      highestCut = cutsUnknown(highestCut);
      continue;
    }
    // Their Z (G43.1 Z…, G10 L20 Z…, G92 Z…) is not a move either. The bit stays put, so a machine Z still holds.
    if (hasWord(words, 'G', ...kZFrameChanges)) {
      if (!last?.machine) last = null;
      workZ = undefined;
      highestCut = cutsUnknown(highestCut);
      continue;
    }
    const feed = axes && motion !== 0;
    if (!z) {
      // A move at the current height: a feed move there cuts at it. Then a work Z reached by a rapid is a lift only if
      // above every cut before it (a first G0 Z11 with feed moves at that height, not a rapid to an earlier depth).
      if (feed) {
        highestCut = Math.max(highestCut, workZ ?? Infinity);
        if (!aboveCuts && last && last.lift && !last.machine) last = { ...(last as ZBefore), lift: false };
      }
      continue;
    }
    const machine = hasWord(words, 'G', 53);
    if (machine) {
      // G53 is in machine coordinates either way, also in G91.
      lastMachine = units ? { z: z.value, units } : null;
      last = units ? { z: z.value, machine, units, lift: motion === 0 } : null;
      workZ = undefined;
      // A feed move in machine coordinates: how high it cut in work coordinates is not known.
      if (feed) highestCut = Infinity;
      continue;
    }
    // A relative Z move leaves the height unknown.
    // The units in force at the move, not at the M0 (G20 / G0 Z0.6 / G21 / M0 is 0.6 inch). None set: unknown.
    if (relative || !units) {
      last = null;
      workZ = undefined;
      if (feed) highestCut = Infinity;
      continue;
    }
    const to = mm(z.value, units);
    // A feed move counts as a lift only going up from a known height, and above every cut: a plunge never is, also the
    // first one of the program (nothing cut yet) or one shallower than earlier cuts.
    const up = workZ !== undefined && to > workZ + kAtZ;
    aboveCuts = to > highestCut + kAtZ;
    last = { z: z.value, machine, units, lift: motion === 0 || (up && aboveCuts) };
    workZ = to;
    if (feed) highestCut = Math.max(highestCut, to);
  }
  // A machine Z (G53, G28/G30) holds in G91 too.
  return relative && !last?.machine ? null : last;
}

/** End byte of the line before the first move or probe after line `index`: the reader there has not moved the bit. */
function beforeFirstMoveAfter(lines: Line[], index: number) {
  for (let i = index + 1; i < lines.length; i++) if (movesOrProbes(lines[i]!)) return lines[i - 1]!.end;
  return lines.at(-1)!.end;
}
