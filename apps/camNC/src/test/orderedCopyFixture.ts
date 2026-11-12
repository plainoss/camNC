import {
  addCopyFaceSketch,
  addCopyTransform,
  addPartCopy,
  addPartCut,
  addRectangle,
  cadPartReference,
  cadSketchRegions,
  createCadPart,
  createPlateDocument,
  polygonArea,
  setCopyOperationOrder,
  setCutDepth,
  type CadDocument,
} from '@wbcnc/cad';

/** Portable source: one owned notch, Cut A, an exact-copy move, then Cut B at its new pose. */
export function orderedCopyFixture(mirrored = false) {
  let document = createPlateDocument({ width: 100, height: 60, thickness: 18 });
  const owner = document.parts[0]!;
  owner.name = 'Panel';
  owner.drawnOn = { on: { plane: 'top' }, offset: 0 };
  owner.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const selected = addPartCopy(document, owner.id, { mirrored, offset: { position: [200, 0, 0], rotation: [0, 0, 0, 1] } });
  const sibling = addPartCopy(selected.document, owner.id, { offset: { position: [400, 0, 0], rotation: [0, 0, 0, 1] } });
  const face = addCopyFaceSketch(sibling.document, owner.id, selected.id, 'top');
  document = face.document;
  const part = document.parts[0]!;
  const sketch = part.features!.find(feature => feature.type === 'sketch' && feature.sketch.id === face.sketchId)!;
  if (sketch.type !== 'sketch') throw Error('Missing own face sketch.');
  sketch.sketch = addRectangle(sketch.sketch, { x: 60, y: 5, width: 10, height: 10 });
  const region = cadSketchRegions(part, face.sketchId).find(candidate => Math.abs(Math.abs(polygonArea(candidate.points)) - 100) < 1e-8)!;
  document = setCutDepth(document, owner.id, face.sketchId, region.id, 'through');
  const tool = (name: string, x: number) => {
    const part = createCadPart(name, 18);
    part.sketch = addRectangle(part.sketch, { x, y: 0, width: 10, height: 20, dimensioned: true, positioned: true });
    part.drawnOn = { on: { plane: 'top' }, offset: 0 };
    part.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    return part;
  };
  const a = tool('Knife A', mirrored ? 190 : 200),
    b = tool('Knife B', mirrored ? 260 : 330);
  document = { ...document, parts: [...document.parts, a, b] };
  const move = addCopyTransform(document, owner.id, selected.id, { by: [100, 0, 0] });
  const reference = cadPartReference(owner.id, selected.id);
  const cutA = addPartCut(move.document, [a.id], [reference], { value: 0 });
  const cutB = addPartCut(cutA.document, [b.id], [reference], { value: 0 });
  return {
    document: setCopyOperationOrder(cutB.document, [cutA.id, move.id, cutB.id]),
    partId: owner.id,
    copyId: selected.id,
    siblingId: sibling.id,
    cutA: cutA.id,
    move: move.id,
    cutB: cutB.id,
  };
}

export function inheritedCopyFixture(mirrored = false): { document: CadDocument; partId: string; copyId: string; childId: string } {
  let document = createPlateDocument({ width: 100, height: 100, thickness: 18 });
  const parent = document.parts[0]!;
  parent.name = 'Base';
  parent.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const copy = addPartCopy(document, parent.id, { mirrored, offset: { position: [200, 0, 0], rotation: [0, 0, 0, 1] } });
  document = copy.document;
  const child = createCadPart('Boss', 10);
  child.sketch = addRectangle(child.sketch, { x: 0, y: 0, width: 20, height: 10 });
  child.addTo = parent.id;
  child.placement = { position: [40, 30, 18], rotation: [0, 0, 0, 1] };
  document = { ...document, parts: [...document.parts, child] };
  const move = addCopyTransform(document, parent.id, copy.id, { by: [140, 0, 0] });
  return { document: move.document, partId: parent.id, copyId: copy.id, childId: child.id };
}

/** Independent signed-tetrahedron integral of a closed rendered boundary. */
export function boundaryVolume(positions: ArrayLike<number>, indices: ArrayLike<number>) {
  const origin = [positions[0]!, positions[1]!, positions[2]!];
  // A common translation leaves a closed boundary's integral unchanged and avoids cancellation far from the origin.
  const at = (index: number, axis: number) => positions[3 * indices[index]! + axis]! - origin[axis]!;
  let sum = 0;
  for (let i = 0; i < indices.length; i += 3) {
    sum +=
      at(i, 0) * (at(i + 1, 1) * at(i + 2, 2) - at(i + 1, 2) * at(i + 2, 1)) +
      at(i, 1) * (at(i + 1, 2) * at(i + 2, 0) - at(i + 1, 0) * at(i + 2, 2)) +
      at(i, 2) * (at(i + 1, 0) * at(i + 2, 1) - at(i + 1, 1) * at(i + 2, 0));
  }
  return Math.abs(sum / 6);
}
