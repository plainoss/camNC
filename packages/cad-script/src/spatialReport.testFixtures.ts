import {
  addCopyFaceSketch,
  addCopyTransform,
  addPartCut,
  addRectangle,
  cadPartReference,
  cadSketchRegions,
  createCadPart,
  createPlateDocument,
  polygonArea,
  setCutDepth,
  setPartPattern,
  updatePartCut,
} from '@wbcnc/cad';

/** Independently authored stock, own hole and crossing tools. None of the numeric expectations reads evaluated bounds. */
export function spatialReportFixture() {
  let source = createPlateDocument({ name: 'Ordered panel', width: 100, height: 60, thickness: 18 });
  const partId = source.parts[0]!.id;
  source.parts[0]!.name = 'Panel';
  source.parts[0]!.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  source.parts[0]!.drawnOn = { on: { plane: 'top' }, offset: 0 };
  source = setPartPattern(source, partId, { count: 3, axis: 'x', spacing: 200 });
  const copyId = source.parts[0]!.copies![1]!.id,
    reference = cadPartReference(partId, copyId);
  const face = addCopyFaceSketch(source, partId, copyId, 'top');
  source = face.document;
  const part = source.parts[0]!,
    sketch = part.features!.find(feature => feature.type === 'sketch' && feature.sketch.id === face.sketchId)!;
  if (sketch.type !== 'sketch') throw Error('Missing own face sketch');
  sketch.sketch = addRectangle(sketch.sketch, { x: 60, y: 5, width: 10, height: 10, dimensioned: true, positioned: true });
  const region = cadSketchRegions(part, face.sketchId).find(region => Math.abs(Math.abs(polygonArea(region.points)) - 100) < 1e-8)!;
  source = setCutDepth(source, partId, face.sketchId, region.id, 'through');
  const stock = (name: string, x: number, y: number, width: number, height: number) => {
    const part = createCadPart(name, 18);
    part.sketch = addRectangle(part.sketch, { x, y, width, height, dimensioned: true, positioned: true });
    part.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    part.drawnOn = { on: { plane: 'top' }, offset: 0 };
    return part;
  };
  const a = stock('Knife A', 400, 0, 10, 20),
    b = stock('Knife B', 530, 0, 10, 20),
    receiver = stock('Receiver', 395, -5, 20, 30);
  source.parts.push(a, b, receiver);
  const first = addPartCut(source, [a.id], [reference], { value: 0 });
  const move = addCopyTransform(first.document, partId, copyId, { by: [100, 0, 0] });
  const second = addPartCut(move.document, [b.id], [reference], { value: 0 });
  const consume = addPartCut(second.document, [a.id], [receiver.id], { value: 0 });
  source = updatePartCut(consume.document, consume.id, { consumeTools: true });
  return {
    source,
    partId,
    copyId,
    reference,
    first: first.id,
    move: move.id,
    second: second.id,
    consume: consume.id,
    toolA: a.id,
    toolB: b.id,
  };
}
