import { partBrep, profileFeatures, writeStep, type SidedCut } from '@wbcnc/cam';
import { describe, expect, it } from 'vitest';
import { compareParts } from './compare';
import { fingerprintStep } from './stepFingerprint';

type Pt = { x: number; y: number };
/** A rectangle's corners counterclockwise from (x0, y0), turned to start at another corner and run the other way. */
function rect(x0: number, y0: number, x1: number, y1: number, { start = 0, clockwise = false } = {}): Pt[] {
  const corners = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  const turned = [...corners.slice(start), ...corners.slice(0, start)];
  return clockwise ? [turned[0]!, ...turned.slice(1).reverse()] : turned;
}

const thickness = 18;
/** The 100 × 60 × 18 plate with a 40 × 20 × 6 pocket whose corner is at (x, y), cut from the top. */
function plateFromTop(x: number, y: number, holes: Pt[][] = []) {
  const cuts: SidedCut[] = [{ id: 'pocket', from: 0, to: 6, through: false, outline: rect(x, y, x + 40, y + 20), islands: [] }];
  const { features, below } = profileFeatures({ thickness, outline: rect(0, 0, 100, 60), holes, cuts });
  return writeStep([{ name: 'Plate', solids: [{ brep: partBrep(features, below) }] }], { timestamp: '2026-11-13T00:00:00' });
}
/**
 * The same plate built the other way up: the pocket cut from the underside of a plate drawn from another corner and
 * clockwise, and the solid then turned over about X (y → 60 - y, z → 18 - z), so the pocket ends up on top again.
 */
function plateTurnedOver(x: number, y: number) {
  const cuts: SidedCut[] = [
    {
      id: 'pocket',
      from: 0,
      to: 6,
      through: false,
      outline: rect(x, 60 - y - 20, x + 40, 60 - y, { start: 2, clockwise: true }),
      islands: [],
      side: 'underside',
    },
  ];
  const { features, below } = profileFeatures({ thickness, outline: rect(0, 0, 100, 60, { start: 1, clockwise: true }), holes: [], cuts });
  // Column-major: x stays, y and z flip, then back into the same place.
  const matrix = [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 60, thickness, 1];
  return writeStep([{ name: 'Plate', solids: [{ brep: partBrep(features, below), matrix }] }], { timestamp: '2026-11-13T00:00:00' });
}
const read = (step: string) => fingerprintStep(new TextEncoder().encode(step));

describe('STEP fingerprints', () => {
  it('reads the plate as one closed solid of the right size, volume and genus', async () => {
    const [plate, ...rest] = await read(plateFromTop(10, 15));
    expect(rest).toEqual([]);
    const { fingerprint } = plate!;
    expect(fingerprint).toMatchObject({ name: 'Plate', genus: 0, closed: true });
    expect(fingerprint.volume).toBeCloseTo(100 * 60 * 18 - 40 * 20 * 6, 3);
    expect(fingerprint.area).toBeCloseTo(2 * (100 * 60 + 100 * 18 + 60 * 18) + 2 * (40 + 20) * 6, 3);
    fingerprint.bbox.min.forEach(c => expect(c).toBeCloseTo(0, 6));
    fingerprint.bbox.max.forEach((c, axis) => expect(c).toBeCloseTo([100, 60, 18][axis]!, 6));
  });

  it('counts a through hole as genus 1', async () => {
    const [plate] = await read(plateFromTop(10, 15, [rect(70, 20, 90, 40)]));
    expect(plate!.fingerprint).toMatchObject({ genus: 1, closed: true });
  });

  it('finds the plate built two ways equal', async () => {
    const top = await read(plateFromTop(10, 15)),
      turned = await read(plateTurnedOver(10, 15));
    const result = compareParts(top, turned);
    expect(result.failures).toEqual([]);
    expect(result.equal).toBe(true);
    expect(result.parts[0]!.distance!.expectedToActual.max).toBeLessThan(0.05);
  });

  it('fails a pocket moved 2 mm by its surfaces, though volume and bbox match', async () => {
    const result = compareParts(await read(plateFromTop(10, 15)), await read(plateFromTop(12, 15)));
    expect(result.equal).toBe(false);
    const [part] = result.parts;
    expect(part!.pass).toEqual({ volume: true, bbox: true, distance: false, genus: true });
    expect(result.failures).toEqual([expect.stringMatching(/surfaces are up to \d\.\d+ mm apart/)]);
  });
});
