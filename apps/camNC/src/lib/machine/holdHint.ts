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
 *   That holds for M0s without a camNC marker (other posts) too: at or above the last Z before the M0.
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
  if (!hint.marker) {
    if (index === first && !memoized(program, 'moves before first pause', () => lines.slice(0, first).some(movesOrProbes))) {
      // FluidNC cannot read past the M0 without Resume. While the furthest it can have read (the reported position plus
      // the window) is short of the first move after it, the bit has not moved; that survives a reload. On a file so
      // large that the window reaches that move, only the bit not having moved since camNC started the job tells.
      // Fusion's M0 comes before its M3: a spindle the controller reports running means the job is past it.
      if (c.spindle === 'on') return null;
      const readTo = (Math.max(c.readTo ?? c.percent, c.percent) / 100) * size;
      const firstMove = memoized(program, 'first move after first pause', () => beforeFirstMoveAfter(lines, first));
      const unmoved = readTo + positionWindow(size) <= firstMove;
      return unmoved || c.stillSinceStart === true ? hint : null;
    }
    return bitAtOrAbove(lines, index, c) ? hint : null;
  }
  // Past the start pause's reader position above, the job is past it.
  if (hint.marker.kind === 'start') return null;
  return bitWhereThePauseLeftIt(lines, index, hint.marker.kind === 'done', c) ? hint : null;
}

/** End byte of the first spindle start (M3/M4) after line `index`, or the end of the file. */
function spindleStartEnd(lines: Line[], index: number) {
  for (let i = index + 1; i < lines.length; i++) if (/(?<![A-Z])M0*[34](?![\d.])/i.test(lines[i]!.code)) return lines[i]!.end;
  return lines.at(-1)!.end;
}
/** A line that moves an axis or probes, so that the bit may be anywhere after it. */
const movesOrProbes = (line: Line) => /\bG0*(?:[0-3]|28|30|38(?:\.\d)?|53)(?![\d.])|[XYZABC]\s*[-+.\d]/i.test(line.code);

/**
 * Whether the bit is where the program sent it before the M0 at `index`: parked at the G53 Z for the done pause, at or
 * above the safe Z (work coordinates) for a take-out or tab pause.
 */
function bitWhereThePauseLeftIt(lines: Line[], index: number, done: boolean, c: HoldContext) {
  const at = zBefore(lines, index);
  if (!at || at.machine !== done) return false;
  if (done) return c.mpos !== undefined && Math.abs(c.mpos.z - at.z) <= kAtZ;
  return c.wpos !== undefined && c.wpos.z >= at.z - kAtZ;
}

/** For an M0 of another post: the bit at or above the last Z the program moved to before it, in its coordinates. */
function bitAtOrAbove(lines: Line[], index: number, c: HoldContext) {
  const at = zBefore(lines, index);
  const z = at?.machine ? c.mpos?.z : c.wpos?.z;
  return !!at && z !== undefined && z >= at.z - kAtZ;
}

/**
 * The Z the program last moved to before line `index`, and whether in machine coordinates (G53). `null` if unknown: no
 * Z move yet, an offset, homing or probe since (G10, G28, G30, G38, G92), or relative moves (G91) at that point.
 */
function zBefore(lines: Line[], index: number) {
  // It reads the whole program up to the M0, and the machine view asks with every report while held.
  let memo = zBeforeMemo.get(lines);
  if (!memo) zBeforeMemo.set(lines, (memo = new Map()));
  if (!memo.has(index)) memo.set(index, readZBefore(lines, index));
  return memo.get(index)!;
}

const zBeforeMemo = new WeakMap<Line[], Map<number, { z: number; machine: boolean } | null>>();

function readZBefore(lines: Line[], index: number) {
  let relative = false;
  let last: { z: number; machine: boolean } | null = null;
  for (let i = 0; i < index; i++) {
    const code = lines[i]!.code.toUpperCase();
    // G90.1/G91.1 only set the arc centre mode.
    if (/\bG0*90(?![\d.])/.test(code)) relative = false;
    if (/\bG0*91(?![\d.])/.test(code)) relative = true;
    if (/\bG0*(?:10|28|30|38(?:\.\d)?|92(?:\.\d)?)(?![\d.])/.test(code)) {
      last = null;
      continue;
    }
    const z = code.match(/Z\s*([-+]?(?:\d+\.?\d*|\.\d+))/);
    if (!z) continue;
    const machine = /\bG0*53(?![\d.])/.test(code);
    // A relative Z move leaves the height unknown; G53 is in machine coordinates either way.
    last = relative && !machine ? null : { z: Number(z[1]), machine };
  }
  return relative ? null : last;
}

/** End byte of the line before the first move or probe after line `index`: the reader there has not moved the bit. */
function beforeFirstMoveAfter(lines: Line[], index: number) {
  for (let i = index + 1; i < lines.length; i++) if (movesOrProbes(lines[i]!)) return lines[i - 1]!.end;
  return lines.at(-1)!.end;
}
