import { kMaxStartPauseGapLines, pauseMarker } from '@wbcnc/cam/pauseMarker';
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

    it('never shows while the controller reports the spindle running', () => {
      expect(holdHint(boardProgram, at(sd(477), { spindle: 'on' }))).toBeNull();
      // Small enough that the position alone proves the M3 right after the M0 was not read.
      expect(holdHint(boardProgram, at(sd(477), { spindle: undefined }))?.marker?.kind).toBe('start');
      expect(holdHint(boardProgram, at(sd(477), { spindle: 'off' }))?.marker?.kind).toBe('start');
    });

    for (const size of [1_000_000, 20_000_000])
      it(`in a ${size / 1e6} MB program, a hold during the travel after M3 is not the start pause`, () => {
        const { gcode, startEnd, travelEnd } = camProgram(size);
        // The travel at safe Z after M3 and the dwell is inside the window of the start M0.
        const travel = controllerPercent(travelEnd, size);
        expect((travel / 100) * size).toBeLessThanOrEqual(startEnd + positionWindow(size));
        for (const holdRequested of [false, true]) {
          for (const spindle of ['on', undefined] as const)
            expect(holdHint(gcode, at(travel, { holdRequested, spindle, wpos: { z: 23.3 } }))).toBeNull();
          // In the cut, whatever the controller says about the spindle.
          expect(holdHint(gcode, at(travel, { holdRequested, spindle: 'off', mpos: { z: -36 }, wpos: { z: -6 } }))).toBeNull();
        }
        // At the start M0 itself, the spindle reported off: the start card.
        const atM0 = controllerPercent(startEnd, size);
        expect(holdHint(gcode, at(atM0, { spindle: 'off' }))?.marker?.kind).toBe('start');
        expect(holdHint(gcode, at(atM0, { spindle: 'on' }))).toBeNull();
      });

    // camNC's output has comment lines between the start M0 and its M3, sized so that the position alone tells them
    // apart; 40 MB is about the largest program the capped gap covers.
    for (const size of [1_000_000, 20_000_000, 40_000_000])
      it(`in a ${size / 1e6} MB program with the gap after the start M0, the position alone decides`, () => {
        const { gcode, startEnd, m3End, travelEnd } = camProgram(size, { gap: true });
        const window = positionWindow(size);
        expect(m3End - startEnd).toBeLessThanOrEqual(kMaxStartPauseGapLines * 80 + 10);
        // What comes next looks past the gap's comment lines, however many, to the M3.
        expect(holdHint(gcode, at(controllerPercent(startEnd, size)))?.next).toBe(
          'Next it starts the spindle. Make sure the spindle and dust collection are ready, then Resume.'
        );
        // At the start M0, the spindle state unknown: as reported, and the furthest the report can be off.
        for (const reported of [controllerPercent(startEnd, size), ((startEnd + window) / size) * 100])
          for (const holdRequested of [false, true]) expect(holdHint(gcode, at(reported, { holdRequested }))?.marker?.kind).toBe('start');
        // After the M3: in the dwell and in the travel at safe Z.
        for (const byte of [m3End, travelEnd - 'G0 X100 Y100\n'.length, travelEnd])
          for (const spindle of [undefined, 'on'] as const)
            expect(holdHint(gcode, at(controllerPercent(byte, size), { spindle, wpos: { z: 23.3 } }))).toBeNull();
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
