import { pauseMarker, startPauseGap } from '@wbcnc/cam/pauseMarker';

/** For tests: FluidNC's `SD:` percent at byte `position` of a `size` byte file: float maths, printed with two decimals. */
export function controllerPercent(position: number, size: number) {
  const f = Math.fround;
  return Number(f(f(f(position) * 100) / f(size)).toFixed(2));
}

const bytes = (lines: string[]) => lines.reduce((sum, l) => sum + new TextEncoder().encode(l).length + 1, 0);
/** `count` comment lines of `total` bytes in all, newlines included. */
const comments = (count: number, total: number) =>
  Array.from({ length: count }, (_, i) => {
    const size = Math.floor(total / count) + (i < total % count ? 1 : 0);
    return `(${'-'.repeat(size - 3)})`;
  });

/**
 * For tests: a board program shaped like the one of issue #792, 13,225 bytes and 771 lines. The start M0 is line 15 and
 * ends at byte 477, M3 is line 16, M5 line 766 and the done M0 line 769, ending at byte 13,220.
 */
export const boardProgram = (() => {
  const header = ['(camNC CAM)', 'G21', 'G90', 'G17', 'G94', 'G0 Z23.3'];
  const start = [pauseMarker({ kind: 'start', rpm: 15000 }), 'M0 (MSG Router on at 15000 RPM, then Resume)'];
  // Lines 7–13 fill up to the start M0.
  const head = [...header, ...comments(7, 477 - bytes(header) - bytes(start)), ...start];
  const done = ['M5', 'G53 G0 Z-5', pauseMarker({ kind: 'done' }), 'M0 (MSG Program done)'];
  // Lines 17–765: the cut, 16 or 17 bytes a move so that the done M0 ends at byte 13,220.
  const cutBytes = 13_220 - bytes(head) - bytes(['M3 S15000']) - bytes(done);
  const long = cutBytes - 16 * 749;
  const cut = Array.from({ length: 749 }, (_, i) => `G1 X${10 + (i % 80)}.${i % 10}0 Y${10 + (i % 40)}.5${i < long ? '0' : ''}`);
  return [...head, 'M3 S15000', ...cut, ...done, 'M9', 'M2'].join('\n');
})();

/**
 * For tests: a `size` byte program the way camNC writes it, ASCII only. Its start M0 ends at byte 300 and its done M0
 * 100 bytes before the end; at 2,000,000 bytes both are exactly half a hundredth of a percent of the file, where the
 * controller's rounding is closest to a tie. `m5End` is the end of the M5 before the done M0, within the position window
 * of that M0 on large files. After the start M0 come M3, a dwell and a travel at safe Z ending at `travelEnd`, then the
 * cut at work Z -6. With `gap`, the comment lines camNC now writes between the start M0 and its M3 come first.
 */
export function camProgram(size: number, { gap = false } = {}) {
  const key = `${size}${gap ? ' gap' : ''}`;
  let program = programs.get(key);
  if (!program) programs.set(key, (program = buildCamProgram(size, gap)));
  return program;
}

/** Built once per size and shared, so that tests on the same program also share its parsed lines. */
const programs = new Map<string, ReturnType<typeof buildCamProgram>>();
/** 800 different 22-byte moves, newline included: the cut repeats this block. */
const kMoveBlock = Array.from({ length: 800 }, (_, i) => `G1 X${100 + i}.25 Y${100 + (i % 400)}.5 Z-6\n`).join('');

function buildCamProgram(size: number, gap: boolean) {
  const doneEnd = size - 100;
  const header = ['(camNC CAM)', 'G21', 'G90', 'G0 Z23.3'];
  const start = [pauseMarker({ kind: 'start', rpm: 15000 }), 'M0 (MSG Spindle starts at 15000 RPM next. Manual spindle: turn it on now)'];
  const head = [...header, ...comments(3, 300 - bytes(header) - bytes(start)), ...start];
  const done = [pauseMarker({ kind: 'done' }), 'M0 (MSG Program done. Manual spindle: off now)'];
  const end = ['G0 Z23.3', 'M5', 'G53 G0 Z-5', ...done];
  // 22-byte moves, then comments for the rest.
  const spindleOn = [...(gap ? startPauseGap(size, bytes(['M3 S15000'])) : []), 'M3 S15000', 'G4 P3', 'G0 X100 Y100'];
  const cutBytes = doneEnd - bytes(head) - bytes(spindleOn) - bytes(end);
  const moves = Math.floor((cutBytes - 200) / 22);
  const cut = kMoveBlock.repeat(Math.floor(moves / 800)) + kMoveBlock.slice(0, 22 * (moves % 800));
  const program =
    [...head, ...spindleOn].join('\n') +
    '\n' +
    cut +
    [...comments(4, cutBytes - 22 * moves), ...end, ...comments(2, size - doneEnd - bytes(['M30']) + 1), 'M30'].join('\n');
  return {
    gcode: program,
    size,
    startEnd: 300,
    travelEnd: 300 + bytes(spindleOn),
    m3End: 300 + bytes(spindleOn.slice(0, spindleOn.indexOf('M3 S15000') + 1)),
    doneEnd,
    m5End: doneEnd - bytes(['G53 G0 Z-5', ...done]),
  };
}

export const largeProgram = camProgram(2_000_000);
