import { addCircle, addPartCopy, cadSketchRegions, createCadPart, createPlateDocument, setCutDepth } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { designSteps } from './designSteps';

describe('the design’s steps', () => {
  it('lists each part’s sketch, thickness, cuts and copies in order', () => {
    let document = createPlateDocument({ width: 300, height: 600, thickness: 18 });
    const side = document.parts[0]!;
    side.name = 'Side';
    side.thicknessExpression = 'board';
    side.sketch = addCircle(side.sketch, { x: 150, y: 300, radius: 20 });
    const hole = cadSketchRegions(side, side.sketch.id).find(region => region.curveIds.length === 1)!;
    document = setCutDepth(document, side.id, side.sketch.id, hole.id, 6, 'housing');
    document = addPartCopy(document, side.id, { mirrored: true }).document;
    document = { ...document, parts: [...document.parts, { ...createCadPart('Shelf', 18) }] };
    expect(designSteps(document).map(step => [step.kind, step.label, step.detail])).toEqual([
      ['sketch', 'Sketch · Side', undefined],
      ['extrude', 'Extrude · Side', 'board = 18 mm'],
      ['cut', 'Cut 1 · Side', 'housing = 6 mm'],
      ['copy', 'Mirrored copy · Side 2', undefined],
      ['sketch', 'Sketch · Shelf', undefined],
      ['extrude', 'Extrude · Shelf', '18 mm'],
    ]);
  });
});
