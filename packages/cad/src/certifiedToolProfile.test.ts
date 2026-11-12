import { expect, it } from 'vitest';
import { addRectangle, createCadPart, evaluateCadPart, mirrorEvaluatedPart } from './index';
import { certifiedToolProfile } from './certifiedToolProfile';
import { occupiedToolBoxes } from './occupiedToolBoxes';

function fixture(drift = 5e-12) {
  const part = createCadPart('Constrained rectangle', 18);
  part.sketch = addRectangle(part.sketch, { x: -100, y: 8, width: 1000, height: 30, dimensioned: true, positioned: true });
  const shape = evaluateCadPart(part).part!;
  // Same roundoff-sized discrepancy observed after changing a positioned, dimensioned rectangle's expression.
  const corner = shape.outline[3]!;
  corner.x += drift;
  corner.y += 3e-13;
  return { part, shape };
}

it('certifies an axis rectangle from its horizontal/parallel/perpendicular constraints before decomposition', () => {
  const { part, shape } = fixture(),
    before = JSON.stringify(shape);
  expect(occupiedToolBoxes(shape, [-100, 8, 0], [900, 38, 18])).toHaveProperty('refused');
  const certified = certifiedToolProfile(shape, part);
  expect(certified).not.toBe(shape);
  expect(occupiedToolBoxes(certified, [-100, 8, 0], [900, 38, 18])).toHaveProperty('boxes');
  expect(JSON.stringify(shape)).toBe(before);
  expect(
    certified.outline.every((point, i) => point.x === certified.outline[(i + 1) % 4]!.x || point.y === certified.outline[(i + 1) % 4]!.y)
  ).toBe(true);
});

it('retains an equally shallow unconstrained slant instead of replacing it with bounding stock', () => {
  const { part, shape } = fixture();
  part.sketch.constraints = part.sketch.constraints.filter(
    constraint => !['horizontal', 'parallel', 'perpendicular'].includes(constraint.type)
  );
  expect(certifiedToolProfile(shape, part)).toBe(shape);
  expect(occupiedToolBoxes(shape, [-100, 8, 0], [900, 38, 18])).toHaveProperty('refused');
});

it('refuses a source claiming axis constraints when the adjustment exceeds the floating-point bound', () => {
  const { part, shape } = fixture(1e-9);
  expect(certifiedToolProfile(shape, part)).toBe(shape);
  expect(occupiedToolBoxes(shape, [-100, 8, 0], [900, 38, 18])).toHaveProperty('refused');
});

it('preserves proof through mirrored profile lineage without changing chirality', () => {
  const { part, shape } = fixture(),
    mirrored = mirrorEvaluatedPart(shape),
    result = certifiedToolProfile(mirrored, part);
  expect(result.partId).toBe(mirrored.partId);
  expect(occupiedToolBoxes(result, [-900, 8, 0], [100, 38, 18])).toHaveProperty('boxes');
  expect(mirrored.outline).not.toEqual(result.outline);
});
