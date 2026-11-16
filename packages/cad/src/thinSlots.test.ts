import { expect, it } from 'vitest';
import {
  addLine,
  cadCuts,
  cadPartsToCut,
  evaluateCadDocument,
  cadFaceSketches,
  cadSketchRegions,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  parseCadDocument,
  resolveExtrudeSteps,
  type CadPart,
} from './index';

it('cuts a slot along each picked line of a thin Remove, centred with Mid plane, edge to edge of the board', () => {
  const board = { ...createPlateDocument({ width: 150, height: 70, thickness: 20 }).parts[0]!, id: 'board', name: 'Part 1' };
  let sketch = createCadPart('Sketch 2', 20).sketch;
  for (const x of [12, 52, 92, 132]) sketch = addLine(sketch, { x1: x, y1: 0, x2: x, y2: 70 });
  const lines = sketch.entities.filter(entity => entity.type === 'line').map(entity => entity.id);
  const slots: CadPart = {
    ...createCadPart('Part 2', 20),
    id: 'slots',
    sketch,
    drawnOn: { on: { partId: board.id, face: 'top' }, offset: 0 },
    remove: { depth: 25 },
    thinWall: { thickness1: 5, thickness2: 0, midPlane: true },
    thinEdges: lines,
  };
  const document = resolveExtrudeSteps({ ...createCadDocument(), parts: [board, slots] });
  // The board gets a through cut for each slot, its outline the line widened 2.5 either side.
  const board2 = document.parts.find(part => part.id === board.id)!;
  const cuts = cadCuts(board2);
  expect(cuts.map(cut => cut.depth)).toEqual(['through', 'through', 'through', 'through']);
  const faces = cadFaceSketches(board2);
  const regions = cadSketchRegions(board2, faces[0]!.sketch.id);
  const spans = cuts.map(cut => {
    const points = regions.find(region => region.id === cut.regionId)!.points;
    return [Math.min(...points.map(p => p.x)), Math.max(...points.map(p => p.x))].map(v => Math.round(v * 10) / 10);
  });
  expect(spans.sort((x, y) => x[0]! - y[0]!)).toEqual([
    [9.5, 14.5],
    [49.5, 54.5],
    [89.5, 94.5],
    [129.5, 134.5],
  ]);
  // Saved and read again, the lines it walls are checked to be lines of its sketch.
  expect(() => parseCadDocument(JSON.parse(JSON.stringify({ ...document, parts: [board, { ...slots, thinEdges: ['nope'] }] })))).toThrow();
});

it('splits a board its slots run across into five parts, the board keeping the first piece', () => {
  const board = { ...createPlateDocument({ width: 150, height: 70, thickness: 20 }).parts[0]!, id: 'board', name: 'Part 1' };
  let sketch = createCadPart('Sketch 2', 20).sketch;
  for (const x of [12, 52, 92, 132]) sketch = addLine(sketch, { x1: x, y1: 0, x2: x, y2: 70 });
  const slots: CadPart = {
    ...createCadPart('Part 2', 20),
    id: 'slots',
    sketch,
    drawnOn: { on: { partId: board.id, face: 'top' }, offset: 0 },
    remove: { depth: 25 },
    thinWall: { thickness1: 5, thickness2: 0, midPlane: true },
    thinEdges: sketch.entities.filter(entity => entity.type === 'line').map(entity => entity.id),
  };
  const document = resolveExtrudeSteps({ ...createCadDocument(), version: 7, parts: [board, slots] });
  const evaluated = evaluateCadDocument(document);
  expect(
    evaluated.diagnostics.filter(d => d.severity === 'error').map(d => [d.partId, d.message, (d as { entityIds?: string[] }).entityIds])
  ).toEqual([]);
  const made = cadPartsToCut(document, evaluated.parts).map(({ part }) => {
    const xs = part.outline.map(p => p.x);
    return [part.name, Math.round(Math.min(...xs) * 10) / 10, Math.round(Math.max(...xs) * 10) / 10, part.thickness];
  });
  expect(made.sort((a, b) => (a[1] as number) - (b[1] as number))).toEqual([
    ['Part 1', 0, 9.5, 20],
    ['Part 2', 14.5, 49.5, 20],
    ['Part 3', 54.5, 89.5, 20],
    ['Part 4', 94.5, 129.5, 20],
    ['Part 5', 134.5, 150, 20],
  ]);
  // Resolved again, the pieces are the same parts, not more of them.
  expect(resolveExtrudeSteps(document).parts.map(part => part.id)).toEqual(document.parts.map(part => part.id));
});
