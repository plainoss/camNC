import { describe, expect, it } from 'vitest';
import {
  addCircle,
  addCopyFaceSketch,
  cadSketchRegions,
  createPlateDocument,
  setCopyCutDepth,
  setCutDepth,
  setPartPattern,
} from '@wbcnc/cad';
import { assemblyModel } from './assemblyModel';

describe('copy-specific assembly geometry', () => {
  it('meshes only the chosen shelf with its cable hole while siblings share the uncut shape', () => {
    let document = createPlateDocument({ width: 300, height: 200, thickness: 18 });
    const id = document.parts[0]!.id;
    document.parts[0]!.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    document = setPartPattern(document, id, { axis: 'z', count: 3, spacing: 100 });
    const copyId = document.parts[0]!.copies![0]!.id;
    const made = addCopyFaceSketch(document, id, copyId, 'top');
    document = made.document;
    const face = document.parts[0]!.features![0]!;
    if (face.type !== 'sketch') throw new Error('No face sketch');
    face.sketch = addCircle(face.sketch, { x: 150, y: 100, radius: 10 });
    const region = cadSketchRegions(document.parts[0]!, face.sketch.id).find(region =>
      region.points.every(point => Math.abs(point.x - 150) < 20)
    )!;
    document = setCutDepth(document, id, face.sketch.id, region.id, 'through');
    const model = assemblyModel(document);
    expect(model.problems).toEqual([]);
    expect(model.meshes).toHaveLength(3);
    expect(model.meshes[0]!.positions.length).toBe(model.meshes[2]!.positions.length);
    expect(model.meshes[1]!.positions.length).toBeGreaterThan(model.meshes[0]!.positions.length);
    expect(model.parts.map(part => part.shape!.holes.length)).toEqual([0, 1]);
    expect(model.instances.map(instance => instance.copyId)).toEqual([undefined, copyId, document.parts[0]!.copies![1]!.id]);
  });
  it('meshes a filled profile hole only on the addressed copy even when both have no explicit cuts', () => {
    let document = createPlateDocument({ width: 300, height: 200, thickness: 18 });
    const part = document.parts[0]!;
    part.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    part.sketch = addCircle(part.sketch, { x: 150, y: 100, radius: 10 });
    document = setPartPattern(document, part.id, { axis: 'z', count: 2, spacing: 100 });
    const region = cadSketchRegions(document.parts[0]!, part.sketch.id).find(region => region.curveIds.length === 1)!;
    document = setCopyCutDepth(document, part.id, document.parts[0]!.copies![0]!.id, part.sketch.id, region.id, 0);
    const model = assemblyModel(document);
    expect(model.problems).toEqual([]);
    expect(model.parts.map(part => part.shape!.holes.length)).toEqual([1, 0]);
    expect(model.meshes[1]!.positions.length).toBeLessThan(model.meshes[0]!.positions.length);
  });
});
