import { describe, expect, it } from 'vitest';
import { createPlateDocument, parseCadDocument } from './document';
import { evaluateCadPart, polygonArea } from './geometry';
import type { CadPart } from './types';

/** A 100 × 60 plate and the id of its corner at (x, y). */
function plate(): { part: CadPart; corner: (x: number, y: number) => string } {
  const part = createPlateDocument({ width: 100, height: 60 }).parts[0]!;
  const corner = (x: number, y: number) =>
    part.sketch.entities.find(e => e.type === 'point' && Math.abs(e.x - x) < 1e-6 && Math.abs(e.y - y) < 1e-6)!.id;
  return { part, corner };
}

describe('a Fillet step', () => {
  it('rounds the part at its corners, leaving its sketch as drawn', () => {
    const { part, corner } = plate();
    const filleted = { ...part, fillets: [{ id: 'f', corners: [corner(100, 60), corner(0, 0)], radius: 10 }] };
    const made = evaluateCadPart(filleted);
    expect(made.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    // Each rounded corner takes away a square less a quarter circle.
    expect(Math.abs(polygonArea(made.part!.outline))).toBeCloseTo(6000 - 2 * (100 - 25 * Math.PI), 0);
    expect(filleted.sketch).toBe(part.sketch);
    const document = { ...createPlateDocument(), parts: [filleted] };
    expect(parseCadDocument(JSON.parse(JSON.stringify(document))).parts[0]!.fillets).toEqual(filleted.fillets);
  });

  it('says why when a fillet can’t be made, and leaves the corner sharp', () => {
    const { part, corner } = plate();
    const made = evaluateCadPart({ ...part, fillets: [{ id: 'f', corners: [corner(100, 60)], radius: 80 }] });
    expect(made.diagnostics.some(d => d.code === 'fillet-unresolved')).toBe(true);
    expect(Math.abs(polygonArea(made.part!.outline))).toBeCloseTo(6000, 3);
  });
});
