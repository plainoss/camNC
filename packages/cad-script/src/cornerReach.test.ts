import { expect, it } from 'vitest';
import { editCad, inspectCadDocument, type DesignEdit } from './index';

type Relief = Parameters<DesignEdit['cutParts']>[1]['cornerRelief'];

/** A 40 × 18 tenon in an 18 mm seat: 9 mm deep, or through. */
async function mortise(through: boolean, cornerRelief: Relief | undefined, clearance: string, bit?: number) {
  const { document, report } = await editCad(null, d => {
    const seat = d.newPart('Seat', { thickness: 18 });
    seat.profile.rect({ at: [0, 0], w: 200, h: 200 });
    seat.drawOn('top');
    const tenon = d.newPart('Tenon', { thickness: 18 });
    tenon.profile.rect({ at: [80, 91], w: 40, h: 18 });
    tenon.drawOn('top', { offset: through ? 0 : '9mm' });
    d.cutParts(seat, { with: tenon, clearance, ...(cornerRelief !== undefined && { cornerRelief }) });
  });
  expect(report.errors).toEqual([]);
  const inspected = await inspectCadDocument(document, new Map(), bit === undefined ? {} : { bit });
  const seat = inspected.report.parts.find(part => part.name === 'Seat')!;
  return {
    reach: seat.toolpaths!.cornerReach,
    bit: seat.toolpaths!.bit,
    warnings: inspected.report.warnings.filter(w => w.code === 'corner-unreachable'),
  };
}

it.each([false, true])('warns that a 6 mm bit misses all four square tenon corners (through: %s)', async through => {
  const { reach, bit, warnings } = await mortise(through, undefined, '0mm', 6);
  expect(bit).toBe(6);
  // The bit's centre stops 3 mm in from both walls: 3√2 − 3 mm short of each corner.
  expect(reach).toEqual([{ ref: 'Tenon', corners: 4, unreached: 4, short: 1.24 }]);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toMatchObject({ part: 'Seat' });
  expect(warnings[0]!.message).toContain("The ⌀6 bit doesn't reach 4 of the 4 corners of the opening Tenon cuts in Seat");
});

it.each([false, true])('reaches every corner with a 6 mm dogbone and fit clearance (through: %s)', async through => {
  const { reach, warnings } = await mortise(through, { dogbone: 6 }, '0.2mm', 6);
  expect(reach).toEqual([{ ref: 'Tenon', corners: 4, unreached: 0, short: 0 }]);
  expect(warnings).toEqual([]);
});

it('still misses the corners with a dogbone but no clearance', async () => {
  const { reach, warnings } = await mortise(false, { dogbone: 6 }, '0mm', 6);
  // A bone the bit's own size only touches the corner on the drawing; the planned pass stops short of it.
  expect(reach![0]).toMatchObject({ corners: 4, unreached: 4, short: 0.1 });
  expect(warnings).toHaveLength(1);
});

it('checks against the bit the check plans with, so bones for a larger cutter clear a smaller default bit', async () => {
  const { reach, bit } = await mortise(false, { dogbone: 6 }, '0.2mm');
  expect(bit).toBe(3.175);
  expect(reach![0]).toMatchObject({ unreached: 0 });
  // Bones sized for a smaller bit than the one planned leave the corners out of reach.
  expect((await mortise(false, { dogbone: 3 }, '0.2mm', 6)).reach![0]).toMatchObject({ unreached: 4 });
});

it('leaves corners of an opening that runs off the part edge unchecked', async () => {
  const { document } = await editCad(null, d => {
    const seat = d.newPart('Seat', { thickness: 18 });
    seat.profile.rect({ at: [0, 0], w: 200, h: 200 });
    seat.drawOn('top');
    const rail = d.newPart('Rail', { thickness: 18 });
    rail.profile.rect({ at: [-10, 91], w: 60, h: 18 });
    rail.drawOn('top', { offset: '9mm' });
    d.cutParts(seat, { with: rail, clearance: '0mm' });
  });
  const seat = (await inspectCadDocument(document, new Map(), { bit: 6 })).report.parts.find(part => part.name === 'Seat')!;
  // Only the two corners inside the seat need the bit.
  expect(seat.toolpaths!.cornerReach).toEqual([{ ref: 'Rail', corners: 2, unreached: 2, short: expect.any(Number) }]);
});

it('maps a part drawn away from the origin onto its board, and skips corners on a profile hole', async () => {
  const { document } = await editCad(null, d => {
    const seat = d.newPart('Seat', { thickness: 18 });
    seat.profile.rect({ at: [50, 30], w: 200, h: 200 });
    seat.profile.circle({ at: [130, 121], d: 10 });
    seat.drawOn('top');
    const tenon = d.newPart('Tenon', { thickness: 18 });
    tenon.profile.rect({ at: [130, 121], w: 40, h: 18 });
    tenon.drawOn('top', { offset: '9mm' });
    d.cutParts(seat, { with: tenon, clearance: '0.2mm', cornerRelief: { dogbone: 6 } });
  });
  const seat = (await inspectCadDocument(document, new Map(), { bit: 6 })).report.parts.find(part => part.name === 'Seat')!;
  // The hole is centred on one corner, so three are left, all reached.
  expect(seat.toolpaths!.cornerReach).toEqual([{ ref: 'Tenon', corners: 3, unreached: 0, short: 0 }]);
});

it('checks a tenon from below that the clearance carries through the top', async () => {
  const { document } = await editCad(null, d => {
    const seat = d.newPart('Seat', { thickness: 18 });
    seat.profile.rect({ at: [0, 0], w: 200, h: 200 });
    seat.drawOn('top');
    const tenon = d.newPart('Tenon', { thickness: 18 });
    tenon.profile.rect({ at: [80, 91], w: 40, h: 18 });
    tenon.drawOn('top', { offset: '-0.1mm' });
    d.cutParts(seat, { with: tenon, clearance: '0.2mm' });
  });
  const seat = (await inspectCadDocument(document, new Map(), { bit: 6 })).report.parts.find(part => part.name === 'Seat')!;
  expect(seat.cuts).toEqual([expect.objectContaining({ side: 'underside', through: true })]);
  expect(seat.toolpaths!.cornerReach).toEqual([{ ref: 'Tenon', corners: 4, unreached: 4, short: expect.any(Number) }]);
});
