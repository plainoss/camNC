import { describe, expect, it } from 'vitest';
import {
  addCircle,
  addConstraint,
  cadCuts,
  evaluateCadDocument,
  polygonArea,
  setCutDepth,
  sketchRegions,
  applyCadVariables,
  cadVariableProblems,
  cadVariableUses,
  resolvePartPatterns,
  cadVariableValues,
  createCadDocument,
  createPlateDocument,
  evaluateCadPart,
  parseCadDocument,
  parseCadValue,
  removeCadVariable,
  setCadVariable,
  solveCadDocument,
  type CadDimension,
  type CadDocument,
  type CadPart,
} from './index';

const variable = (document: CadDocument, name: string, expression: string, id?: string) => {
  const result = setCadVariable(document, { id, name, expression });
  if ('error' in result) throw new Error(result.error);
  return result.document;
};
const dimension = (part: CadPart, label: string) =>
  part.sketch.constraints.find((c): c is CadDimension => c.label === label && 'value' in c)!;
/** A plate whose width dimension is written as `width`. */
function plate(name: string, width: string): CadPart {
  const part = createPlateDocument({ name, width: 200, height: 100 }).parts[0]!;
  part.name = name;
  const size = dimension(part, 'Width');
  size.expression = width;
  return part;
}
const span = (part: CadPart) => {
  const xs = evaluateCadPart(part).part!.outline.map(point => point.x);
  return Math.max(...xs) - Math.min(...xs);
};

describe('expressions with variables', () => {
  const scope = {
    width: { value: 600, kind: 'length' },
    board: { value: 18, kind: 'length' },
    count: { value: 3, kind: 'number' },
  } as const;

  it('works out lengths from variables, with or without a leading #', () => {
    expect(parseCadValue('width - 2*board', { variables: scope })).toEqual({ value: 564, expression: 'width - 2*board' });
    expect(parseCadValue('#width/2', { variables: scope })).toEqual({ value: 300, expression: '#width/2' });
    expect(parseCadValue('count * 10', { variables: scope })).toEqual({ value: 30, expression: 'count * 10' });
    expect(parseCadValue('width/count', { variables: scope })).toMatchObject({ value: 200 });
  });

  it('explains names it doesn’t know and numbers written against a name', () => {
    expect(parseCadValue('depth + 2mm', { variables: scope })).toEqual({ error: 'There’s no variable called depth.'.replace('’', "'") });
    expect(parseCadValue('2width', { variables: scope })).toEqual({ error: 'Put * between the number and width.' });
    expect(parseCadValue('width mm', { variables: scope })).toEqual({ error: 'This value already has a unit.' });
    expect(parseCadValue('width', { unit: 'deg', variables: scope })).toMatchObject({ error: expect.stringContaining('angle') });
  });

  it('reads a plain number added to a variable in the field’s own unit, but not one added to a typed unit', () => {
    expect(parseCadValue('width + 10', { variables: scope })).toEqual({ value: 610, expression: 'width + 10' });
    expect(parseCadValue('10 + width - 2*board', { variables: scope })).toMatchObject({ value: 574 });
    expect(parseCadValue('width/2 - 3', { variables: scope })).toMatchObject({ value: 297 });
    expect(parseCadValue('2 + 1in + width', { variables: scope })).toHaveProperty('error');
    expect(parseCadValue('count + 1', { variables: scope })).toMatchObject({ value: 4 });
  });
});

describe('design variables', () => {
  it('works out each kind from its value, and variables that use other variables', () => {
    let document = variable(createCadDocument(), 'board', '18mm');
    document = variable(document, 'count', '4');
    document = variable(document, 'width', '0.6m');
    document = variable(document, 'inner', 'width - 2*board');
    document = variable(document, 'tilt', '5deg');
    expect(cadVariableValues(document)).toEqual({
      scope: {
        board: { value: 18, kind: 'length' },
        count: { value: 4, kind: 'number' },
        width: { value: 600, kind: 'length' },
        inner: { value: 564, kind: 'length' },
        tilt: { value: 5, kind: 'angle' },
      },
      errors: {},
    });
  });

  it('refuses names that are units or taken, unknown names and loops', () => {
    const document = variable(variable(createCadDocument(), 'a', '10mm'), 'b', 'a * 2');
    const a = document.variables![0]!.id;
    expect(setCadVariable(document, { name: 'in', expression: '1' })).toEqual({ error: "in is a unit, so it can't be a variable name." });
    expect(setCadVariable(document, { name: '2nd', expression: '1' })).toMatchObject({ error: expect.stringContaining('letter') });
    expect(setCadVariable(document, { name: 'b', expression: '1' })).toEqual({ error: "There's already a variable called b." });
    expect(setCadVariable(document, { name: 'c', expression: 'd + 1mm' })).toEqual({ error: "There's no variable called d." });
    expect(setCadVariable(document, { id: a, name: 'a', expression: 'b / 2' })).toMatchObject({
      error: expect.stringContaining('refers back'),
    });
  });

  it('follows depth variables beyond 300 mm and preserves them across save and reload', () => {
    let document = createPlateDocument({ width: 200, height: 100, thickness: 18 });
    document.parts[0]!.thicknessExpression = 'depth';
    document = variable(document, 'depth', '2000mm');
    expect(cadVariableProblems(document)).toEqual([]);
    expect(document.parts[0]!.thickness).toBe(2000);
    document = variable(document, 'depth', '3m', document.variables![0]!.id);
    expect(document.parts[0]!.thickness).toBe(3000);
    const restored = parseCadDocument(JSON.parse(JSON.stringify(document)));
    expect(restored?.parts[0]!.thickness).toBe(3000);
    expect(restored?.parts[0]!.thicknessExpression).toBe('depth');
  });

  it('updates every part that uses a variable, and its thickness', async () => {
    let document: CadDocument = { ...createCadDocument(), parts: [plate('Left side', 'width'), plate('Shelf', 'width - 2*board')] };
    document.parts[1]!.thicknessExpression = 'board';
    document = variable(document, 'board', '18mm');
    document = variable(document, 'width', '600mm');
    expect(dimension(document.parts[0]!, 'Width').value).toBe(600);
    expect(dimension(document.parts[1]!, 'Width').value).toBe(564);
    expect(document.parts[1]!.thickness).toBe(18);
    const board = document.variables!.find(v => v.name === 'board')!.id;
    document = variable(document, 'board', '19mm', board);
    expect(document.parts[1]!.thickness).toBe(19);
    const solved = await solveCadDocument(document);
    expect(solved.sketches.map(sketch => sketch.status)).toEqual(['solved', 'solved']);
    expect(span(solved.document.parts[0]!)).toBeCloseTo(600, 6);
    expect(span(solved.document.parts[1]!)).toBeCloseTo(562, 6);
  });

  it('keeps the last good value of a part that can’t follow, and says why on that part', async () => {
    let document: CadDocument = { ...createCadDocument(), parts: [plate('Side', 'width'), plate('Shelf', 'width - 2*board')] };
    document = variable(document, 'board', '18mm');
    document = variable(document, 'width', '600mm');
    document = (await solveCadDocument(document)).document;
    document = variable(document, 'width', '30mm', document.variables!.find(v => v.name === 'width')!.id);
    const shelf = document.parts[1]!;
    expect(dimension(shelf, 'Width').value).toBe(564);
    expect(cadVariableProblems(document)).toEqual([
      {
        code: 'variable-value',
        severity: 'error',
        partId: shelf.id,
        constraintIds: [dimension(shelf, 'Width').id],
        message: 'width - 2*board: That would flip this line over. It needs to stay above zero.',
      },
    ]);
    const solved = await solveCadDocument(document);
    expect(span(solved.document.parts[0]!)).toBeCloseTo(30, 6);
    expect(span(solved.document.parts[1]!)).toBeCloseTo(564, 6);
  });

  it('leaves a part that can’t be solved at its last good shape, while the others follow', async () => {
    const stuck = plate('Stuck', 'width'),
      corners = dimension(stuck, 'Width') as CadDimension & { pointAId: string; pointBId: string };
    // A second, fixed width across the same corners can only agree with the variable at 200.
    stuck.sketch = addConstraint(stuck.sketch, {
      type: 'distanceX',
      pointAId: corners.pointAId,
      pointBId: corners.pointBId,
      value: 200,
    } as never);
    let document: CadDocument = { ...createCadDocument(), parts: [plate('Free', 'width'), stuck] };
    document = variable(document, 'width', '200mm');
    document = (await solveCadDocument(document)).document;
    document = variable(document, 'width', '250mm', document.variables![0]!.id);
    const solved = await solveCadDocument(document);
    expect(solved.sketches.map(sketch => sketch.status)).toEqual(['solved', 'conflict']);
    expect(span(solved.document.parts[0]!)).toBeCloseTo(250, 6);
    expect(span(solved.document.parts[1]!)).toBeCloseTo(200, 6);
  });

  it('renames through every expression, and won’t remove a variable that’s in use', () => {
    let document: CadDocument = { ...createCadDocument(), parts: [plate('Side', '#width - 1mm')] };
    document.parts[0]!.thicknessExpression = 'width / 30';
    document = variable(document, 'width', '600mm');
    document = variable(document, 'half', 'width/2');
    const id = document.variables![0]!.id;
    document = variable(document, 'carcass', '600mm', id);
    expect(document.variables!.map(v => v.expression)).toEqual(['600mm', 'carcass/2']);
    expect(document.parts[0]!.thicknessExpression).toBe('carcass / 30');
    expect(dimension(document.parts[0]!, 'Width').expression).toBe('#carcass - 1mm');
    expect(removeCadVariable(document, id)).toEqual({ error: 'carcass is used in 3 places. Change those first.' });
    const half = document.variables![1]!.id;
    const removed = removeCadVariable(document, half);
    expect('document' in removed && removed.document.variables!.map(v => v.name)).toEqual(['carcass']);
  });

  it('saves and reads back variables and thickness expressions', () => {
    let document: CadDocument = { ...createCadDocument(), parts: [plate('Side', 'width')] };
    document.parts[0]!.thicknessExpression = 'board';
    document = variable(variable(document, 'width', '600mm'), 'board', '18mm');
    expect(parseCadDocument(JSON.parse(JSON.stringify(document)))).toEqual(applyCadVariables(document));
    expect(() => parseCadDocument({ ...document, variables: [{ id: 'v', name: 'mm', expression: '1' }] })).toThrow('variable name');
  });

  it('moves a placed part whose position uses a variable, and renames carry into it', () => {
    let document: CadDocument = { ...createCadDocument(), parts: [plate('Right side', 'depth')] };
    document.parts[0]!.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1], positionExpressions: ['width - board', null, null] };
    document = variable(variable(variable(document, 'board', '18mm'), 'depth', '300mm'), 'width', '600mm');
    expect(document.parts[0]!.placement!.position).toEqual([582, 0, 0]);
    const width = document.variables!.find(v => v.name === 'width')!.id;
    document = variable(document, 'carcass', '800mm', width);
    expect(document.parts[0]!.placement).toMatchObject({ position: [782, 0, 0], positionExpressions: ['carcass - board', null, null] });
    expect(parseCadDocument(JSON.parse(JSON.stringify(document))).parts[0]!.placement).toEqual(document.parts[0]!.placement);
    const board = document.variables!.find(v => v.name === 'board')!.id;
    document = variable(document, 'board', '5deg', board);
    expect(document.parts[0]!.placement!.position).toEqual([782, 0, 0]);
    expect(cadVariableProblems(document).map(p => p.message)).toContain(
      'Position x carcass - board: Put units on each added value, or put the whole sum in parentheses before its unit.'
    );
  });

  it('follows, renames and round trips a copy distance expression, keeping its last valid distance on errors', () => {
    let document = variable(createPlateDocument({ width: 100, height: 50 }), 'gap', '30mm');
    const part = document.parts[0]!;
    part.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    part.copies = [{ id: 'copy', along: { along: { plane: 'front' }, distance: 30, distanceExpression: 'gap' } }];
    document = resolvePartPatterns(document);
    expect(document.parts[0]!.copies![0]!.offset!.position).toEqual([0, -30, 0]);
    expect(cadVariableUses(document, 'gap')).toBe(1);
    const id = document.variables![0]!.id;
    document = resolvePartPatterns(variable(document, 'gap', '40mm', id));
    expect(document.parts[0]!.copies![0]!.along!.distance).toBe(40);
    expect(document.parts[0]!.copies![0]!.offset!.position).toEqual([0, -40, 0]);
    document = variable(document, 'spacing', '40mm', id);
    expect(document.parts[0]!.copies![0]!.along!.distanceExpression).toBe('spacing');
    expect(cadVariableUses(document, 'gap')).toBe(0);
    expect(cadVariableUses(document, 'spacing')).toBe(1);
    expect(parseCadDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
    document = resolvePartPatterns(variable(document, 'spacing', '5deg', id));
    expect(document.parts[0]!.copies![0]!.along!.distance).toBe(40);
    expect(document.parts[0]!.copies![0]!.offset!.position).toEqual([0, -40, 0]);
    expect(cadVariableProblems(document)).toEqual([
      expect.objectContaining({
        code: 'variable-value',
        severity: 'error',
        partId: part.id,
        message: expect.stringContaining('Copy distance spacing:'),
      }),
    ]);
  });

  it('validates copy distances and their expressions when reading a document', () => {
    const document = createPlateDocument({ width: 100, height: 50 });
    const copy = { id: 'copy', along: { along: { plane: 'front' as const }, distance: 30, distanceExpression: 'gap' } };
    document.parts[0]!.copies = [copy];
    expect(parseCadDocument(JSON.parse(JSON.stringify(document))).parts[0]!.copies).toEqual([copy]);
    for (const invalid of [
      { ...copy.along, distanceExpression: 3 },
      { ...copy.along, distance: '30' },
      { ...copy.along, flip: 'yes' },
    ]) {
      const raw = JSON.parse(JSON.stringify(document));
      raw.parts[0].copies[0].along = invalid;
      expect(() => parseCadDocument(raw)).toThrow();
    }
  });

  it('cuts to a depth that uses a variable, and says when it can’t', () => {
    let document = createPlateDocument({ width: 200, height: 100, thickness: 18 });
    const part = document.parts[0]!;
    part.sketch = addCircle(part.sketch, { x: 100, y: 50, radius: 20 });
    const hole = sketchRegions(part.sketch).find(region => Math.abs(polygonArea(region.points)) < 2000)!;
    document = variable(document, 'housing', '6mm');
    document = setCutDepth(document, part.id, part.sketch.id, hole.id, 6, 'housing');
    const id = document.variables![0]!.id;
    document = variable(document, 'housing', '8mm', id);
    expect(cadCuts(document.parts[0]!)[0]).toMatchObject({ depth: 8, depthExpression: 'housing' });
    expect(evaluateCadDocument(document).parts[0]!.cuts![0]).toMatchObject({ to: 8 });
    document = variable(document, 'housing', '0mm', id);
    expect(cadCuts(document.parts[0]!)[0]!.depth).toBe(8);
    expect(cadVariableProblems(document).map(p => p.message)).toEqual(['Cut depth housing: A cut needs some depth.']);
    document = variable(document, 'housing', '-2mm', id);
    expect(cadCuts(document.parts[0]!)[0]!.depth).toBe(8);
    expect(cadVariableProblems(document).map(p => p.message)).toEqual(['Cut depth housing: A cut can’t be less than nothing deep.']);
    expect(parseCadDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
  });
});
