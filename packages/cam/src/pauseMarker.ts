/**
 * The marker camNC writes on its own line just before each M0 of a program it generated, saying what the pause is for,
 * so that the machine view can show it as steps and mark the parts without reading the message. Other senders only
 * show the M0's MSG; FluidNC skips the comment.
 */
export type PauseMarker =
  | { kind: 'start'; rpm: number }
  | { kind: 'take-out'; n: number; of: number; part: string; next?: string }
  | { kind: 'tab'; n: number; of: number; part: string }
  | { kind: 'done' };

const kMarker = 'CAMNC PAUSE';

/** `(CAMNC PAUSE take-out; n=2/5; part=Part 1b; next=Part 2)`: one comment line just before the M0. */
export function pauseMarker(m: PauseMarker): string {
  const fields: string[] = [m.kind];
  if ('n' in m) fields.push(`n=${m.n}/${m.of}`);
  if ('rpm' in m) fields.push(`rpm=${Math.round(m.rpm)}`);
  const line = (names: string[]) => `(${kMarker} ${[...fields, ...names].join('; ')})`;
  // Part names share what's left of FluidNC's line limit, in UTF-8 bytes: the longer one gives way first.
  const names = [...('part' in m ? [`part=${clean(m.part)}`] : []), ...('next' in m && m.next ? [`next=${clean(m.next)}`] : [])];
  while (bytes(line(names)) > kMaxLine) {
    const i = names.reduce((longest, s, k) => (bytes(s) > bytes(names[longest]!) ? k : longest), 0);
    names[i] = [...names[i]!].slice(0, -1).join('');
  }
  return line(names);
}

/** FluidNC's line limit in bytes (`kMaxGcodeLine` in gcode.ts). */
const kMaxLine = 127;
const encoder = new TextEncoder();
const bytes = (s: string) => encoder.encode(s).length;

/** The marker in a comment's text (without the parentheses), or null. Inverse of `pauseMarker`. */
export function parsePauseMarker(comment: string): PauseMarker | null {
  if (!comment.startsWith(`${kMarker} `)) return null;
  const [kind, ...rest] = comment
    .slice(kMarker.length + 1)
    .split(';')
    .map(s => s.trim());
  const f = Object.fromEntries(rest.map(s => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]));
  const [n, of] = (f.n ?? '').split('/').map(Number);
  const counted = Number.isFinite(n) && Number.isFinite(of) && n! > 0 && of! > 0;
  if (kind === 'start') return { kind, rpm: Number(f.rpm) || 0 };
  if (kind === 'done') return { kind };
  if (kind === 'take-out' && counted && f.part) return { kind, n: n!, of: of!, part: f.part, ...(f.next && { next: f.next }) };
  if (kind === 'tab' && counted && f.part) return { kind, n: n!, of: of!, part: f.part };
  return null;
}

/**
 * How far (bytes) the position FluidNC's `SD:` percent stands for can be from the true one in a file of `size` bytes.
 * FluidNC computes `(float)position * 100.0f / size` and prints two decimals: the printing is off by up to 0.005 % of the
 * file (5e-5·size bytes), the float maths by under 3e-7·size more. Two bytes cover reading the percent back.
 */
export function positionWindow(size: number) {
  return size * 5.03e-5 + 2;
}

/** One line of the gap after the start pause: a `;` comment, 80 bytes with its newline. */
export const kStartPauseGapLine = `;${'-'.repeat(78)}`;
/** At most this many gap lines (4 kB), enough for programs up to about 40 MB; larger ones get the cap. */
export const kMaxStartPauseGapLines = 51;

/**
 * Comment lines to put between the start M0 and the spindle start (M3) after it, in a program of `size` bytes without
 * them. The machine view tells a hold at the start M0 from one after the M3 by the SD position, which it knows only to
 * within {@link positionWindow}: the furthest position it can have seen at the M0 is the M0's end plus the window, and
 * the controller can have read that far plus the window again. So the M3 line has to end more than two windows after
 * the M0. Sized for the program with the gap, which itself adds to the size.
 */
export function startPauseGap(size: number, m3LineBytes: number): string[] {
  const linesFor = (total: number) => Math.max(0, Math.floor((2 * positionWindow(total) - m3LineBytes) / 80) + 1);
  let n = linesFor(size);
  // The gap's own bytes widen the window a little (by 0.01 % of the gap): one more pass settles it.
  n = Math.max(n, linesFor(size + 80 * n));
  return Array.from({ length: Math.min(n, kMaxStartPauseGapLines) }, () => kStartPauseGapLine);
}

/** Inside a `( )` comment and between our `;` separators: no parentheses or semicolons, one line, short. */
const clean = (text: string) => text.replace(/[();]/g, '').replace(/\s+/g, ' ').trim();
