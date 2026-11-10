import { describe, expect, it } from 'vitest';
import { CAD_IDENTITY_PLACEMENT, type CadPoint, type EvaluatedCadCut, type EvaluatedCadPart } from '@wbcnc/cad';
import { axisMaterial } from './axisMaterial';
const rectangle = (x: number, y: number, w: number, h: number): CadPoint[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const plate = (): EvaluatedCadPart => ({
  partId: 'plate',
  name: 'Plate',
  thickness: 10,
  outline: rectangle(0, 0, 100, 60),
  holes: [],
  loops: [],
});
const pocket = (x: number, w = 20): EvaluatedCadCut => ({
  id: `cut-${x}`,
  regionId: 'r',
  side: 'top',
  from: 0,
  to: 4,
  through: false,
  outline: rectangle(x, 10, w, 20),
  islands: [],
});

describe('evaluated orthogonal material', () => {
  it('unions duplicate/overlapping cuts and retains islands, without using pre-relief opening boxes', () => {
    const part = plate();
    part.holes = [rectangle(40, 20, 20, 20)];
    part.cuts = [pocket(10), pocket(20), pocket(10)];
    part.cuts[0]!.opening = { x0: 0, y0: 0, x1: 100, y1: 60 };
    const measured = axisMaterial(part, CAD_IDENTITY_PLACEMENT);
    // 60,000 stock -4,000 through hole -2,400 union of pockets.
    expect(measured.volume).toBe(53600);
    expect(measured.containsWorld([15, 15, 8])).toBe(false);
    part.cuts = [{ ...pocket(10), islands: [rectangle(12, 12, 6, 6)] }, pocket(20)];
    const island = axisMaterial(part, CAD_IDENTITY_PLACEMENT);
    expect(island.volume).toBe(53744);
    expect(island.containsWorld([15, 15, 8])).toBe(true);
    part.cuts[0]!.islands = [rectangle(22, 12, 6, 6)];
    expect(axisMaterial(part, CAD_IDENTITY_PLACEMENT).containsWorld([15, 15, 8])).toBe(false);
  });
  it('counts disconnected material and retains a thin positive bridge rather than discarding it', () => {
    const part = plate();
    part.cuts = [{ ...pocket(49, 2), outline: rectangle(49, 0, 2, 60), to: 10, through: true }];
    expect(axisMaterial(part, CAD_IDENTITY_PLACEMENT)).toMatchObject({ volume: 58800, components: 2 });
    part.cuts[0]!.to = 10 - 1e-7;
    expect(axisMaterial(part, CAD_IDENTITY_PLACEMENT).components).toBe(1);
  });
  it('transforms interior probes and occupied bounds through a signed axis permutation', () => {
    const q = Math.SQRT1_2,
      measured = axisMaterial(plate(), { position: [200, 300, 400], rotation: [q, 0, 0, q] });
    expect(measured.bounds.min[0]).toBeCloseTo(200);
    expect(measured.bounds.min[1]).toBeCloseTo(290);
    expect(measured.bounds.min[2]).toBeCloseTo(400);
    expect(measured.containsWorld([250, 295, 430])).toBe(true);
    expect(measured.containsWorld([250, 285, 430])).toBe(false);
    expect(() => measured.containsWorld([200, 295, 430])).toThrow(/boundary/);
  });
  it('reports unsupported actual geometry rather than falling back to bounds', () => {
    const part = plate();
    part.outline = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 80, y: 60 },
      { x: 0, y: 60 },
    ];
    expect(() => axisMaterial(part, CAD_IDENTITY_PLACEMENT)).toThrow(/orthogonal/);
    expect(() => axisMaterial(plate(), { position: [0, 0, 0], rotation: [0, 0, 0, 2] })).toThrow(/rigid/);
  });
});
