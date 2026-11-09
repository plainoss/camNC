import { describe, expect, it } from 'vitest';
import {
  addCircle,
  addLine,
  addRectangle,
  CAD_CHORD_TOLERANCE,
  cadCuts,
  cadFaceSketches,
  cadPartsToCut,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  evaluateCadDocument,
  extrudeStepProblem,
  newExtrudeOf,
  parseCadDocument,
  polygonArea,
  removalRegions,
  resolveExtrudeSteps,
  sketchRegions,
  splitApartRegions,
  evaluateCadPart,
  solveCadDocument,
  validateCadDocument,
  type CadDocument,
  type CadDimension,
  type CadPart,
} from './index';

const area = (points: { x: number; y: number }[]) => Math.abs(polygonArea(points));

/** A 100 × 50 rectangle split by a line across it at x = 30, on the top plane, with a width dimension. */
function splitDesign() {
  const part = createPlateDocument({ width: 100, height: 50, thickness: 18 }).parts[0]!;
  const sketch = addLine(part.sketch, { x1: 30, y1: 0, x2: 30, y2: 50 });
  const owner: CadPart = { ...part, id: 'shelf', name: 'Shelf', sketch, drawnOn: { on: { plane: 'top' }, offset: 0 } };
  const regions = sketchRegions(sketch, CAD_CHORD_TOLERANCE);
  const wide = regions.find(region => Math.abs(area(region.points) - 3500) < 1)!.id;
  const narrow = regions.find(region => Math.abs(area(region.points) - 1500) < 1)!.id;
  return { owner: { ...owner, regions: [wide] }, wide, narrow };
}
const design = (...parts: CadPart[]): CadDocument => ({ ...createCadDocument(), parts });
const second = (owner: CadPart, regions: string[], extra: Partial<CadPart> = {}): CadPart => ({
  ...createCadPart('Part 2', 12),
  id: 'second',
  sketchOf: owner.id,
  regions,
  ...extra,
});

describe('a part extruding another part’s sketch', () => {
  it('takes that sketch and its plane, so its own regions make a second part', () => {
    const { owner, narrow } = splitDesign();
    const document = resolveExtrudeSteps(design(owner, second(owner, [narrow])));
    const copy = document.parts[1]!;
    expect(copy.sketch).toBe(owner.sketch);
    expect(copy.drawnOn?.on).toEqual({ plane: 'top' });
    expect(validateCadDocument(document).filter(d => d.severity === 'error')).toEqual([]);
    const evaluated = evaluateCadDocument(document);
    expect(evaluated.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    expect(evaluated.parts.map(part => [part.name, area(part.outline), part.thickness])).toEqual([
      ['Shelf', 3500, 18],
      ['Part 2', 1500, 12],
    ]);
    // Saved and loaded, the copy's IDs are the sketch's own and don't clash.
    expect(parseCadDocument(JSON.parse(JSON.stringify(document))).parts[1]!.sketchOf).toBe('shelf');
  });

  it('follows edits to the sketch, as solved', async () => {
    const { owner, narrow } = splitDesign();
    const edited = structuredClone(design(owner, second(owner, [narrow])));
    const width = edited.parts[0]!.sketch.constraints.find((c): c is CadDimension => 'value' in c && c.label === 'Width')!;
    width.value = 120;
    const solved = await solveCadDocument(edited);
    expect(solved.status).toBe('solved');
    expect(solved.document.parts[1]!.sketch).toEqual(solved.document.parts[0]!.sketch);
    expect(solved.parts.map(part => Math.round(area(part.outline)))).toEqual([90 * 50, 1500]);
  });

  it('owns the sketch once the part it came from is gone', () => {
    const { owner, narrow } = splitDesign();
    const third = { ...second(owner, [narrow]), id: 'third', name: 'Part 3' };
    const document = resolveExtrudeSteps(design(second(owner, [narrow]), third));
    expect(document.parts[0]!.sketchOf).toBeUndefined();
    expect(document.parts[1]!.sketchOf).toBe('second');
    expect(document.parts[1]!.sketch).toBe(document.parts[0]!.sketch);
  });

  it('starts with the regions its sketch’s extrudes don’t use yet, or none when they use it all', () => {
    const { owner, narrow } = splitDesign();
    const made = newExtrudeOf(design(owner), owner, 'Part 2');
    expect(made).toMatchObject({ sketchOf: 'shelf', regions: [narrow], thickness: 18, drawnOn: { on: { plane: 'top' } } });
    expect(newExtrudeOf(design(owner, made), made, 'Part 3')).toMatchObject({ sketchOf: 'shelf', regions: [] });
    const whole: CadPart = { ...owner };
    delete whole.regions;
    expect(newExtrudeOf(design(whole), whole, 'Part 2').regions).toEqual([]);
  });

  it('asks for regions while it has none picked', () => {
    const { owner } = splitDesign();
    const document = resolveExtrudeSteps(design(owner, second(owner, [])));
    expect(evaluateCadDocument(document).diagnostics.find(d => d.partId === 'second')?.code).toBe('region-count');
  });
});

describe('Extrude → Add', () => {
  it('joins its regions to the part made from the same sketch, and isn’t a part itself', () => {
    const { owner, narrow } = splitDesign();
    const document = resolveExtrudeSteps(design(owner, second(owner, [narrow], { addTo: owner.id })));
    expect(document.parts[0]!.addedRegions).toEqual([narrow]);
    expect(extrudeStepProblem(document, document.parts[1]!)).toBeNull();
    const evaluated = evaluateCadDocument(document);
    expect(cadPartsToCut(document, evaluated.parts).map(entry => [entry.part.name, area(entry.part.outline)])).toEqual([['Shelf', 5000]]);
    // Taken away, the part is as it was.
    expect(resolveExtrudeSteps(design(document.parts[0]!)).parts[0]!.addedRegions).toBeUndefined();
  });

  it('says why when it can’t add', () => {
    const { owner, narrow } = splitDesign();
    const other = { ...createCadPart('Other', 18), id: 'other' };
    expect(extrudeStepProblem(design(owner, other), second(owner, [narrow], { addTo: 'other' }))).toBe(
      'Add joins regions of the sketch Other is made from.'
    );
    expect(extrudeStepProblem(design(owner), second(owner, [], { addTo: owner.id }))).toBe('Pick the regions to add in the view.');
    expect(extrudeStepProblem(design(owner), second(owner, [narrow], { addTo: 'gone' }))).toMatch(/gone/);
  });
});

describe('the regions of a part', () => {
  it('join into one when they touch, and are refused when they don’t', () => {
    const { owner, wide, narrow } = splitDesign();
    expect(area(evaluateCadDocument(design({ ...owner, regions: [wide, narrow] })).parts[0]!.outline)).toBeCloseTo(5000, 3);
    let sketch = addRectangle(createCadPart().sketch, { x: 0, y: 0, width: 10, height: 10 });
    sketch = addRectangle(sketch, { x: 20, y: 0, width: 10, height: 10 });
    const apart = sketchRegions(sketch, CAD_CHORD_TOLERANCE).map(region => region.id);
    expect(evaluateCadDocument(design({ ...createCadPart(), sketch, regions: apart })).diagnostics[0]!.code).toBe('region-count');
  });
});

describe('Extrude → Remove', () => {
  function onBoard(draw: (sketch: CadPart['sketch']) => CadPart['sketch'], face: 'top' | 'underside' = 'top') {
    const board = { ...createPlateDocument({ width: 200, height: 100, thickness: 18 }).parts[0]!, id: 'board', name: 'Board' };
    const pocket: CadPart = { ...createCadPart('Pocket', 18), id: 'pocket', drawnOn: { on: { partId: board.id, face }, offset: 0 } };
    pocket.sketch = draw(pocket.sketch);
    return { board, pocket };
  }

  it('cuts a shape drawn on a board’s top into it, keeping the sketch as its own step', () => {
    const { board, pocket } = onBoard(sketch => addRectangle(sketch, { x: 50, y: 30, width: 40, height: 20 }));
    const document = resolveExtrudeSteps(design(board, { ...pocket, remove: { depth: 6 } }));
    expect(document.parts.map(part => part.name)).toEqual(['Board', 'Pocket']);
    const cut = document.parts[0]!;
    expect(cadFaceSketches(cut).map(face => [face.on, face.removedBy])).toEqual([['top', 'pocket']]);
    expect(cadCuts(cut).map(feature => feature.depth)).toEqual([6]);
    const evaluated = evaluateCadDocument(document);
    expect(evaluated.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    expect(cadPartsToCut(document, evaluated.parts).map(entry => [entry.part.name, entry.part.cuts?.length])).toEqual([['Board', 1]]);
    expect(parseCadDocument(JSON.parse(JSON.stringify(document))).parts[0]!.features).toHaveLength(2);
    // A deeper cut follows, and with the step gone so is the cut.
    const deeper = resolveExtrudeSteps({ ...document, parts: [document.parts[0]!, { ...document.parts[1]!, remove: { depth: 9 } }] });
    expect(cadCuts(deeper.parts[0]!).map(feature => feature.depth)).toEqual([9]);
    expect(resolveExtrudeSteps({ ...document, parts: [document.parts[0]!] }).parts[0]!.features).toBeUndefined();
    // Nor does a sketch whose extrude is gone cut anything, even with its Remove settings left on it.
    const unextruded = resolveExtrudeSteps({ ...document, parts: [document.parts[0]!, { ...document.parts[1]!, extrude: false }] });
    expect(unextruded.parts[0]!.features).toBeUndefined();
  });

  it('cuts only the regions picked, when they are', () => {
    const { board, pocket } = onBoard(sketch => {
      const next = addRectangle(sketch, { x: 20, y: 20, width: 20, height: 20 });
      return addRectangle(next, { x: 100, y: 20, width: 30, height: 30 });
    });
    const found = removalRegions(design(board, pocket), pocket);
    if ('error' in found) throw new Error(found.error);
    expect(found.cut).toHaveLength(2);
    const larger = found.regions.find(region => Math.abs(area(region.points) - 900) < 1)!.id;
    const document = resolveExtrudeSteps(design(board, { ...pocket, regions: [larger], remove: { depth: 'through' } }));
    expect(cadCuts(document.parts[0]!).map(feature => feature.regionId)).toEqual([larger]);
  });

  it('cuts a notch against the edge as a pocket, and refuses cutting it through or too deep', () => {
    const { board, pocket } = onBoard(sketch => {
      let next = addLine(sketch, { x1: 0, y1: 40, x2: 30, y2: 40 });
      next = addLine(next, { x1: 30, y1: 40, x2: 30, y2: 60 });
      return addLine(next, { x1: 30, y1: 60, x2: 0, y2: 60 });
    });
    const step = (remove: CadPart['remove']) => ({ ...pocket, remove });
    expect(extrudeStepProblem(design(board, step({ depth: 6 })), step({ depth: 6 }))).toBeNull();
    expect(extrudeStepProblem(design(board, step({ depth: 'through' })), step({ depth: 'through' }))).toBe(
      'A through cut can’t reach the part’s edge. Change the profile instead, or use a separate part.'
    );
    expect(extrudeStepProblem(design(board, step({ depth: 30 })), step({ depth: 30 }))).not.toBeNull();
  });

  it('says why when it can’t cut', () => {
    const { board, pocket } = onBoard(sketch => addLine(sketch, { x1: 50, y1: 30, x2: 90, y2: 30 }));
    expect(extrudeStepProblem(design(board, pocket), { ...pocket, remove: { depth: 5 } })).toBe(
      'Draw a closed shape on the face to cut it out.'
    );
    const onPlane = { ...pocket, drawnOn: { on: { plane: 'top' as const }, offset: 0 }, remove: { depth: 5 } };
    expect(extrudeStepProblem(design(board, onPlane), onPlane)).toMatch(/top or underside of a board/);
  });

  it('follows a depth typed with a variable', async () => {
    const { board, pocket } = onBoard(sketch => addRectangle(sketch, { x: 50, y: 30, width: 40, height: 20 }));
    const document = {
      ...design(board, { ...pocket, remove: { depth: 5, depthExpression: 'pocket' } }),
      variables: [{ id: 'v', name: 'pocket', expression: '7 mm' }],
    };
    const solved = await solveCadDocument(document);
    expect(solved.status).toBe('solved');
    expect(cadCuts(solved.document.parts[0]!).map(cut => [cut.depth, cut.depthExpression])).toEqual([[7, 'pocket']]);
  });
});

describe('a New extrude of regions apart', () => {
  it('makes a part of each group of regions that touch, of the same sketch and as thick', () => {
    const part = { ...createCadPart('Arm', 25), drawnOn: { on: { plane: 'top' as const }, offset: 0 } };
    part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 80, height: 40 });
    part.sketch = addCircle(part.sketch, { x: 150, y: 20, radius: 20 });
    const regions = sketchRegions(part.sketch, CAD_CHORD_TOLERANCE).map(region => region.id);
    const split = splitApartRegions({ ...createCadDocument(), parts: [{ ...part, regions }] }, part.id);
    expect(split.parts).toHaveLength(2);
    expect(split.parts[1]).toMatchObject({ sketchOf: part.id, thickness: 25, drawnOn: part.drawnOn });
    expect(split.parts.map(made => made.regions!.length)).toEqual([1, 1]);
    expect(split.parts.every(made => evaluateCadPart(made).part)).toBe(true);
  });
});
