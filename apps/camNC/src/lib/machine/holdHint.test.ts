import { pauseMarker } from '@wbcnc/cam/pauseMarker';
import { describe, expect, it } from 'vitest';
import { type HoldContext, holdHint } from './holdHint';
import { pauseHint, positionWindow } from './pauseHints';
import { boardProgram, camProgram, controllerPercent, largeProgram } from './pauseHints.fixture';

const sd = (byte: number) => controllerPercent(byte, 13_225);
/** Hold:0 at `percent`, read no further, held by someone else, bit parked. */
const at = (percent: number | undefined, more: Partial<HoldContext> = {}): HoldContext => ({
  percent,
  readTo: percent,
  holdRequested: false,
  mpos: { z: -5 },
  wpos: { z: 23.3 },
  ...more,
});

describe('holdHint', () => {
  it('a hold camNC sent in the cut is never a program pause, even at the done M0', () => {
    expect(holdHint(boardProgram, at(sd(13_220), { holdRequested: true }))).toBeNull();
    expect(holdHint(boardProgram, at(88.2, { holdRequested: true }))).toBeNull();
    expect(holdHint(boardProgram, at(88.2))).toBeNull();
    expect(holdHint(boardProgram, at(undefined))).toBeNull();
  });

  it('shows the done steps only with the bit parked at the G53 Z the program went to', () => {
    expect(holdHint(boardProgram, at(sd(13_220)))?.marker).toEqual({ kind: 'done' });
    expect(holdHint(boardProgram, at(sd(13_220), { mpos: { z: -5.03 } }))?.marker).toEqual({ kind: 'done' });
    expect(holdHint(boardProgram, at(sd(13_220), { mpos: { z: -30 } }))).toBeNull();
    expect(holdHint(boardProgram, at(sd(13_220), { mpos: undefined }))).toBeNull();
  });

  describe('the start pause, before the spindle runs', () => {
    it('shows while the reader is not past it and the bit is at the safe Z before it, whoever held the job', () => {
      for (const holdRequested of [false, true]) {
        expect(holdHint(boardProgram, at(sd(477), { holdRequested }))?.marker).toEqual({ kind: 'start', rpm: 15000 });
        expect(holdHint(boardProgram, at(sd(200), { holdRequested, wpos: { z: 23.28 } }))?.marker?.kind).toBe('start');
        // Paused during the Z lift before it: the start card shows once the lift ends at the M0.
        expect(holdHint(boardProgram, at(sd(200), { holdRequested, wpos: { z: 4 } }))).toBeNull();
      }
    });

    it('does not show once the reader went past it, or without a work Z to go by', () => {
      expect(holdHint(boardProgram, at(sd(477), { readTo: sd(487) }))).toBeNull();
      expect(holdHint(boardProgram, at(sd(487)))).toBeNull();
      expect(holdHint(boardProgram, at(sd(477), { wpos: undefined }))).toBeNull();
    });

    it('in a 20 MB program, does not show with the reader in the first cut, inside the position window', () => {
      const { gcode, size, startEnd } = camProgram(20_000_000);
      const percent = controllerPercent(startEnd + 390, size);
      expect((percent / 100) * size).toBeLessThanOrEqual(startEnd + positionWindow(size));
      for (const holdRequested of [false, true]) {
        expect(holdHint(gcode, at(percent, { holdRequested, mpos: { z: -36 }, wpos: { z: -6 } }))).toBeNull();
        expect(holdHint(gcode, at(percent, { holdRequested }))?.marker?.kind).toBe('start');
      }
    });
  });

  it('in a 2 MB program, a hold with the reader at the M5 before the done M0 is not that M0 while the bit cuts', () => {
    const { gcode, size, m5End } = largeProgram;
    const percent = controllerPercent(m5End, size);
    // The position alone cannot tell them apart in a file this size.
    expect(pauseHint(gcode, percent)?.marker).toEqual({ kind: 'done' });
    expect(holdHint(gcode, at(percent, { mpos: { z: -36 }, wpos: { z: -6 } }))).toBeNull();
    expect(holdHint(gcode, at(percent, { mpos: { z: -6.5 }, wpos: { z: 23 } }))).toBeNull();
  });

  describe('take-out and tab pauses', () => {
    const program = [
      'G21',
      'G90',
      'G0 Z23.3',
      pauseMarker({ kind: 'start', rpm: 15000 }),
      'M0 (MSG Spindle starts at 15000 RPM next)',
      'M3 S15000',
      'G1 Z-6 F300',
      'G1 X40 F900',
      'G0 Z23.3',
      'M5',
      pauseMarker({ kind: 'take-out', n: 1, of: 2, part: 'Side', next: 'Shelf' }),
      'M0 (MSG Take out Side)',
      'M3 S15000',
      ...Array.from({ length: 400 }, (_, i) => `G1 X${i % 90} Y${i % 40} Z-6`),
    ].join('\n');
    const size = new TextEncoder().encode(program).length;
    const takeOut = controllerPercent(new TextEncoder().encode(program.slice(0, program.indexOf('M3 S15000\nG1 X0'))).length, size);

    it('show with the bit at or above the safe Z it went to before the M0', () => {
      for (const z of [23.3, 23.27, 30])
        expect(holdHint(program, at(takeOut, { readTo: takeOut, wpos: { z } }))?.marker?.kind).toBe('take-out');
    });

    it('do not show while the bit is below it', () => {
      for (const z of [-6, 10, 23.2]) expect(holdHint(program, at(takeOut, { wpos: { z } }))).toBeNull();
      expect(holdHint(program, at(takeOut, { wpos: undefined }))).toBeNull();
    });
  });
});
