import { addLine, addPartCut, addRectangle, createCadPart, createPlateDocument, setPartPattern, type CadSeedTransform } from './index';

/** Independent100×60×18 stock minus a10×20 through-notch, then three copies at0/200/400. */
export function notchedSeedSource() {
  let source = createPlateDocument({ name: 'Notched pattern', width: 100, height: 60, thickness: 18 });
  const part = source.parts[0]!;
  part.name = 'Panel';
  part.sketch = createCadPart().sketch;
  const outline = [
    [10, 0],
    [100, 0],
    [100, 60],
    [0, 60],
    [0, 20],
    [10, 20],
  ];
  for (const [index, a] of outline.entries()) {
    const b = outline[(index + 1) % outline.length]!;
    part.sketch = addLine(part.sketch, { x1: a[0]!, y1: a[1]!, x2: b[0]!, y2: b[1]! });
  }
  part.sketch.entities = part.sketch.entities.map(entity => (entity.type === 'point' ? { ...entity, fixed: true } : entity));
  part.drawnOn = { on: { plane: 'top' }, offset: 0 };
  part.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  source = setPartPattern(source, part.id, { count: 3, axis: 'x', spacing: 200 });
  const child = createCadPart('Boss', 6);
  child.addTo = part.id;
  child.sketch = addRectangle(child.sketch, { x: 0, y: 0, width: 10, height: 8, dimensioned: true, positioned: true });
  child.placement = { position: [20, 30, 18], rotation: [0, 0, 0, 1] };
  const dependent = createCadPart('Earlier face body', 3);
  dependent.drawnOn = { on: { partId: part.id, face: 'top' }, offset: 0 };
  dependent.placement = { position: [0, 0, 18], rotation: [0, 0, 0, 1] };
  dependent.sketch = addRectangle(dependent.sketch, { x: 30, y: 40, width: 12, height: 6, dimensioned: true, positioned: true });
  const knife = createCadPart('Later knife', 18);
  knife.sketch = addRectangle(knife.sketch, { x: 50, y: 25, width: 10, height: 5, dimensioned: true, positioned: true });
  knife.drawnOn = { on: { plane: 'top' }, offset: 0 };
  knife.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  source = { ...source, parts: [...source.parts, child, dependent, knife] };
  const cut = addPartCut(source, [knife.id], [part.id], { value: 0 });
  const move: CadSeedTransform = { id: 'move-original', partId: part.id, seed: true, by: [0, 25, 0] };
  // This is the explicit saved-source contract, independent of a creation command implementation.
  source = { ...cut.document, version: 4, copyTransforms: [move], operationOrder: [move.id, cut.id] };
  return { source, partId: part.id, childId: child.id, dependentId: dependent.id, knifeId: knife.id, moveId: move.id, cutId: cut.id };
}
