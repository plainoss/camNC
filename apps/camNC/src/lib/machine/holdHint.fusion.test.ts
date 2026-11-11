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
  it('its first M0, before any move, shows only while the bit has not moved since camNC started the job', () => {
    const percent = after(back, 'M0 (MSG Turn ON 15000RPM)');
    expect(holdHint(back, at(percent, { stillSinceStart: true }))?.reason).toBe(
      'The job stopped at a program pause (M0) on line 56: “Turn ON 15000RPM”.'
    );
    // Unknown (a job found running after a reload) or moved: nothing to go by.
    expect(holdHint(back, at(percent))).toBeNull();
    expect(holdHint(back, at(percent, { stillSinceStart: undefined }))).toBeNull();
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
  });

  it('falls back to the generic card when the Z before the M0 cannot be told', () => {
    for (const between of ['G28', 'G30', 'G91', 'G92 Z0', 'G10 L20 P0 Z0', 'G38.2 Z-50 F100']) {
      const program = `G21\nG90\nG0 Z11\nG1 X10 F900\n${between}\nM0 (MSG Check)\nG90\n` + 'G1 X1\n'.repeat(500);
      expect(holdHint(program, at(after(program, 'Check'), { wpos: { z: 50 }, mpos: { z: 0 } }))).toBeNull();
    }
    const plain = 'G21\nG90\nG0 Z11\nG1 X10 F900\nM0 (MSG Check)\n' + 'G1 X1\n'.repeat(500);
    expect(holdHint(plain, at(after(plain, 'Check')))?.reason).toContain('Check');
    // Moves before the first M0 but no Z: it is not the "nothing moved yet" case either.
    const noZ = 'G21\nG90\nG1 X10 F900\nM0 (MSG Check)\n' + 'G1 X1\n'.repeat(500);
    expect(holdHint(noZ, at(after(noZ, 'Check'), { stillSinceStart: true }))).toBeNull();
  });
});
