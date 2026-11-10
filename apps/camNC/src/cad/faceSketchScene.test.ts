import { addRectangle, cadSketchRegions, createPlateDocument, setCutDepth } from '@wbcnc/cad';
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
