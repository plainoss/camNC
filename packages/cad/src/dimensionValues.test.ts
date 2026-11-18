import { describe, expect, it } from 'vitest';
import { createPlateDocument, dimensionValueError, parseCadDocument, updateDimension, validateCadDocument } from './index';

describe('owned line dimension value domains', () => {
  it.each(['distanceX', 'distanceY'] as const)('takes a zero %s line size, as a line can collapse to a point', type => {
    const owned = { type, sourceEntityId: 'line' };
    for (const value of [0, -0, 1e-7, -1e-7, -20]) expect(dimensionValueError(owned, value)).toBeNull();
    expect(dimensionValueError({ ...owned, driven: true }, 0)).toBeNull();
    expect(dimensionValueError({ type }, 0)).toBeNull();
  });
  it('keeps a zero owned width through source validation, and takes zero for point coordinates and normal gaps', () => {
    const document = createPlateDocument(),
      width = document.parts[0]!.sketch.constraints.find(constraint => constraint.label === 'Width')!;
    const collapsed = updateDimension(document, width.id, 0);
    expect(validateCadDocument(collapsed).some(diagnostic => diagnostic.code === 'invalid-dimension')).toBe(false);
    const portable = parseCadDocument(JSON.parse(JSON.stringify(collapsed)));
    expect(portable.parts[0]!.sketch.constraints.find(constraint => constraint.id === width.id)).toHaveProperty('value', 0);
    for (const type of [
      'positionX',
      'positionY',
      'pointLineDistance',
      'lineLineDistance',
      'pointArcDistance',
      'lineCircleDistance',
      'circleCircleDistance',
    ] as const)
      expect(dimensionValueError({ type }, 0)).toBeNull();
    expect(document.parts[0]!.sketch.constraints.find(constraint => constraint.id === width.id)).toHaveProperty('value', 120);
  });
});
