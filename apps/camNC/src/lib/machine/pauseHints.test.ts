import { describe, expect, it } from 'vitest';
import { boardProgram, controllerPercent, largeProgram } from './pauseHints.fixture';
import { pauseHint, positionWindow } from './pauseHints';

const percentAfter = (gcode: string, text: string) => {
  const bytes = new TextEncoder().encode(gcode);
  const end = gcode.indexOf('\n', gcode.indexOf(text)) + 1;
  return Math.round(((100 * new TextEncoder().encode(gcode.slice(0, end)).length) / bytes.length) * 100) / 100;
};

// Shape of a Fusion "MPCNC" post as run on a Jackpot2, padded to a realistic size.
const fusion = [
  '(  T3 D=6 CR=0 - ZMIN=-9.5 - flat end mill )',
  'G21',
  'G90',
  ';M0 (MSG Attach probe)',
  '( >>> Spindle Speed: Manual)',
  'M0 (MSG Turn ON 30000RPM)',
  '( COMMAND_COOLANT_ON)',
  'G0 Z8 F1200',
  'X144.277 Y9.049 F9000',
  ...Array.from({ length: 2000 }, (_, i) => `G1 X${i % 100} Y${i % 50} F1800`),
].join('\n');

describe('pauseHint', () => {
  it('finds the M0 the job stopped at from the SD progress and shows its message', () => {
    const hint = pauseHint(fusion, percentAfter(fusion, 'Turn ON'));
    expect(hint).toEqual({
      reason: 'The job stopped at a program pause (M0) on line 6: “Turn ON 30000RPM”.',
      next: 'Resume continues with the next move.',
      line: 6,
    });
  });

  it('ignores commented-out pauses and returns null away from any pause (feed hold)', () => {
    expect(pauseHint(fusion, 60)).toBeNull();
  });

  it('explains a probe and a tool change that come next', () => {
    const probe = 'G21\nM0 (MSG Attach probe)\nG38.2 Z-50 F100\n' + 'G1 X1\n'.repeat(500);
    expect(pauseHint(probe, percentAfter(probe, 'Attach'))?.next).toBe(
      'Next it probes Z (G38). Attach the probe clip and put the plate under the bit, then Resume.'
    );
    const toolChange = '(T2 D=3.175 CR=0 - ZMIN=-2 - flat end mill)\nG21\nM0 (MSG Change bit)\nT2 M6\nG0 Z5\n' + 'G1 X1\n'.repeat(500);
    const hint = pauseHint(toolChange, percentAfter(toolChange, 'Change bit'));
    expect(hint?.reason).toBe('The job stopped at a program pause (M0) on line 3: “Change bit”.');
    expect(hint?.next).toBe(
      'Tool change to T2 (3.175 mm flat end mill): change the bit, then Resume. Re-zero Z if the program does not probe.'
    );
  });

  it('FluidNC holds a running file only at M0: never explains an M1, M60 or M6 as the pause', () => {
    for (const command of ['M1', 'M01', 'M60', 'T2 M6', 'M06 T2']) {
      const program = `G21\n${command} (MSG Something)\nG0 Z5\n` + 'G1 X1\n'.repeat(500);
      expect(pauseHint(program, percentAfter(program, 'Something'))).toBeNull();
    }
    const m00 = 'G21\nM00 (MSG Something)\nG0 Z5\n' + 'G1 X1\n'.repeat(500);
    expect(pauseHint(m00, percentAfter(m00, 'Something'))?.line).toBe(2);
  });
});

describe('the position window', () => {
  // Byte positions where the printed percent is closest to a tie, and some in between.
  const edges = (size: number) =>
    [1, 2, 3, 9999, 10000, 5000, 1234].flatMap(k => {
      const tie = ((k + 0.5) * size) / 10000;
      return [-1, 0, 1].map(d => Math.round(tie) + d).filter(p => p > 0 && p <= size);
    });

  it('holds at any file size, also where the controller rounds a tie', () => {
    for (const size of [137, 13_225, 99_991, 2_000_000, 2_000_003, 16_777_259, 64_000_037]) {
      for (const position of [...edges(size), size, Math.floor(size / 3), Math.floor((size * 7) / 9)]) {
        const reported = (controllerPercent(position, size) / 100) * size;
        expect(Math.abs(reported - position)).toBeLessThanOrEqual(positionWindow(size));
      }
    }
  });

  it('finds both M0s of a 2 MB program at their rounding-edge positions', () => {
    const { gcode, size, startEnd, doneEnd } = largeProgram;
    expect(new TextEncoder().encode(gcode).length).toBe(size);
    expect(pauseHint(gcode, controllerPercent(startEnd, size))?.marker).toEqual({ kind: 'start', rpm: 15000 });
    expect(pauseHint(gcode, controllerPercent(doneEnd, size))?.marker).toEqual({ kind: 'done' });
  });
});

describe('pauses close together (guided tab removal)', () => {
  const tabs = [
    '( Tools Table:)',
    '(  T1 D=3.175 CR=0 - ZMIN=-0.3 - flat end mill )',
    'G0 Z13',
    'M0 (MSG Turn ON spindle 15000RPM)',
    'G0 Z13',
    'M0 (MSG Tab 1 of 2: hold left at the marked spot, away from the bit, then resume)',
    'G0 X10 Y0',
    'G1 Z-0.3 F300',
    'G1 X18 F900',
    'G0 Z13',
    'M0 (MSG Tab 2 of 2: hold left at the marked spot, away from the bit, then resume)',
    'G0 X50 Y0',
  ].join('\n');

  it('explains the pause the job is at, not an earlier one a few bytes before', () => {
    for (const [k, text] of [
      [4, 'Turn ON spindle'],
      [6, 'Tab 1 of 2'],
      [11, 'Tab 2 of 2'],
    ] as const) {
      const hint = pauseHint(tabs, percentAfter(tabs, text));
      expect(hint?.line).toBe(k);
      expect(hint?.reason).toContain(text);
    }
  });
});

describe('camNC’s own pauses', () => {
  const free = [
    '(camNC CAM)',
    'G0 Z13',
    'M5',
    '(CAMNC PAUSE take-out; n=2/5; part=Part 1b; next=Part 2)',
    'M0 (MSG Take out Part 1b, then continue. Manual spindle: off now, on before Resume)',
    'M3 S18000',
    'G4 P3',
    ...Array.from({ length: 500 }, (_, i) => `G1 X${i % 100} Y${i % 50} F1800`),
  ].join('\n');

  it('carry what the pause is for from the marker before the M0', () => {
    const hint = pauseHint(free, percentAfter(free, 'MSG Take out'));
    expect(hint?.line).toBe(5);
    expect(hint?.marker).toEqual({ kind: 'take-out', n: 2, of: 5, part: 'Part 1b', next: 'Part 2' });
  });

  it('other programs have no marker', () => {
    expect(pauseHint(fusion, percentAfter(fusion, 'Turn ON'))?.marker).toBeUndefined();
  });
});

describe('a Pause in the cut of a board program (#792)', () => {
  // The percent FluidNC reports at that byte.
  const sd = (byte: number) => controllerPercent(byte, 13_225);
  const end = (lines: string[]) => new TextEncoder().encode(lines.join('\n')).length + 1;

  it('the program has the reported shape', () => {
    const lines = boardProgram.split('\n');
    expect(new TextEncoder().encode(boardProgram).length).toBe(13_225);
    expect(lines.length).toBe(771);
    expect([lines[14], lines[15], lines[765], lines[768]]).toEqual([
      'M0 (MSG Router on at 15000 RPM, then Resume)',
      'M3 S15000',
      'M5',
      'M0 (MSG Program done)',
    ]);
    expect(end(lines.slice(0, 15))).toBe(477);
    expect(end(lines.slice(0, 769))).toBe(13_220);
  });

  it('stopped at the start and done M0s, the controller reports the byte after them', () => {
    expect(pauseHint(boardProgram, sd(477))).toMatchObject({ line: 15, marker: { kind: 'start', rpm: 15000 } });
    expect(pauseHint(boardProgram, sd(13_220))).toMatchObject({ line: 769, marker: { kind: 'done' } });
  });

  it('a hold at 12.2 %, 30.2 % or 88.2 % is in the cut, not at an M0', () => {
    for (const percent of [12.2, 30.2, 88.2]) expect(pauseHint(boardProgram, percent)).toBeNull();
  });

  it('the line next to an M0 is not the M0: the window is the rounding of the percent, not kilobytes', () => {
    // Reading stopped after M3, one line past the start M0, or one line before the done M0.
    expect(sd(487)).toBe(3.68);
    expect(pauseHint(boardProgram, sd(487))).toBeNull();
    expect(pauseHint(boardProgram, sd(13_220 - 22))).toBeNull();
  });
});
