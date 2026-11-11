import { pauseMarker } from '@wbcnc/cam/pauseMarker';

/**
 * For tests: a board program shaped like the one of issue #792, 13,225 bytes and 771 lines. The start M0 is line 15 and
 * ends at byte 477, M3 is line 16, M5 line 766 and the done M0 line 769, ending at byte 13,220.
 */
export const boardProgram = (() => {
  const bytes = (lines: string[]) => lines.reduce((sum, l) => sum + new TextEncoder().encode(l).length + 1, 0);
  /** `count` comment lines of `total` bytes in all, newlines included. */
  const comments = (count: number, total: number) =>
    Array.from({ length: count }, (_, i) => {
      const size = Math.floor(total / count) + (i < total % count ? 1 : 0);
      return `(${'-'.repeat(size - 3)})`;
    });
  const header = ['(camNC CAM)', 'G21', 'G90', 'G17', 'G94', 'G54'];
  const start = [pauseMarker({ kind: 'start', rpm: 15000 }), 'M0 (MSG Router on at 15000 RPM, then Resume)'];
  // Lines 7–13 fill up to the start M0.
  const head = [...header, ...comments(7, 477 - bytes(header) - bytes(start)), ...start];
  const done = ['M5', '(lift)', pauseMarker({ kind: 'done' }), 'M0 (MSG Program done)'];
  // Lines 17–765: the cut, 16 or 17 bytes a move so that the done M0 ends at byte 13,220.
  const cutBytes = 13_220 - bytes(head) - bytes(['M3 S15000']) - bytes(done);
  const long = cutBytes - 16 * 749;
  const cut = Array.from({ length: 749 }, (_, i) => `G1 X${10 + (i % 80)}.${i % 10}0 Y${10 + (i % 40)}.5${i < long ? '0' : ''}`);
  return [...head, 'M3 S15000', ...cut, ...done, 'M9', 'M2'].join('\n');
})();
