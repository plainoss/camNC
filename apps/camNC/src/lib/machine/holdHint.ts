import { explainPause, isPause, type Line, type PauseHint, pauseAt, positionWindow, splitLines } from './pauseHints';

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
   * The spindle as the controller reports its state (A:S or A:C), which it reports again right after any change; not
   * the FS speed, which a disabled spindle can keep. `undefined` when it has not said yet.
   */
  spindle?: 'on' | 'off';
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
 */
export function holdHint(gcode: string, c: HoldContext): PauseHint | null {
  if (c.percent === undefined) return null;
  const lines = splitLines(gcode);
  const size = new TextEncoder().encode(gcode).length;
  if (!size) return null;
  const first = lines.findIndex(isPause);
  const start = first >= 0 ? explainPause(lines, first, gcode) : null;
  if (start?.marker?.kind === 'start') {
    const readTo = (Math.max(c.readTo ?? c.percent, c.percent) / 100) * size;
    // Within the window: the percent may stand for a byte a little past the M0 even while the reader waits there. On a
    // file of many MB that window reaches into the first cut, so the bit must also be at the safe Z it went to first,
    // where it always is at the real start pause.
    const window = positionWindow(size);
    const atStart = readTo <= lines[first]!.end + window && bitWhereThePauseLeftIt(lines, first, false, c);
    // On a file of more than ~100 kB the window also reaches past the M3 and the dwell after the M0, into the travel at
    // safe Z with the spindle on: only the controller's spindle state tells those apart.
    const spindleNotStarted = c.spindle === 'off' || (c.spindle !== 'on' && readTo + window < spindleStartEnd(lines, first));
    if (atStart && spindleNotStarted) return start;
  }
  if (c.holdRequested) return null;
  const index = pauseAt(lines, size, c.percent);
  if (index < 0) return null;
  const hint = explainPause(lines, index, gcode);
  if (!hint.marker) return hint;
  // Past the start pause's reader position above, the job is past it.
  if (hint.marker.kind === 'start') return null;
  return bitWhereThePauseLeftIt(lines, index, hint.marker.kind === 'done', c) ? hint : null;
}

/** End byte of the first spindle start (M3/M4) after line `index`, or the end of the file. */
function spindleStartEnd(lines: Line[], index: number) {
  for (let i = index + 1; i < lines.length; i++) if (/(?<![A-Z])M0*[34](?![\d.])/i.test(lines[i]!.code)) return lines[i]!.end;
  return lines.at(-1)!.end;
}

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

/** The Z the program last moved to before line `index`, and whether in machine coordinates (G53). `null` if unknown. */
function zBefore(lines: Line[], index: number) {
  for (let i = index - 1; i >= 0; i--) {
    const code = lines[i]!.code.toUpperCase();
    // Offsets, homing, probing and relative moves change what a Z word means (G91.1 only sets the arc centre mode).
    if (/\bG0*(?:10|28|30|38(?:\.\d)?|91|92(?:\.\d)?)(?![\d.])/.test(code)) return null;
    const z = code.match(/Z(-?\d*\.?\d+)/);
    if (z) return { z: Number(z[1]), machine: /\bG53\b/.test(code) };
  }
  return null;
}
