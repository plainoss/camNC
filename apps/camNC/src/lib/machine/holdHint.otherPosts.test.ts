import { describe, expect, it } from 'vitest';
import { type HoldContext, holdHint } from './holdHint';
import { pauseHint } from './pauseHints';
import { controllerPercent } from './pauseHints.fixture';

// M0s of other posts (#807): lifts in machine coordinates (G53, G28/G30) before a tool change, and an M0 with no lift.

const bytes = (text: string) => new TextEncoder().encode(text).length;
/** FluidNC's percent with the reader just after the first line containing `text` (from `from` on). */
const after = (gcode: string, text: string, from = 0) =>
  controllerPercent(bytes(gcode.slice(0, gcode.indexOf('\n', gcode.indexOf(text, from)) + 1)), bytes(gcode));
/** Held by the machine's button, the spindle reported off during the hold. */
const at = (percent: number, more: Partial<HoldContext> = {}): HoldContext => ({
  percent,
  readTo: percent,
  holdRequested: false,
  positionUnits: 'mm',
  mpos: { z: -20 },
  wpos: { z: 11 },
  stillSinceStart: false,
  spindle: 'off',
  ...more,
});

/** Long enough that the reader held at the M5 reports nearly the position of the M0 after it. */
const cut = (z: number) => Array.from({ length: 30_000 }, (_, i) => `G1 X${i % 90} Y${i % 40} Z${z}`);
const program = (before: string[], stop: string[]) =>
  [...before, 'G1 Z-6 F300', ...cut(-6), ...stop, 'G90', 'G0 Z11', 'G1 Z-6 F300', ...cut(-6), 'M30', ''].join('\n');
const m0 = 'M0 (MSG Change to T2)';
/** Work Z zero 30 mm below machine Z zero: work Z -6 is machine Z -36. */
const cutting = { wpos: { z: -6 }, mpos: { z: -36 } };

/** Held with the reader at the M5 before the M0, the bit still in the cut: the position alone reads as the M0. */
function heldAtTheM5(gcode: string) {
  const percent = after(gcode, 'M5');
  expect(pauseHint(gcode, percent)?.reason).toContain('Change to T2');
  return percent;
}

describe('a tool change of another post after a lift in machine coordinates', () => {
  describe('G53 G0 Z0 with G91 still active at the M0', () => {
    const gcode = program(['G21', 'G90', 'G0 Z11'], ['G91', 'G53 G0 Z0', 'M5', m0, 'T2 M6']);

    it('shows the M0 with the bit up at machine Z 0', () => {
      for (const z of [0, -0.03])
        expect(holdHint(gcode, at(after(gcode, m0), { mpos: { z }, wpos: { z: z + 30 } }))?.reason).toContain('Change to T2');
      expect(holdHint(gcode, at(after(gcode, m0), { mpos: undefined }))).toBeNull();
    });

    it('is not the M0 while the bit is still cutting or in the lift', () => {
      const percent = heldAtTheM5(gcode);
      expect(holdHint(gcode, at(percent, cutting))).toBeNull();
      expect(holdHint(gcode, at(percent, { mpos: { z: -10 }, wpos: { z: 20 } }))).toBeNull();
    });

    it('a work offset change after the G53 lift does not move the bit, so the machine Z still holds', () => {
      const offset = program(['G21', 'G90', 'G0 Z11'], ['G53 G0 Z0', 'G55', 'G92 Z0', 'M5', m0]);
      expect(holdHint(offset, at(after(offset, m0), { mpos: { z: 0 } }))?.reason).toContain('Change to T2');
      expect(holdHint(offset, at(after(offset, m0), cutting))).toBeNull();
    });

    it('a G53 lift at feed counts as one too', () => {
      const feed = program(['G21', 'G90', 'G0 Z11'], ['G53 G1 Z0 F1000', 'M5', m0]);
      expect(holdHint(feed, at(after(feed, m0), { mpos: { z: 0 }, wpos: { z: 30 } }))?.reason).toContain('Change to T2');
      const percent = heldAtTheM5(feed);
      expect(holdHint(feed, at(percent, cutting))).toBeNull();
      expect(holdHint(feed, at(percent, { mpos: { z: -10 }, wpos: { z: 20 } }))).toBeNull();
    });
  });

  for (const home of ['G28', 'G30'])
    describe(`${home} G91 Z0, after a G53 Z earlier in the program`, () => {
      const gcode = program(['G21', 'G90', 'G53 G0 Z-2', 'G0 X0 Y0', 'G0 Z11'], [`${home} G91 Z0`, 'M5', m0, 'T2 M6']);

      it('shows the M0 with the bit at or above that G53 Z', () => {
        for (const z of [-2, -1, 0]) expect(holdHint(gcode, at(after(gcode, m0), { mpos: { z } }))?.reason).toContain('Change to T2');
      });

      it('is not the M0 while the bit is below it', () => {
        expect(holdHint(gcode, at(heldAtTheM5(gcode), cutting))).toBeNull();
        expect(holdHint(gcode, at(after(gcode, m0), { mpos: { z: -5 } }))).toBeNull();
      });

      it('without a G53 Z before it, the stored position cannot be told: the generic card', () => {
        const unknown = program(['G21', 'G90', 'G0 Z11'], [`${home} G91 Z0`, 'M5', m0]);
        expect(holdHint(unknown, at(after(unknown, m0), { mpos: { z: 0 }, wpos: { z: 30 } }))).toBeNull();
      });

      it(`${home} moving only X and Y leaves the Z before it`, () => {
        const xy = program(['G21', 'G90'], ['G0 Z11', `${home} X0 Y0`, 'M5', m0]);
        expect(holdHint(xy, at(after(xy, m0), { wpos: { z: 11 } }))?.reason).toContain('Change to T2');
        expect(holdHint(xy, at(heldAtTheM5(xy), cutting))).toBeNull();
      });
    });
});

describe('an M0 of another post with no lift before it', () => {
  it('after a cut at the M0’s depth, is never the M0: the bit may be in the material', () => {
    const gcode = program(['G21', 'G90', 'G0 Z11'], ['M5', m0]);
    expect(holdHint(gcode, at(heldAtTheM5(gcode), cutting))).toBeNull();
    // At the real stop the bit is at the cut's depth too, which is the same as the reader blocked before it.
    expect(holdHint(gcode, at(after(gcode, m0), cutting))).toBeNull();
    expect(holdHint(gcode, at(after(gcode, m0), { wpos: { z: 11 } }))).toBeNull();
  });

  it('after a step down to a lower depth, is not the M0 either', () => {
    const gcode = program(['G21', 'G90', 'G0 Z11', 'G1 Z-3 F300', ...cut(-3)], ['G1 Z-9 F300', 'G1 X5', 'M5', m0]);
    expect(holdHint(gcode, at(after(gcode, m0), { wpos: { z: -9 } }))).toBeNull();
  });

  it('a feed move above every Z cut so far is a lift: shows the M0 with the bit up there', () => {
    const gcode = program(['G21', 'G90', 'G0 Z11'], ['G1 Z5 F300', 'M5', m0]);
    expect(holdHint(gcode, at(after(gcode, m0), { wpos: { z: 5 } }))?.reason).toContain('Change to T2');
    expect(holdHint(gcode, at(heldAtTheM5(gcode), cutting))).toBeNull();
    // Only up to a cut before: Z -6 was cut at, so a feed move to Z -6 after a deeper cut is not a lift.
    const back = program(['G21', 'G90', 'G0 Z11'], ['G1 Z-9 F300', 'G1 X5', 'G1 Z-6', 'M5', m0]);
    expect(holdHint(back, at(after(back, m0), { wpos: { z: -6 } }))).toBeNull();
  });

  it('a rapid lift before it shows the M0 with the bit up, not while it cuts', () => {
    const gcode = program(['G21', 'G90', 'G0 Z11'], ['G0 Z11', 'M5', m0]);
    expect(holdHint(gcode, at(after(gcode, m0), { wpos: { z: 11 } }))?.reason).toContain('Change to T2');
    expect(holdHint(gcode, at(heldAtTheM5(gcode), cutting))).toBeNull();
  });

  describe('a frame change or probe before the first cut', () => {
    for (const header of [['G54'], ['G49'], ['G43.1 Z0'], ['G92 Z0'], ['G38.2 Z-20 F100', 'G92 Z0']])
      it(`${header.join(' / ')} leaves a later feed lift recognisable`, () => {
        const gcode = program(['G21', 'G90', ...header, 'G0 Z11'], ['G1 Z5 F300', 'M5', m0]);
        expect(holdHint(gcode, at(after(gcode, m0), { wpos: { z: 5 } }))?.reason).toContain('Change to T2');
        expect(holdHint(gcode, at(heldAtTheM5(gcode), cutting))).toBeNull();
      });

    it('after a cut, a frame change still makes earlier cut heights unknown', () => {
      const gcode = program(['G21', 'G90', 'G0 Z11', 'G1 Z-6 F300', 'G1 X10', 'G0 Z11', 'G55', 'G0 Z11'], ['G1 Z5 F300', 'M5', m0]);
      expect(holdHint(gcode, at(after(gcode, m0), { wpos: { z: 5 } }))).toBeNull();
    });
  });

  describe('with cutting lines that carry no Z', () => {
    /** A cut in X and Y only, at the Z the plunge went to. */
    const flat = Array.from({ length: 30_000 }, (_, i) => `G1 X${i % 90} Y${i % 40}`);
    const flatProgram = (before: string[], stop: string[]) =>
      [...before, ...flat, ...stop, 'G90', 'G0 Z11', 'G1 Z-6 F300', ...flat, 'M30', ''].join('\n');

    it('the first plunge of the program is not a lift', () => {
      const gcode = flatProgram(['G21', 'G90', 'G0 Z11', 'G0 X0 Y0', 'G1 Z-6 F300'], ['M5', m0]);
      expect(holdHint(gcode, at(heldAtTheM5(gcode), cutting))).toBeNull();
      expect(holdHint(gcode, at(after(gcode, m0), cutting))).toBeNull();
    });

    it('a plunge shallower than earlier cuts is not a lift', () => {
      const gcode = flatProgram(['G21', 'G90', 'G0 Z11', 'G1 Z-6 F300', 'G1 X10', 'G0 Z11', 'G0 X0 Y0', 'G1 Z-3 F300'], ['M5', m0]);
      expect(holdHint(gcode, at(heldAtTheM5(gcode), { wpos: { z: -3 }, mpos: { z: -33 } }))).toBeNull();
    });

    it('a rapid back to an earlier depth, followed by feed moves at it, is not a lift', () => {
      const gcode = flatProgram(['G21', 'G90', 'G0 Z11', 'G1 Z-6 F300', 'G1 X10', 'G0 Z11', 'G0 X0 Y0', 'G0 Z-6'], ['M5', m0]);
      expect(holdHint(gcode, at(heldAtTheM5(gcode), cutting))).toBeNull();
      expect(holdHint(gcode, at(after(gcode, m0), cutting))).toBeNull();
    });

    it('a feed lift followed by feed moves at that height is a lift only while above every earlier cut', () => {
      const gcode = flatProgram(['G21', 'G90', 'G0 Z11', 'G1 Z-6 F300'], ['G1 Z5', 'G1 X0 Y0', 'M5', m0]);
      expect(holdHint(gcode, at(after(gcode, m0), { wpos: { z: 5 } }))?.reason).toContain('Change to T2');
      expect(holdHint(gcode, at(heldAtTheM5(gcode), cutting))).toBeNull();
    });

    it('a feed lift after the cut, with no feed move after it, still shows the M0 with the bit up', () => {
      const gcode = flatProgram(['G21', 'G90', 'G0 Z11', 'G1 Z-6 F300'], ['G1 Z5', 'M5', m0]);
      expect(holdHint(gcode, at(after(gcode, m0), { wpos: { z: 5 } }))?.reason).toContain('Change to T2');
      expect(holdHint(gcode, at(heldAtTheM5(gcode), cutting))).toBeNull();
    });
  });
});
