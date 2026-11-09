import {
  addCircle,
  addRectangle,
  resolveExtrudeSteps,
  addPartCopy,
  addPartCut,
  setPartPattern,
  cadSketchRegions,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  setCutDepth,
  type CadDocument,
  designSteps,
  rolledBackTo,
} from './index';
import { describe, expect, it } from 'vitest';

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

  it('flags the steps that need a part that is suppressed, deleted or only a sketch, and those built on them', () => {
    const base = createPlateDocument({ width: 300, height: 600, thickness: 18 }).parts[0]!;
    const boss = { ...createCadPart('Boss', 10), drawnOn: { on: { partId: base.id, face: 'top' as const }, offset: 0 } };
    const knob = { ...createCadPart('Knob', 5), drawnOn: { on: { partId: boss.id, face: 'top' as const }, offset: 0 } };
    const flagged = (document: CadDocument) =>
      designSteps(document)
        .filter(step => step.broken)
        .map(step => [step.label, step.broken]);
    const document: CadDocument = { ...createCadDocument(), parts: [base, boss, knob] };
    expect(flagged(document)).toEqual([]);
    expect(flagged({ ...document, parts: [{ ...base, suppressed: true }, boss, knob] })).toEqual([
      ['Sketch · Boss', `It’s drawn on a face of ${base.name}, which is suppressed.`],
      ['Extrude · Boss', `It’s drawn on a face of ${base.name}, which is suppressed.`],
      ['Sketch · Knob', 'It’s drawn on a face of Boss, which can’t be built.'],
      ['Extrude · Knob', 'It’s drawn on a face of Boss, which can’t be built.'],
    ]);
    expect(flagged({ ...document, parts: [{ ...base, extrude: false }, boss] })[0]).toEqual([
      'Sketch · Boss',
      `It’s drawn on a face of ${base.name}, which isn’t extruded.`,
    ]);
    expect(flagged({ ...document, parts: [boss] })[0]).toEqual(['Sketch · Boss', 'It’s drawn on a face of a deleted part.']);
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

  it('rolls the design back to a step: later parts, cuts, copies, patterns and cut-parts steps are gone', () => {
    let document = createPlateDocument({ width: 300, height: 600, thickness: 18 });
    const side = document.parts[0]!;
    side.sketch = addCircle(side.sketch, { x: 150, y: 300, radius: 20 });
    const hole = cadSketchRegions(side, side.sketch.id).find(region => region.curveIds.length === 1)!;
    document = setCutDepth(document, side.id, side.sketch.id, hole.id, 6);
    document = addPartCopy(document, side.id, { mirrored: true }).document;
    const shelf = { ...createCadPart('Shelf', 18), id: 'shelf' };
    document = { ...document, parts: [...document.parts, shelf] };
    document = setPartPattern(document, shelf.id, { axis: 'z', count: 3, spacing: 200 });
    document = addPartCut(document, [shelf.id], [side.id], { value: 0.2 }).document;

    const atExtrude = rolledBackTo(document, `${side.id}:extrude`);
    expect(atExtrude.parts.map(part => part.id)).toEqual([side.id]);
    expect(atExtrude.parts[0]!.features ?? []).toEqual([]);
    expect(atExtrude.parts[0]!.copies).toBeUndefined();
    expect(atExtrude.partCuts).toBeUndefined();

    const atPattern = rolledBackTo(document, document.parts[1]!.pattern!.id);
    expect(atPattern.parts[1]!.copies).toHaveLength(2);
    expect(atPattern.parts[0]!.copies).toHaveLength(1);
    expect(atPattern.partCuts).toBeUndefined();
    // The last step shows everything.
    expect(rolledBackTo(document, document.partCuts![0]!.id)).toBe(document);
  });

  it('lists an extrude of a shared sketch without a sketch of its own, and a Remove as an extrude rather than as the board’s cut', () => {
    const board = { ...createPlateDocument({ width: 200, height: 100, thickness: 18 }).parts[0]!, id: 'board', name: 'Board' };
    const pocket = { ...createCadPart('Pocket', 18), id: 'pocket', drawnOn: { on: { partId: 'board', face: 'top' as const }, offset: 0 } };
    pocket.sketch = addRectangle(pocket.sketch, { x: 50, y: 30, width: 40, height: 20 });
    const again = { ...createCadPart('Plug', 12), id: 'plug', sketchOf: 'pocket', regions: [] };
    const document = resolveExtrudeSteps({
      ...createPlateDocument({ width: 1, height: 1 }),
      parts: [board, { ...pocket, remove: { depth: 6 } }, again],
    });
    expect(designSteps(document).map(step => [step.kind, step.label, step.detail])).toEqual([
      ['sketch', 'Sketch · Board', undefined],
      ['extrude', 'Extrude · Board', '18 mm'],
      ['sketch', 'Sketch · Pocket', undefined],
      ['extrude', 'Extrude · Pocket', 'remove 6 mm'],
      ['extrude', 'Extrude · Plug', '12 mm'],
    ]);
    // Rolled back before the Remove, the board isn't cut; at it, it is, and the later extrude is gone.
    expect(rolledBackTo(document, 'board:extrude').parts.map(part => part.features ?? [])).toEqual([[]]);
    const atRemove = rolledBackTo(document, 'pocket:extrude');
    expect(atRemove.parts.map(part => part.id)).toEqual(['board', 'pocket']);
    expect(atRemove.parts[0]!.features).toHaveLength(2);
  });
});

it('leaves a part only its sketch when the design is rolled back to before its extrude', () => {
  const part = { ...createPlateDocument({ width: 100, height: 50 }).parts[0]!, name: 'Plate' };
  const document: CadDocument = { ...createCadDocument(), parts: [part] };
  expect(rolledBackTo(document, `${part.id}:sketch`).parts[0]!.extrude).toBe(false);
  expect(rolledBackTo(document, `${part.id}:extrude`).parts[0]!.extrude).toBeUndefined();
});
