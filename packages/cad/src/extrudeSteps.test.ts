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
  designSteps,
  extrudeGroup,
  extrudeLeadId,
  rolledBackTo,
  isJoinedBody,
  isCadPart,
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

  it('steps the part down over regions it adds less far, and is a joined body when it ends beyond the part', () => {
    const { owner, narrow } = splitDesign();
    const lower = resolveExtrudeSteps(design(owner, second(owner, [narrow], { addTo: owner.id, thickness: 10 })));
    expect(lower.parts[0]!.addedRegions).toEqual([narrow]);
    expect(cadCuts(lower.parts[0]!)).toMatchObject([{ sketchId: owner.sketch.id, regionId: narrow, depth: 8, removedBy: 'second' }]);
    const [shelf] = evaluateCadDocument(lower).parts;
    expect([area(shelf!.outline), shelf!.thickness]).toEqual([5000, 18]);
    expect(isJoinedBody(lower, lower.parts[1]!)).toBe(false);
    // Just as far, its regions are the part's own; further, it can't be a step down.
    const level = resolveExtrudeSteps(design(owner, second(owner, [narrow], { addTo: owner.id, thickness: 18 })));
    expect(cadCuts(level.parts[0]!)).toEqual([]);
    const higher = resolveExtrudeSteps(design(owner, second(owner, [narrow], { addTo: owner.id, thickness: 25 })));
    expect(higher.parts[0]!.addedRegions).toBeUndefined();
    expect(isJoinedBody(higher, higher.parts[1]!)).toBe(true);
  });

  it('leaves the part’s own regions, steps a region several Adds take to the highest, and folds a level or flipped Add', () => {
    const { owner, wide, narrow } = splitDesign();
    const add = (id: string, regions: string[], extra: Partial<CadPart>) => ({
      ...second(owner, regions, { addTo: owner.id, ...extra }),
      id,
    });
    const own = resolveExtrudeSteps(design(owner, add('a', [wide, narrow], { thickness: 10 })));
    expect(cadCuts(own.parts[0]!)).toMatchObject([{ regionId: narrow, depth: 8 }]);
    const two = resolveExtrudeSteps(design(owner, add('a', [narrow], { thickness: 10 }), add('b', [narrow], { thickness: 14 })));
    expect(cadCuts(two.parts[0]!)).toMatchObject([{ regionId: narrow, depth: 4, removedBy: 'b' }]);
    const level = resolveExtrudeSteps(design(owner, add('a', [narrow], { thickness: 10 }), add('b', [narrow], { thickness: 18 })));
    expect(cadCuts(level.parts[0]!)).toEqual([]);
    // Typed rather than following the variable, or a hair apart, the same depth folds.
    const typed = { ...owner, thicknessExpression: 'board' };
    const near = resolveExtrudeSteps(design(typed, add('a', [narrow], { thickness: 17.99 })));
    expect([near.parts[0]!.addedRegions, cadCuts(near.parts[0]!)]).toEqual([[narrow], []]);
    // Into the plane, a lower Add can't be cut from the part's top, so it's a body of its own.
    const inward = { ...owner, drawnOn: { ...owner.drawnOn!, inward: true } };
    const flipped = resolveExtrudeSteps(design(inward, add('a', [narrow], { thickness: 10, drawnOn: inward.drawnOn })));
    expect(isJoinedBody(flipped, flipped.parts[1]!)).toBe(true);
  });

  it('says why when it can’t add', () => {
    const { owner, narrow } = splitDesign();
    const other = { ...createCadPart('Other', 18), id: 'other' };
    // Added to a part of another sketch, it's joined as a body of its own: only its own profile can stop it.
    expect(extrudeStepProblem(design(owner, other), second(owner, [narrow], { addTo: 'other' }))).not.toMatch(/joins regions/);
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

  it('cuts again at each instance of its linear feature pattern, along the board, and not when suppressed', () => {
    const { board, pocket } = onBoard(sketch => addCircle(sketch, { x: 20, y: 20, radius: 5 }));
    const pattern = { id: 'p1', axis: 'x' as const, vector: [1, 0, 0] as [number, number, number], count: 3, spacing: 30 };
    const document = resolveExtrudeSteps(design(board, { ...pocket, remove: { depth: 5 }, pattern }));
    const evaluated = evaluateCadDocument(document);
    expect(evaluated.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    const [cut] = cadPartsToCut(document, evaluated.parts);
    const centres = cut!.part.cuts!.map(c => Math.round(c.outline.reduce((sum, p) => sum + p.x, 0) / c.outline.length));
    expect([cut!.part.cuts!.map(c => c.to), centres]).toEqual([
      [5, 5, 5],
      [20, 50, 80],
    ]);
    expect(document.parts.map(part => part.copies?.length ?? 0)).toEqual([0, 0]);
    const off = resolveExtrudeSteps(design(document.parts[0]!, { ...document.parts[1]!, pattern: { ...pattern, suppressed: true } }));
    expect(cadCuts(off.parts[0]!)).toHaveLength(1);
  });

  it('repeats a dado running off the board, along +x on the underside too, and skips an instance off the board', () => {
    const pattern = (count: number) => ({
      id: 'p1',
      axis: 'x' as const,
      vector: [1, 0, 0] as [number, number, number],
      count,
      spacing: 30,
    });
    const centres = (document: CadDocument) => {
      const evaluated = evaluateCadDocument(document);
      expect(evaluated.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
      const [board] = cadPartsToCut(document, evaluated.parts);
      return board!.part.cuts!.map(cut =>
        Math.round((Math.min(...cut.outline.map(p => p.x)) + Math.max(...cut.outline.map(p => p.x))) / 2)
      );
    };
    const dado = onBoard(sketch => addRectangle(sketch, { x: 20, y: -10, width: 10, height: 120 }));
    const found = removalRegions(design(dado.board, { ...dado.pocket, remove: { depth: 5 } }), { ...dado.pocket, remove: { depth: 5 } });
    if ('error' in found) throw new Error(found.error);
    const groove = found.regions.find(
      region => Math.min(...region.points.map(p => p.x)) > 19 && Math.max(...region.points.map(p => p.x)) < 31
    )!;
    const grooves = { ...dado.pocket, regions: [groove.id], remove: { depth: 5 }, pattern: pattern(3) };
    expect(centres(resolveExtrudeSteps(design(dado.board, grooves)))).toEqual([25, 55, 85]);
    // An underside sketch's x runs the other way, so x = -100 is 100 along the board.
    const below = onBoard(sketch => addCircle(sketch, { x: -100, y: 50, radius: 5 }), 'underside');
    const flipped = centres(resolveExtrudeSteps(design(below.board, { ...below.pocket, remove: { depth: 5 }, pattern: pattern(2) })));
    expect(flipped.map(Math.abs).sort((a, b) => a - b)).toEqual([100, 130]);
    const edge = onBoard(sketch => addCircle(sketch, { x: 150, y: 50, radius: 5 }));
    expect(centres(resolveExtrudeSteps(design(edge.board, { ...edge.pocket, remove: { depth: 5 }, pattern: pattern(3) })))).toEqual([
      150, 180,
    ]);
  });

  it('lays a feature pattern out as a grid with a second direction, leaving out skipped instances', () => {
    const { board, pocket } = onBoard(sketch => addCircle(sketch, { x: 20, y: 20, radius: 5 }));
    const pattern = {
      id: 'p1',
      axis: 'x' as const,
      vector: [1, 0, 0] as [number, number, number],
      count: 3,
      spacing: 30,
      second: { vector: [0, 1, 0] as [number, number, number], count: 2, spacing: 12 },
      skipped: [[2, 1]] as [number, number][],
    };
    const document = resolveExtrudeSteps(design(board, { ...pocket, remove: { depth: 5 }, pattern }));
    const evaluated = evaluateCadDocument(document);
    const [cut] = cadPartsToCut(document, evaluated.parts);
    const centre = (outline: { x: number; y: number }[]) =>
      [outline.reduce((sum, p) => sum + p.x, 0) / outline.length, outline.reduce((sum, p) => sum + p.y, 0) / outline.length].map(
        Math.round
      );
    expect(cut!.part.cuts!.map(c => centre(c.outline)).sort((a, b) => a[1]! - b[1]! || a[0]! - b[0]!)).toEqual([
      [20, 20],
      [50, 20],
      [80, 20],
      [20, 32],
      [50, 32],
    ]);
  });

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
    expect(extrudeStepProblem(design(board, onPlane), onPlane)).toMatch(/Draw a closed shape/);
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

  /** Four circles apart, extruded together by one New extrude. */
  function fourPosts() {
    const sketch = [0, 1, 2, 3].reduce(
      (at, index) => addCircle(at, { x: (index % 2) * 100, y: Math.floor(index / 2) * 100, radius: 10 }),
      createCadPart('Posts', 25).sketch
    );
    const owner: CadPart = {
      ...createCadPart('Posts', 25),
      id: 'posts',
      sketch,
      drawnOn: { on: { plane: 'top' }, offset: 0 },
      extrude: false,
    };
    const regions = sketchRegions(sketch, CAD_CHORD_TOLERANCE).map(region => region.id);
    const post: CadPart = { ...owner, id: 'post', name: 'Post', sketchOf: owner.id, regions };
    delete post.extrude;
    let index = 0;
    const split = splitApartRegions({ ...createCadDocument(), parts: [owner, post] }, post.id, () => `post-${++index}`);
    return { split, owner, post, regions };
  }

  it('is one feature making a part of each, listed once, which its parts follow', () => {
    const { split, post } = fourPosts();
    const made = split.parts.filter(part => part.sketchOf === 'posts');
    expect(made.map(part => part.id)).toEqual(['post', 'post-1', 'post-2', 'post-3']);
    expect(made.slice(1).every(part => part.extrudedWith === post.id)).toBe(true);
    expect(extrudeGroup(split, post.id)).toHaveLength(4);
    expect(extrudeLeadId(split, 'post-2')).toBe(post.id);
    const extrudes = designSteps(split).filter(step => step.kind === 'extrude');
    expect(extrudes.map(step => [step.label, step.detail])).toEqual([['Extrude · Post', '25 mm · 4 parts']]);
    // Made thicker, flipped or suppressed, every part it made follows.
    const edited = resolveExtrudeSteps({
      ...split,
      parts: split.parts.map(part =>
        part.id === post.id
          ? { ...part, thickness: 40, thicknessExpression: '4 cm', suppressed: true as const, drawnOn: { ...part.drawnOn!, inward: true } }
          : part
      ),
    });
    for (const part of extrudeGroup(edited, post.id))
      expect(part).toMatchObject({ thickness: 40, thicknessExpression: '4 cm', suppressed: true, drawnOn: { inward: true } });
  });

  it('keeps its parts when rolled back to it, and leaves them extrudes of their own once it is gone', () => {
    const { split, post } = fourPosts();
    const steps = designSteps(split);
    const at = steps.find(step => step.id === `${post.id}:extrude`)!;
    expect(rolledBackTo(split, at.id).parts.filter(part => part.sketchOf === 'posts' && part.extrude !== false)).toHaveLength(4);
    const alone = resolveExtrudeSteps({ ...split, parts: split.parts.filter(part => part.id !== post.id) });
    expect(alone.parts.some(part => part.extrudedWith)).toBe(false);
    expect(designSteps(alone).filter(step => step.kind === 'extrude')).toHaveLength(3);
  });

  it('puts its parts in its folder, beside it', () => {
    const { owner, post } = fourPosts();
    const document: CadDocument = {
      ...createCadDocument(),
      parts: [owner, post],
      folders: [{ id: 'f', name: 'Posts', partIds: [post.id] }],
    };
    let index = 0;
    const split = splitApartRegions(document, post.id, () => `post-${++index}`);
    expect(split.folders![0]!.partIds).toEqual(['post', 'post-1', 'post-2', 'post-3']);
  });

  it('adds or cuts every region its parts had once it is an Add or a Remove, and makes them again made New', () => {
    const { split, post, regions } = fourPosts();
    for (const change of [{ addTo: 'posts' }, { remove: { depth: 5 } }] as Partial<CadPart>[]) {
      const resolved = resolveExtrudeSteps({
        ...split,
        parts: split.parts.map(part => (part.id === post.id ? { ...part, ...change } : part)),
      });
      expect(resolved.parts.map(part => part.id)).toEqual(['posts', 'post']);
      expect(new Set(resolved.parts[1]!.regions)).toEqual(new Set(regions));
      expect(designSteps(resolved).filter(step => step.kind === 'extrude')).toHaveLength(1);
      const backToNew = { ...resolved.parts[1]! };
      delete backToNew.addTo;
      delete backToNew.remove;
      const again = splitApartRegions({ ...resolved, parts: [resolved.parts[0]!, backToNew] }, post.id);
      expect(again.parts.filter(part => part.extrudedWith === post.id)).toHaveLength(3);
      expect(designSteps(again).filter(step => step.kind === 'extrude')).toHaveLength(1);
    }
  });
});

describe('Extrude → Add of another sketch', () => {
  it('is a body joined to the part it adds to: built and made, not a part of its own', () => {
    const block = { ...createPlateDocument({ width: 100, height: 100, thickness: 18 }).parts[0]!, name: 'Block' };
    block.drawnOn = { on: { plane: 'top' as const }, offset: 0 };
    const boss = { ...createCadPart('Boss', 10), drawnOn: { on: { partId: block.id, face: 'top' as const }, offset: 0 }, addTo: block.id };
    boss.sketch = addCircle(boss.sketch, { x: 50, y: 50, radius: 10 });
    const document = { ...createCadDocument(), parts: [block, boss] };
    expect(isJoinedBody(document, boss)).toBe(true);
    expect(isCadPart(boss)).toBe(false);
    const evaluated = evaluateCadDocument(document);
    expect(evaluated.parts.map(part => part.partId)).toEqual([block.id, boss.id]);
    expect(cadPartsToCut(document, evaluated.parts).map(entry => entry.part.name)).toEqual(['Block', 'Boss']);
  });
});
