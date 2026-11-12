import { parsePauseMarker, type PauseMarker, positionWindow } from '@wbcnc/cam/pauseMarker';
import { gcodeWords, hasWord } from './gcodeWords';

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

/** Lines after the pause that are looked at for what comes next. */
const kLookAhead = 12;

/**
 * FluidNC reads a job one line at a time and does not read on while it waits at an M0, so at a program pause the SD
 * position is the byte just after the M0 line, known to within {@link positionWindow}. A feed hold leaves the reader
 * wherever planning got to.
 */
export { positionWindow };

export interface Line {
  code: string;
  comment: string;
  /** Byte offset just after the line (UTF-8, newline included). */
  end: number;
}

export function splitLines(gcode: string): Line[] {
  return parsedProgram(gcode).lines;
}

/** A program split into lines, with what the machine view looks up in it again on every report while held. */
export interface ParsedProgram {
  lines: Line[];
  /** Size in bytes (UTF-8), as FluidNC counts it. */
  size: number;
  /** Results computed from the lines, by key: they never change for the same program. */
  memo: Map<string, unknown>;
}

let lastProgram: { gcode: string; parsed: ParsedProgram } | null = null;

/**
 * The program split into lines, kept for the last G-code asked about: the machine view asks again with every status
 * report while the job is held, and a program can have a million lines.
 */
export function parsedProgram(gcode: string): ParsedProgram {
  if (lastProgram?.gcode === gcode) return lastProgram.parsed;
  const encoder = new TextEncoder();
  const size = encoder.encode(gcode).length;
  // As many bytes as characters: ASCII, as camNC's programs are, so no encoding per line.
  const ascii = size === gcode.length;
  const lines: Line[] = [];
  let offset = 0;
  for (const withCr of gcode.split('\n')) {
    offset += (ascii ? withCr.length : encoder.encode(withCr).length) + 1;
    // FluidNC skips the CR of CRLF files, and `.` would not match it: `;M0 (…)` read as an M0.
    const raw = withCr.replace(/\r$/, '');
    if (!raw.includes('(') && !raw.includes(';')) {
      lines.push({ code: raw.trim(), comment: '', end: offset });
      continue;
    }
    const comments = [...raw.matchAll(/\(([^)]*)\)|;(.*)$/g)].map(m => (m[1] ?? m[2] ?? '').trim()).filter(Boolean);
    lines.push({ code: raw.replace(/\(.*?\)|;.*$/g, '').trim(), comment: comments.join(' '), end: offset });
  }
  const parsed = { lines, size, memo: new Map<string, unknown>() };
  lastProgram = { gcode, parsed };
  return parsed;
}

/** `compute()` once per program and key. */
export function memoized<T>(program: ParsedProgram, key: string, compute: () => T): T {
  if (!program.memo.has(key)) program.memo.set(key, compute());
  return program.memo.get(key) as T;
}

/**
 * M0 is the only command FluidNC holds a running file at. It parses M1 and M60 but never stops for them, and a manual
 * M6 does not hold the file either, so a hint for those would always be wrong.
 */
export const isPause = (line: Line) => {
  // Also after a line number or with other words, spaced or not (`N10M0`): M0, M00, not M0.5.
  const words = gcodeWords(line.code);
  return !!words && hasWord(words, 'M', 0);
};

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
  // Only lines with code count: comment lines (such as the gap camNC writes after its start pause) are skipped.
  for (let i = from, seen = 0; i < lines.length && seen < kLookAhead; i++) {
    const code = lines[i]!.code.toUpperCase();
    if (!code) continue;
    seen++;
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
  // The first line that ends inside the window (line ends only grow).
  let lo = 0;
  let hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.end < byte - window) lo = mid + 1;
    else hi = mid;
  }
  // Take the pause closest to the position, so that a second pause shortly after (e.g. a tab stop after a short first
  // operation) is not mistaken for the first one.
  let best = -1;
  for (let i = lo; i < lines.length && lines[i]!.end <= byte + window; i++) {
    if (isPause(lines[i]!) && (best < 0 || Math.abs(lines[i]!.end - byte) <= Math.abs(lines[best]!.end - byte))) best = i;
  }
  return best;
}

/**
 * Find the M0 the job paused at, given FluidNC's `SD:` percent (share of the file read), and explain it.
 * Returns `null` unless the reported position can be the end of an M0 line, e.g. after a feed hold.
 */
export function pauseHint(gcode: string, percent: number): PauseHint | null {
  const { lines, size } = parsedProgram(gcode);
  if (!size) return null;
  const index = pauseAt(lines, size, percent);
  return index < 0 ? null : explainPause(lines, index, gcode);
}
