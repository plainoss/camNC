import { describe, expect, it } from 'vitest';
import { createPlateDocument, parseCadDocument } from './document';
import { evaluateCadPart, polygonArea, CAD_CHORD_TOLERANCE } from './geometry';
import { sketchRegions } from './sketchRegions';
import { cadVariableUses, setCadVariable } from './variables';
import { designSteps, rolledBackTo } from './designSteps';
import { edgeFilletProblems } from './edgeFillets';
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

describe('a Fillet step in the design', () => {
  it('keeps a part made of picked regions, and follows a variable for its radius', async () => {
    const { part, corner } = plate();
    const regions = sketchRegions(part.sketch, CAD_CHORD_TOLERANCE).map(region => region.id);
    const filleted = { ...part, regions, fillets: [{ id: 'f', corners: [corner(100, 60)], radius: 5, radiusExpression: 'round' }] };
    const made = setCadVariable({ ...createPlateDocument(), parts: [filleted] }, { name: 'round', expression: '10 mm' });
    if ('error' in made) throw new Error(made.error);
    expect(made.document.parts[0]!.fillets![0]!.radius).toBe(10);
    expect(cadVariableUses(made.document, 'round')).toBe(1);
    const evaluated = evaluateCadPart(made.document.parts[0]!);
    expect(Math.abs(polygonArea(evaluated.part!.outline))).toBeCloseTo(6000 - (100 - 25 * Math.PI), 0);
  });

  it('is left out when the design is rolled back to before it', () => {
    const { part, corner } = plate();
    const filleted = { ...part, fillets: [{ id: 'f', corners: [corner(100, 60)], radius: 10 }] };
    const document = { ...createPlateDocument(), parts: [filleted] };
    const rolled = rolledBackTo(document, `${part.id}:extrude`);
    expect(rolled.parts[0]!.fillets).toBeUndefined();
  });
});

describe('a Fillet step whose radius uses up a side', () => {
  /** A 400 mm wide plate with three of its corners rounded: two of them share the right side, `height` long. */
  function rounded(height: number, radius: number) {
    const part = createPlateDocument({ width: 400, height }).parts[0]!;
    const corner = (x: number, y: number) =>
      part.sketch.entities.find(e => e.type === 'point' && Math.abs(e.x - x) < 1e-6 && Math.abs(e.y - y) < 1e-6)!.id;
    const corners = [corner(0, 0), corner(400, 0), corner(400, height)];
    const document = { ...createPlateDocument(), parts: [{ ...part, name: 'Part 1', fillets: [{ id: 'f', corners, radius }] }] };
    return { document, part: document.parts[0]!, corners };
  }
  const message =
    'A fillet on Part 1 can’t be made at 2 of its 3 corners: This radius would consume an entire adjacent line. Choose a smaller radius.';

  for (const [route, height, radius] of [
    ['a radius of 125 on a 250 mm side', 250, 125],
    ['a 50 mm side under a radius of 30', 50, 30],
  ] as const)
    it(`says so on its row and in the check, and still rounds the corner that can take it, for ${route}`, () => {
      const { document, part, corners } = rounded(height, radius);
      const made = evaluateCadPart(part);
      const unresolved = made.diagnostics.filter(d => d.code === 'fillet-unresolved');
      expect(unresolved).toEqual([expect.objectContaining({ partId: part.id, message, entityIds: [corners[1], corners[2]] })]);
      expect(edgeFilletProblems(part)).toEqual([{ filletId: 'f', message, corners: [corners[1], corners[2]] }]);
      expect(designSteps(document).find(step => step.id === 'f')?.broken).toBe(message);
      // The corner whose sides can each take the radius is rounded; the two sharing the side used up stay sharp.
      expect(Math.abs(polygonArea(made.part!.outline))).toBeCloseTo(400 * height - radius ** 2 * (1 - Math.PI / 4), -1);
    });

  it('leaves every corner sharp, and says so, when none can take it', () => {
    const { part, corners } = rounded(250, 200);
    const made = evaluateCadPart(part);
    expect(made.diagnostics.find(d => d.code === 'fillet-unresolved')).toMatchObject({
      message: 'A fillet on Part 1 can’t be made: This radius would consume an entire adjacent line. Choose a smaller radius.',
      entityIds: corners,
    });
    expect(Math.abs(polygonArea(made.part!.outline))).toBeCloseTo(400 * 250, 3);
  });

  it('isn’t marked when it fits, or when it’s switched off', () => {
    const fits = rounded(250, 124);
    expect(edgeFilletProblems(fits.part)).toEqual([]);
    expect(designSteps(fits.document).find(step => step.id === 'f')?.broken).toBeUndefined();
    const off = rounded(250, 125);
    const suppressed = { ...off.document, parts: [{ ...off.part, fillets: [{ ...off.part.fillets[0]!, suppressed: true as const }] }] };
    expect(designSteps(suppressed).find(step => step.id === 'f')?.broken).toBeUndefined();
  });
});
