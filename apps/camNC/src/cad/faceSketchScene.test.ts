import { addRectangle, cadSketchRegions, createPlateDocument, setCopyCutDepth, setCutDepth, setPartPattern } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { faceSketchScene } from './faceSketchScene';

it('carries the actual underside and pocket-floor planes in local part coordinates', () => {
  const source = createPlateDocument({ width: 120, height: 80, thickness: 18 });
  const part = source.parts[0]!;
  part.drawnOn = { on: { plane: 'front' }, offset: 0 };
  const view = { cameraState: { current: null }, aspect: 2 };
  expect(faceSketchScene(source, part.id, 'underside', view)?.frame).toMatchObject({
    origin: [0, 0, 0],
    x: [-1, 0, 0],
    normal: [0, 0, -1],
  });
  part.sketch = addRectangle(part.sketch, { x: 20, y: 20, width: 40, height: 30 });
  const region = cadSketchRegions(part, part.sketch.id).find(region =>
    region.points.every(p => p.x >= 20 && p.x <= 60 && p.y >= 20 && p.y <= 50)
  )!;
  const cut = setCutDepth(source, part.id, part.sketch.id, region.id, 6);
  const feature = cut.parts[0]!.features!.find(feature => feature.type === 'cut')!;
  expect(faceSketchScene(cut, part.id, { floorOf: feature.id }, view)?.frame).toMatchObject({ origin: [0, 0, 12], normal: [0, 0, 1] });
});

it('uses the overridden pocket floor for one copy while saved shared floor references stay valid', () => {
  let document = createPlateDocument({ width: 120, height: 80, thickness: 18 });
  const part = document.parts[0]!;
  part.sketch = addRectangle(part.sketch, { x: 20, y: 20, width: 40, height: 30 });
  const region = cadSketchRegions(part, part.sketch.id).find(region =>
    region.points.every(point => point.x >= 20 && point.x <= 60 && point.y >= 20 && point.y <= 50)
  )!;
  document = setCutDepth(document, part.id, part.sketch.id, region.id, 6);
  const shared = document.parts[0]!.features!.find(feature => feature.type === 'cut')!;
  document = setPartPattern(document, part.id, { axis: 'z', count: 2, spacing: 100 });
  const copyId = document.parts[0]!.copies![0]!.id;
  document = setCopyCutDepth(document, part.id, copyId, part.sketch.id, region.id, 10);
  const own = document.parts[0]!.features!.find(feature => feature.type === 'cut' && feature.copyId === copyId)!;
  const view = { cameraState: { current: null }, aspect: 2 };
  expect(faceSketchScene(document, part.id, { floorOf: shared.id }, view)?.frame.origin).toEqual([0, 0, 12]);
  expect(faceSketchScene(document, part.id, { floorOf: shared.id }, view, copyId)?.frame.origin).toEqual([0, 0, 8]);
  expect(faceSketchScene(document, part.id, { floorOf: own.id }, view, copyId)?.frame.origin).toEqual([0, 0, 8]);
});
