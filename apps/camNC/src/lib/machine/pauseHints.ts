import { parsePauseMarker, type PauseMarker } from '@wbcnc/cam/pauseMarker';

/** Why a job is paused and what Resume will do, from the uploaded G-code and FluidNC's SD progress. */
export interface PauseHint {
  /** E.g. "The program paused (M0): Turn ON 30000RPM". */
  reason: string;
  /** What to do before resuming, from what comes next in the program. */
  next: string | null;
  /** 1-based line of the pausing command. */
  line: number;
  /** In a program camNC generated: what the pause is for (`(CAMNC PAUSE …)` on the line before). */
  marker?: PauseMarker;
}

/**
 * The only command FluidNC holds a running file at. It parses M1 and M60 but never stops for them, and a manual M6
 * does not hold the file either, so a hint for those would always be wrong.
 */
const kPause = /\bM0?0\b/i;
/** Lines after the pause that are looked at for what comes next. */
const kLookAhead = 12;

/**
 * How far (bytes) the position FluidNC's `SD:` percent stands for can be from the true one in a file of `size` bytes.
 * FluidNC computes `(float)position * 100.0f / size` and prints two decimals: the printing is off by up to 0.005 % of the
 * file (5e-5·size bytes), the float maths by under 3e-7·size more. Two bytes cover reading the percent back here.
 *
 * FluidNC reads a job one line at a time and does not read on while it waits at an M0, so at a program pause the
 * position is the byte just after the M0 line. A feed hold leaves the reader wherever planning got to.
 */
export function positionWindow(size: number) {
  return size * 5.03e-5 + 2;
}

export interface Line {
  code: string;
  comment: string;
  /** Byte offset just after the line (UTF-8, newline included). */
  end: number;
}

export function splitLines(gcode: string): Line[] {
  const encoder = new TextEncoder();
  const out: Line[] = [];
  let offset = 0;
  for (const raw of gcode.split('\n')) {
    offset += encoder.encode(raw).length + 1;
    const comments = [...raw.matchAll(/\(([^)]*)\)|;(.*)$/g)].map(m => (m[1] ?? m[2] ?? '').trim()).filter(Boolean);
    out.push({ code: raw.replace(/\(.*?\)|;.*$/g, '').trim(), comment: comments.join(' '), end: offset });
  }
  return out;
}

export const isPause = (line: Line) => kPause.test(line.code);

/** `(MSG Turn ON 30000RPM)` and `(MSG,Turn …)` are messages to the operator. */
export function operatorMessage(comment: string) {
  const match = comment.match(/^MSG[,\s]+(.*)$/i);
  return match ? match[1]!.trim() : null;
}

function toolDescription(gcode: string, tool: number) {
  // Fusion's tools table: (  T3 D=6 CR=0 - ZMIN=-9.5 - flat end mill )
  const match = gcode.match(new RegExp(`\\(\\s*T${tool}\\s+D=([\\d.]+)([^)]*)\\)`, 'i'));
  // The description is the last " - " field.
  const description = match?.[2]!.split(' - ').pop()!.trim();
  return match ? `${match[1]} mm${description ? ` ${description}` : ''}` : null;
}

function describeNext(lines: Line[], from: number, gcode: string): string | null {
  for (const line of lines.slice(from, from + kLookAhead)) {
    const code = line.code.toUpperCase();
    if (/\bG38\.[2-5]\b/.test(code)) {
      return 'Next it probes Z (G38). Attach the probe clip and put the plate under the bit, then Resume.';
    }
    const tool = code.match(/\bT(\d+)\b/);
    if (tool && /\bM0?6\b/.test(code)) {
      const description = toolDescription(gcode, Number(tool[1]));
      return `Tool change to T${tool[1]}${description ? ` (${description})` : ''}: change the bit, then Resume. Re-zero Z if the program does not probe.`;
    }
    if (/\bM0?[34]\b/.test(code)) {
      return 'Next it starts the spindle. Make sure the spindle and dust collection are ready, then Resume.';
    }
    if (/\b(G0?[0-3])\b|[XYZ]-?[\d.]/.test(code)) return 'Resume continues with the next move.';
  }
  return null;
}

/** The hint for the M0 at `index` (0-based) of `lines`. */
export function explainPause(lines: Line[], index: number, gcode: string): PauseHint {
  const line = lines[index]!;
  const message = operatorMessage(line.comment) ?? (line.comment || null);
  const reason = `The job stopped at a program pause (M0) on line ${index + 1}${message ? `: “${message}”` : ''}.`;
  const marker = index > 0 ? parsePauseMarker(lines[index - 1]!.comment) : null;
  return { reason, next: describeNext(lines, index + 1, gcode), line: index + 1, ...(marker && { marker }) };
}

/** Index of the M0 whose end is the position `percent` stands for, or -1. */
export function pauseAt(lines: Line[], size: number, percent: number) {
  const byte = (percent / 100) * size;
  const window = positionWindow(size);
  // Take the pause closest to the position, so that a second pause shortly after (e.g. a tab stop after a short first
  // operation) is not mistaken for the first one.
  let best = -1;
  for (let i = 0; i < lines.length && lines[i]!.end <= byte + window; i++) {
    if (isPause(lines[i]!) && (best < 0 || Math.abs(lines[i]!.end - byte) <= Math.abs(lines[best]!.end - byte))) best = i;
  }
  return best >= 0 && Math.abs(byte - lines[best]!.end) <= window ? best : -1;
}

/**
 * Find the M0 the job paused at, given FluidNC's `SD:` percent (share of the file read), and explain it.
 * Returns `null` unless the reported position can be the end of an M0 line, e.g. after a feed hold.
 */
export function pauseHint(gcode: string, percent: number): PauseHint | null {
  const lines = splitLines(gcode);
  const size = new TextEncoder().encode(gcode).length;
  if (!size) return null;
  const index = pauseAt(lines, size, percent);
  return index < 0 ? null : explainPause(lines, index, gcode);
}
