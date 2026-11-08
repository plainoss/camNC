import {
  addCircle,
  addPartCopy,
  addPartCut,
  setPartPattern,
  cadSketchRegions,
  createCadPart,
  createPlateDocument,
  setCutDepth,
} from '@wbcnc/cad';
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

  it('puts a step cutting parts after the last part it uses', () => {
    let document = createPlateDocument({ width: 300, height: 600, thickness: 18 });
    document.parts[0]!.name = 'Side';
    const back = { ...createCadPart('Back', 6) };
    document = { ...document, parts: [...document.parts, back, { ...createCadPart('Shelf', 18) }] };
    document = addPartCut(document, [back.id], [document.parts[0]!.id], { value: 0.2, expression: 'fit' }).document;
    expect(designSteps(document).map(step => [step.kind, step.label, step.detail])).toEqual([
      ['sketch', 'Sketch · Side', undefined],
      ['extrude', 'Extrude · Side', '18 mm'],
      ['sketch', 'Sketch · Back', undefined],
      ['extrude', 'Extrude · Back', '6 mm'],
      ['partCut', 'Cut Side with Back', 'clearance fit = 0.2 mm'],
      ['sketch', 'Sketch · Shelf', undefined],
      ['extrude', 'Extrude · Shelf', '18 mm'],
    ]);
  });

  it('shows a part pattern as one step, not a copy step for each copy it lays out', () => {
    let document = createPlateDocument({ width: 300, height: 100, thickness: 12 });
    const divider = document.parts[0]!;
    divider.name = 'Divider';
    divider.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    document = addPartCopy(document, divider.id).document;
    document = setPartPattern(document, divider.id, { axis: 'y', count: 4, countExpression: 'dividers', spacing: 80 });
    expect(document.parts[0]!.copies).toHaveLength(4);
    expect(designSteps(document).map(step => [step.kind, step.label, step.detail])).toEqual([
      ['sketch', 'Sketch · Divider', undefined],
      ['extrude', 'Extrude · Divider', '12 mm'],
      ['copy', 'Copy · Divider 2', undefined],
      ['pattern', 'Pattern · Divider × 4 along y', 'spacing 80 mm'],
    ]);
  });
});
