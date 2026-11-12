import { expect, it } from 'vitest';
import {
  addCopyTransform,
  addPartCut,
  addRectangle,
  cadPartsToCut,
  createCadPart,
  createPlateDocument,
  evaluateCadDocument,
  evaluatedPartCopy,
  parseCadDocument,
  physicalCadView,
  placePoint,
  polygonArea,
  setPartPattern,
  solveCadDocument,
  updatePartCut,
  type CadDocument,
} from './index';
import cabinet from '../../cad-script/fixtures/designs/cupboard.json';

function fixture(mirrored = false) {
  let source = createPlateDocument({ width: 300, height: 200, thickness: 18 });
  const parent = source.parts[0]!;
  parent.name = 'Panel';
  parent.placement = { position: [100, 200, 0], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] };
  parent.copies = [
    {
      id: 'panel-copy',
      name: 'Panel copy',
      mirrored,
      placement: { position: [500, 600, 10], rotation: [0, 0, -Math.SQRT1_2, Math.SQRT1_2] },
    },
  ];
  const child = createCadPart('Boss', 6);
  child.sketch = addRectangle(child.sketch, { x: 0, y: 0, width: 20, height: 10 });
  child.addTo = parent.id;
  child.placement = { position: [-40, 260, 18], rotation: [0, 0, 1, 0] };
  source.parts.push(child);
  const move = addCopyTransform(source, parent.id, 'panel-copy', {
    by: [100, -50, 7],
    turn: { about: [0, 0, 0], axis: [0, 0, 1], degrees: 90 },
  });
  source = move.document;
  return { source, parentId: parent.id, childId: child.id, moveId: move.id };
}

const body = (document: CadDocument, id: string) => document.parts.find(part => part.id === id)!;
const closeVector = (actual: readonly number[], expected: readonly number[]) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 8));
};

it.each([false, true])('projects a joined child with its moved parent copy and actual reflection, mirrored=%s', mirrored => {
  const f = fixture(mirrored),
    bytes = JSON.stringify(f.source);
  const evaluation = evaluateCadDocument(f.source),
    view = physicalCadView(f.source, evaluation);
  expect(evaluation.diagnostics).toEqual([]);
  const child = body(view.document, f.childId),
    inherited = child.copies?.find(copy => copy.id === 'panel-copy');
  expect(inherited).toBeDefined();
  expect(inherited!.name).toBe('Boss · Panel copy');
  expect(!!inherited!.mirrored).toBe(mirrored);
  // The child's creation frame relative to its parent is T(60,140,18) Rz(90).
  // The moved parent frame is T(-500,450,17). Reflection conjugates that relative frame.
  closeVector(inherited!.placement!.position, mirrored ? [-560, 590, 35] : [-440, 590, 35]);
  closeVector(placePoint(inherited!.placement, [mirrored ? -2 : 2, 3, 6]), mirrored ? [-557, 592, 41] : [-443, 592, 41]);
  const groups = cadPartsToCut(view.document, view.parts);
  expect(groups.flatMap(group => group.names).sort()).toEqual(['Boss', 'Boss · Panel copy', 'Panel', 'Panel copy']);
  const material = view.parts.find(part => part.partId === f.childId)!;
  closeVector(
    evaluatedPartCopy(material, inherited!)
      .outline.map(point => point.x)
      .sort((a, b) => a - b),
    mirrored ? [-20, -20, 0, 0] : [0, 0, 20, 20]
  );
  expect(body(f.source, f.childId).copies).toBeUndefined();
  expect(JSON.stringify(f.source)).toBe(bytes);
  const reloaded = parseCadDocument(JSON.parse(bytes));
  expect(physicalCadView(reloaded, evaluateCadDocument(reloaded))).toEqual(view);
  expect(() => addCopyTransform(f.source, f.childId, 'panel-copy', { by: [1, 0, 0] })).toThrow(/not available/);
});

it('keeps an unplaced parent copy and its joined material in machining quantity without inventing a pose', () => {
  const f = fixture();
  const parent = body(f.source, f.parentId);
  const source = {
    ...f.source,
    parts: f.source.parts.map(part =>
      part.id === parent.id ? { ...part, copies: [...part.copies!, { id: 'unplaced-copy', name: 'Loose copy' }] } : part
    ),
  };
  const bytes = JSON.stringify(source),
    view = physicalCadView(source, evaluateCadDocument(source));
  const inherited = body(view.document, f.childId).copies!.find(copy => copy.id === 'unplaced-copy')!;
  expect(inherited).toEqual({ id: 'unplaced-copy', name: 'Boss · Loose copy' });
  expect(
    cadPartsToCut(view.document, view.parts)
      .flatMap(group => group.names)
      .sort()
  ).toEqual(['Boss', 'Boss · Loose copy', 'Boss · Panel copy', 'Loose copy', 'Panel', 'Panel copy']);
  expect(JSON.stringify(source)).toBe(bytes);
});

it('inverts the actual cached host basis without normalizing saved source rotations', () => {
  const f = fixture(true),
    q = 0.707106781;
  body(f.source, f.parentId).placement!.rotation = [0, 0, q, q];
  const bytes = JSON.stringify(f.source),
    view = physicalCadView(f.source, evaluateCadDocument(f.source));
  const r = 1 - 2 * q * q,
    s = 2 * q * q,
    determinant = r * r + s * s;
  const localX = (-140 * r + 60 * s) / determinant,
    localY = (140 * s + 60 * r) / determinant;
  const inherited = body(view.document, f.childId).copies![0]!;
  closeVector(inherited.placement!.position, [-500 - localX, 450 + localY, 35]);
  expect(Math.hypot(...inherited.placement!.rotation)).toBeCloseTo(1, 14);
  expect(JSON.stringify(f.source)).toBe(bytes);
});

it('keeps logical parent and child names when an earlier pattern copy is suppressed', () => {
  const f = fixture();
  let source: CadDocument = {
    ...f.source,
    copyTransforms: [],
    operationOrder: [],
    parts: f.source.parts.map(part => (part.id === f.parentId ? { ...part, copies: [] } : part)),
  };
  source = setPartPattern(source, f.parentId, { count: 4, axis: 'x', spacing: 400 });
  const first = body(source, f.parentId).copies![0]!.id;
  source = {
    ...source,
    parts: source.parts.map(part =>
      part.id === f.parentId
        ? { ...part, copies: part.copies!.map(copy => (copy.id === first ? { ...copy, suppressed: true as const } : copy)) }
        : part
    ),
  };
  const bytes = JSON.stringify(source),
    view = physicalCadView(source, evaluateCadDocument(source));
  expect(body(view.document, f.parentId).copies!.map(copy => copy.name)).toEqual(['Panel 3', 'Panel 4']);
  expect(body(view.document, f.childId).copies!.map(copy => copy.name)).toEqual(['Boss · Panel 3', 'Boss · Panel 4']);
  expect(
    cadPartsToCut(view.document, view.parts)
      .flatMap(group => group.names)
      .sort()
  ).toEqual(['Boss', 'Boss · Panel 3', 'Boss · Panel 4', 'Panel', 'Panel 3', 'Panel 4']);
  expect(JSON.stringify(source)).toBe(bytes);
});

it('retains a derived child instance ID through parent pattern count removal and restoration', () => {
  const f = fixture();
  let source: CadDocument = { ...f.source, copyTransforms: [], operationOrder: [] };
  source = setPartPattern(source, f.parentId, { count: 3, axis: 'x', spacing: 400 });
  const copyId = body(source, f.parentId).copies!.find(copy => copy.pattern && copy.id.endsWith(':2'))!.id;
  source = addCopyTransform(source, f.parentId, copyId, { by: [0, 50, 0] }).document;
  const operations = JSON.stringify(source.copyTransforms);
  const inspect = (document: CadDocument) => physicalCadView(document, evaluateCadDocument(document));
  const original = inspect(source),
    originalCopy = body(original.document, f.childId).copies!.find(copy => copy.id === copyId)!;
  expect(originalCopy).toBeDefined();
  const pattern = body(source, f.parentId).pattern!;
  const smaller = setPartPattern(source, f.parentId, { ...pattern, count: 2 });
  expect(body(inspect(smaller).document, f.childId).copies?.some(copy => copy.id === copyId)).toBe(false);
  expect(JSON.stringify(smaller.copyTransforms)).toBe(operations);
  const restored = parseCadDocument(JSON.parse(JSON.stringify(setPartPattern(smaller, f.parentId, { ...pattern, count: 3 }))));
  expect(body(inspect(restored).document, f.childId).copies!.find(copy => copy.id === copyId)).toEqual(originalCopy);
  expect(JSON.stringify(restored.copyTransforms)).toBe(operations);
});

it('omits all joined material and inherited copies when a later operation consumes the parent family', () => {
  const f = fixture();
  const receiver = createCadPart('Receiver', 18);
  receiver.sketch = addRectangle(receiver.sketch, { x: 0, y: 0, width: 20, height: 20 });
  receiver.placement = { position: [90, 190, 0], rotation: [0, 0, 0, 1] };
  const source = { ...f.source, parts: [...f.source.parts, receiver] };
  const cut = addPartCut(source, [f.parentId], [receiver.id], { value: 0 });
  const consumed = updatePartCut(cut.document, cut.id, { consumeTools: true });
  const before = physicalCadView(consumed, evaluateCadDocument(consumed, { through: f.moveId }));
  expect(body(before.document, f.childId).copies).toHaveLength(1);
  const result = evaluateCadDocument(consumed),
    after = physicalCadView(consumed, result);
  expect(result.diagnostics).toEqual([]);
  expect(result.available).not.toContain(f.childId);
  expect(after.document.parts.some(part => part.id === f.parentId || part.id === f.childId)).toBe(false);
  expect(after.parts.some(part => part.partId === f.parentId || part.partId === f.childId)).toBe(false);
  expect(cadPartsToCut(after.document, after.parts).flatMap(group => group.names)).toEqual(['Receiver']);
  expect(body(consumed, f.childId).addTo).toBe(f.parentId);
});

it('keeps a complete cabinet and both joined side cleats through a copy move, stock/width edits and reload', async () => {
  let source = parseCadDocument(structuredClone(cabinet));
  const side = source.parts.find(part => part.name === 'Side')!;
  const rightId = side.copies![0]!.id;
  const cleat = createCadPart('Side cleat', 6);
  cleat.sketch = addRectangle(cleat.sketch, { x: 20, y: 30, width: 80, height: 20 });
  cleat.drawnOn = { on: { partId: side.id, face: 'top' }, offset: 0 };
  cleat.addTo = side.id;
  source = { ...source, parts: [...source.parts, cleat] };
  const first = await solveCadDocument(source);
  expect(first.status).toBe('solved');
  const move = addCopyTransform(first.document, side.id, rightId, { by: [40, 10, 0] });
  source = move.document;
  const ids = source.parts.map(part => [part.id, part.sketch.id]);
  for (const [width, stock] of [
    [600, 18],
    [750, 21],
  ] as const) {
    source = {
      ...source,
      variables: source.variables!.map(variable =>
        variable.name === 'width'
          ? { ...variable, expression: `${width}mm` }
          : variable.name === 'board'
            ? { ...variable, expression: `${stock}mm` }
            : variable
      ),
    };
    const solved = await solveCadDocument(source);
    expect(solved.status).toBe('solved');
    source = solved.document;
    const bytes = JSON.stringify(source),
      view = physicalCadView(source, solved);
    expect(source.parts.map(part => [part.id, part.sketch.id])).toEqual(ids);
    expect(source.operationOrder!.at(-1)).toBe(move.id);
    expect(body(source, cleat.id).copies).toBeUndefined();
    const left = body(view.document, cleat.id),
      right = left.copies!.find(copy => copy.id === rightId)!;
    const material = view.parts.find(part => part.partId === cleat.id)!;
    expect(Math.abs(polygonArea(material.outline)) * material.thickness).toBe(80 * 20 * 6);
    closeVector(left.placement!.position, [stock, 0, 0]);
    closeVector(right.placement!.position, [width - stock + 40, 10, 0]);
    closeVector(placePoint(right.placement, [-20, 30, 6]), [width - stock + 34, 30, 30]);
    expect(
      cadPartsToCut(view.document, view.parts)
        .flatMap(group => group.names)
        .sort()
    ).toEqual(['Back', 'Bottom', 'Right side', 'Shelf', 'Side', 'Side cleat', 'Side cleat · Right side', 'Top']);
    const loaded = parseCadDocument(JSON.parse(bytes)),
      again = await solveCadDocument(loaded);
    expect(again.status).toBe('solved');
    expect(physicalCadView(again.document, again)).toEqual(view);
    expect(JSON.stringify(source)).toBe(bytes);
  }
});
