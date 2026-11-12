import {
  addCopyTransform,
  addPartCut,
  addRectangle,
  cadPartReference,
  copyOperationPrefix,
  createCadPart,
  parseCadDocument,
  setCopyOperationOrder,
  solveCadDocument,
} from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { inspectCadDocument } from './inspect';
import { loadWoodworkingSource, sourcePart, sourceVariable } from './iteration/woodworkingChecks';

it('reports a complete cabinet with one independently notched and moved shelf through saved prefixes and restored slots', async () => {
  let source = sourceVariable(await loadWoodworkingSource('task-start-cupboard-three-shelves'), 'shelves', '3');
  const tool = (name: string, x: number, y: number) => {
    const part = createCadPart(name, 1000);
    part.sketch = addRectangle(part.sketch, { x, y, width: 20, height: 40, dimensioned: true, positioned: true });
    part.drawnOn = { on: { plane: 'top' }, offset: 0 };
    return part;
  };
  const earlier = tool('Earlier knife', 100, -10),
    later = tool('Later knife', 150, 390);
  source = { ...source, parts: [...source.parts, earlier, later] };
  const generation = await solveCadDocument(source);
  expect(generation.status, JSON.stringify(generation.diagnostics)).toBe('solved');
  const family = sourcePart(generation.document, 'Shelf'),
    copyId = family.copies![1]!.id,
    reference = cadPartReference(family.id, copyId);
  const move = addCopyTransform(generation.document, family.id, copyId, { by: [0, 400, 0] });
  const first = addPartCut(move.document, [earlier.id], [reference], { value: 0 });
  const second = addPartCut(first.document, [later.id], [reference], { value: 0 });
  const legacy = generation.document.partCuts!.map(cut => cut.id);
  source = setCopyOperationOrder(second.document, [...legacy, first.id, move.id, second.id]);
  const bytes = JSON.stringify(source),
    savedMove = structuredClone(source.copyTransforms),
    order = source.operationOrder;
  const inspected = await inspectCadDocument(parseCadDocument(JSON.parse(bytes)), new Map(), { toolpaths: false });
  // The retained construction knife deliberately crosses the untouched pieces; these are real reported clashes.
  expect(inspected.report.errors.map(issue => issue.code)).toEqual(Array(4).fill('parts-collide'));
  expect(inspected.report.assembly!.collisions.map(collision => [...collision.parts].sort()).sort()).toEqual(
    ['Bottom', 'Top', 'Shelf', 'Shelf 2'].map(name => [name, 'Earlier knife'].sort()).sort()
  );
  const spatial = inspected.report.spatial!,
    selected = spatial.physical.find(body => body.id === reference)!;
  // Authored recipe: width800, stock18, depth300; each independent edge notch is20×30×18.
  expect(selected.placement!.position).toEqual([0, 400, (3 * (900 - 18)) / 4]);
  [19, 400, 661.5].forEach((value, axis) => expect(selected.bounds!.at[axis]).toBeCloseTo(value, 6));
  [762, 284, 18].forEach((value, axis) => expect(selected.bounds!.size[axis]).toBeCloseTo(value, 6));
  expect(selected.cam && 'volume' in selected.cam ? selected.cam.volume : selected.cam).toBeCloseTo(762 * 284 * 18 - 2 * 20 * 30 * 18, 5);
  for (const name of ['Shelf', 'Shelf 2']) {
    const sibling = spatial.physical.find(body => body.name === name)!;
    expect(sibling.cam && 'volume' in sibling.cam ? sibling.cam.volume : sibling.cam).toBeCloseTo(762 * 284 * 18, 5);
  }
  expect(spatial.camGroups.flatMap(group => group.names).sort()).toEqual(
    ['Side', 'Right side', 'Bottom', 'Top', 'Back', 'Shelf', 'Shelf 2', 'Shelf 3', 'Earlier knife', 'Later knife'].sort()
  );
  const beforeMove = await inspectCadDocument(copyOperationPrefix(inspected.document, first.id), new Map(), { toolpaths: false });
  const historical = beforeMove.report.spatial!.physical.find(body => body.id === reference)!;
  expect(historical.placement!.position).toEqual([0, 0, 661.5]);
  expect(historical.cam && 'volume' in historical.cam ? historical.cam.volume : historical.cam).toBeCloseTo(
    762 * 284 * 18 - 20 * 30 * 18,
    5
  );
  expect(historical.cutIds.some(id => id.startsWith(`cut-parts:${second.id}:`))).toBe(false);
  const missing = await inspectCadDocument(sourceVariable(inspected.document, 'shelves', '2'), new Map(), { toolpaths: false });
  expect(missing.report.spatial!.physical.some(body => body.id === reference)).toBe(false);
  expect(missing.report.warnings).toContainEqual(expect.objectContaining({ code: 'copy-transform-target-missing' }));
  const restored = await inspectCadDocument(sourceVariable(missing.document, 'shelves', '3'), new Map(), { toolpaths: false });
  const reload = await inspectCadDocument(parseCadDocument(JSON.parse(JSON.stringify(restored.document))), new Map(), { toolpaths: false });
  expect(reload.report.spatial!.physical.find(body => body.id === reference)).toEqual(selected);
  expect(reload.document.copyTransforms).toEqual(savedMove);
  expect(reload.document.operationOrder).toEqual(order);
  expect(sourcePart(reload.document, 'Shelf').copies![1]!.placement!.position).toEqual([0, 0, 661.5]);
  expect(JSON.stringify(source)).toBe(bytes);
});
