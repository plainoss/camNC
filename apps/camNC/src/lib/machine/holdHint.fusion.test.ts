import { describe, expect, it } from 'vitest';
import back from '../../../../../packages/cam/test/fixtures/kinderregal-eiche-back.gcode?raw';
import left from '../../../../../packages/cam/test/fixtures/kinderregal-eiche-left.gcode?raw';
import { type HoldContext, holdHint } from './holdHint';
import { pauseHint } from './pauseHints';
import { controllerPercent } from './pauseHints.fixture';

const bytes = (text: string) => new TextEncoder().encode(text).length;
/** FluidNC's percent with the reader just after the first line containing `text`. */
const after = (gcode: string, text: string, from = 0) =>
  controllerPercent(bytes(gcode.slice(0, gcode.indexOf('\n', gcode.indexOf(text, from)) + 1)), bytes(gcode));
const at = (percent: number, more: Partial<HoldContext> = {}): HoldContext => ({
  percent,
  readTo: percent,
  holdRequested: false,
  mpos: { z: -20 },
  wpos: { z: 11 },
  stillSinceStart: false,
  ...more,
});

describe('a Fusion program’s M0s, which have no camNC marker', () => {
  describe('its first M0, before any move', () => {
    const m0 = 'M0 (MSG Turn ON 15000RPM)';

    it('shows while the reader is short of the first move after it, also after a reload', () => {
      const percent = after(back, m0);
      // After a reload camNC does not know where the job started.
      for (const stillSinceStart of [undefined, false, true])
        expect(holdHint(back, at(percent, { stillSinceStart }))?.reason).toBe(
          'The job stopped at a program pause (M0) on line 56: “Turn ON 15000RPM”.'
        );
      expect(holdHint(back, at(percent, { spindle: 'off' }))?.reason).toContain('Turn ON 15000RPM');
      // A spindle the controller reports running: the job is past the M0, whatever the position or start says.
      for (const stillSinceStart of [false, true]) expect(holdHint(back, at(percent, { spindle: 'on', stillSinceStart }))).toBeNull();
      // The reader went on past the first move (G0 Z11): it ran after the M0.
      expect(holdHint(back, at(percent, { readTo: after(back, 'G0 Z11 F1200') }))).toBeNull();
    });

    it('in a file so large that the window reaches that move, shows only if the bit has not moved since the start', () => {
      const head = back.slice(0, back.indexOf('( *** SECTION end ***)'));
      const big = head + left.slice(left.indexOf('( MOVEMENT_CUTTING)'), left.indexOf('( *** SECTION end ***)')).repeat(113);
      expect(bytes(big)).toBeGreaterThan(2_400_000);
      // At this size the percent the controller reports for the reader waiting at the M0 stands for a byte so far on that
      // the position window reaches past the first move.
      const percent = after(big, m0);
      expect(holdHint(big, at(percent))).toBeNull();
      expect(holdHint(big, at(percent, { stillSinceStart: true }))?.reason).toContain('Turn ON 15000RPM');
    });
  });

  describe('a manual tool change in a long Fusion program', () => {
    // The left side's cut, repeated, with a tool change the way the post writes one in between: lift, M5, M0.
    // The fixture has CRLF line ends.
    const m0 = 'M0 (MSG Turn ON 15000RPM)';
    const head = left.slice(0, left.indexOf('\n', left.indexOf(m0)) + 1);
    const cut = left.slice(head.length, left.indexOf('( *** SECTION end ***)'));
    const tail = left.slice(head.length + cut.length);
    const toolChange = ['( COMMAND_STOP_SPINDLE)', 'G0 Z11 F1200', 'M5', 'M0 (MSG Change to T2)', 'T2 M6', ''].join('\r\n');
    const program = head + cut + toolChange + cut.repeat(30) + tail;

    it('a hold with the reader at the M5 while the bit still cuts is not the tool change', () => {
      const percent = after(program, 'M5', program.indexOf(toolChange));
      // The position alone cannot tell them apart in a file this size.
      expect(bytes(program)).toBeGreaterThan(600_000);
      expect(pauseHint(program, percent)?.next).toMatch(/^Tool change to T2/);
      for (const z of [1, -0.3, 10.9]) expect(holdHint(program, at(percent, { wpos: { z } }))).toBeNull();
    });

    it('a real stop at that M0, with the bit up at the Z it lifted to, shows the tool change', () => {
      const percent = after(program, 'M0 (MSG Change to T2)');
      for (const z of [11, 10.96, 40]) {
        const hint = holdHint(program, at(percent, { wpos: { z } }));
        expect(hint?.reason).toContain('“Change to T2”');
        expect(hint?.next).toMatch(/^Tool change to T2/);
      }
      expect(holdHint(program, at(percent, { wpos: undefined }))).toBeNull();
      expect(holdHint(program, at(percent, { holdRequested: true }))).toBeNull();
    });

    it('held in the last of the lift with the spindle still reported running, it is not the tool change', () => {
      const percent = after(program, 'M0 (MSG Change to T2)');
      for (const z of [10.95, 10.98, 11]) {
        expect(holdHint(program, at(percent, { wpos: { z }, spindle: 'on' }))).toBeNull();
        // Once the M5 has run the controller reports it off: the real stop.
        expect(holdHint(program, at(percent, { wpos: { z }, spindle: 'off' }))?.next).toMatch(/^Tool change to T2/);
      }
    });
  });

  describe('units, offsets and words', () => {
    const big = 'G1 X1\n'.repeat(500);
    const program = (prefix: string) => `${prefix}\nM0 (MSG Check)\n` + big;
    const hint = (gcode: string, more: Partial<HoldContext> = {}) => holdHint(gcode, at(after(gcode, 'Check'), more));

    it('compares an inch program (G20) with reports in mm after converting, and not with reports of unknown units', () => {
      const inch = program('G20\nG90\nG0 Z0.6\nG1 X1 F30');
      expect(hint(inch, { positionUnits: 'mm', wpos: { z: 15.24 } })?.reason).toContain('Check');
      expect(hint(inch, { positionUnits: 'mm', wpos: { z: 0.6 } })).toBeNull();
      expect(hint(inch, { positionUnits: 'inch', wpos: { z: 0.6 } })?.reason).toContain('Check');
      expect(hint(inch, { positionUnits: undefined, wpos: { z: 15.24 } })).toBeNull();
    });

    it('converts reports in inches ($Report/Inches) for an mm program', () => {
      const mm = program('G21\nG90\nG0 Z11\nG1 X1 F300');
      expect(hint(mm, { positionUnits: 'inch', wpos: { z: 11 / 25.4 } })?.reason).toContain('Check');
      expect(hint(mm, { positionUnits: 'inch', wpos: { z: 0.3 } })).toBeNull();
      // Unknown report units with an mm program: taken as mm, FluidNC's default.
      expect(hint(mm, { positionUnits: undefined, wpos: { z: 11 } })?.reason).toContain('Check');
      // No units in the program: what Z11 means is not known.
      expect(hint(program('G90\nG0 Z11\nG1 X1 F300'), { wpos: { z: 50 } })).toBeNull();
    });

    it('a tool length offset or another coordinate system after the Z move leaves the height unknown', () => {
      for (const between of ['G43.1 Z5', 'G43 H1', 'G49', 'G54', 'G55', 'G59.1', 'G92 Z0', 'G92.1'])
        expect(hint(program(`G21\nG90\nG0 Z11\nG1 X1 F300\n${between}`), { wpos: { z: 50 } })).toBeNull();
      // G43.1's Z is not a move to that height.
      expect(hint(program('G21\nG90\nG43.1 Z30'), { wpos: { z: 50 } })).toBeNull();
    });

    it('reads words written without spaces', () => {
      expect(hint(program('G21G90\nG0Z11\nG1X1F300'), { wpos: { z: 11 } })?.reason).toContain('Check');
      expect(hint(program('G21\nG0G91Z5\nG90'), { wpos: { z: 50 } })).toBeNull();
      expect(hint(program('G21\nG90\nG0G53Z-5'), { mpos: { z: -5 } })?.reason).toContain('Check');
      expect(hint(program('G21\nG90\nG0G53Z-5'), { mpos: { z: -20 } })).toBeNull();
      const n = 'G21\nG90\nG0 Z11\nN10M0 (MSG Check)\n' + big;
      expect(holdHint(n, at(after(n, 'Check'), { wpos: { z: 11 } }))?.line).toBe(4);
    });
  });

  it('falls back to the generic card when the Z before the M0 cannot be told', () => {
    for (const between of ['G28', 'G30', 'G91', 'G92 Z0', 'G10 L20 P0 Z0', 'G38.2 Z-50 F100']) {
      const program = `G21\nG90\nG0 Z11\nG1 X10 F900\n${between}\nM0 (MSG Check)\nG90\n` + 'G1 X1\n'.repeat(500);
      expect(holdHint(program, at(after(program, 'Check'), { wpos: { z: 50 }, mpos: { z: 0 } }))).toBeNull();
    }
    // Relative moves anywhere before, still active or for the last Z move: the height is unknown.
    for (const prefix of ['G91\nG0 Z11\nG1 X10', 'G0 Z11\nG91 G1 X10', 'G91 G0 Z11\nG90 G1 X10', 'G0 Z11\nG91\nG90\nG91 Z1\nG90 X10']) {
      const program = `G21\n${prefix}\nM0 (MSG Check)\n` + 'G1 X1\n'.repeat(500);
      expect(holdHint(program, at(after(program, 'Check'), { wpos: { z: 50 } }))).toBeNull();
      // With the prefix all absolute it would show.
      const absolute = program.replaceAll('G91', 'G90');
      expect(holdHint(absolute, at(after(absolute, 'Check'), { wpos: { z: 50 } }))?.reason).toContain('Check');
    }
    const signed = 'G21\nG90\nG0 Z+11\nG90.1 G91.1 G1 X10 F900\nM0 (MSG Check)\n' + 'G1 X1\n'.repeat(500);
    expect(holdHint(signed, at(after(signed, 'Check')))?.reason).toContain('Check');
    expect(holdHint(signed, at(after(signed, 'Check'), { wpos: { z: 10 } }))).toBeNull();
    const plain = 'G21\nG90\nG0 Z11\nG1 X10 F900\nM0 (MSG Check)\n' + 'G1 X1\n'.repeat(500);
    expect(holdHint(plain, at(after(plain, 'Check')))?.reason).toContain('Check');
    // Moves before the first M0 but no Z: it is not the "nothing moved yet" case either.
    const noZ = 'G21\nG90\nG1 X10 F900\nM0 (MSG Check)\n' + 'G1 X1\n'.repeat(500);
    expect(holdHint(noZ, at(after(noZ, 'Check'), { stillSinceStart: true }))).toBeNull();
  });
});
