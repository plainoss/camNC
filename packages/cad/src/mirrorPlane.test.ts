import { expect, it } from 'vitest';
import { createPlateDocument } from './document';
import { partFaceAt } from './drawnOn';
import { cadMirrorPlaneFrame } from './mirrorPlane';

it('reads the x-normal face of a rotated mirrored copy and never falls back when that copy is missing', () => {
  const document = createPlateDocument({ width: 100, height: 60, thickness: 18 });
  const part = document.parts[0]!;
  part.placement = { position: [30, 0, 0], rotation: [0, 0, 0, 1] };
  part.copies = [{ id: 'copy', mirrored: true, placement: { position: [500, 20, 30], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] } }];
  const right = part.sketch.entities.find(
    entity =>
      entity.type === 'line' &&
      part.sketch.entities.some(point => point.type === 'point' && point.id === entity.startId && point.x === 100 && point.y === 0)
  )!;
  const mirror = { across: { partId: `${part.id}:copy`, face: { edge: right.id } } };
  const frame = cadMirrorPlaneFrame(document, mirror);
  if (!frame || 'error' in frame) throw new Error('Missing copy face');
  expect(partFaceAt(part, part.copies![0]!.placement!, [500, -80, 39], [0, -1, 0], true)).toEqual({ edge: right.id });
  expect(frame.origin[0]).toBeCloseTo(500, 6);
  expect(frame.origin[1]).toBeCloseTo(-80, 6);
  expect(frame.origin[2]).toBeCloseTo(30, 6);
  expect(frame.normal[0]).toBeCloseTo(0, 6);
  expect(frame.normal[1]).toBeCloseTo(-1, 6);
  expect(frame.normal[2]).toBeCloseTo(0, 6);
  expect(cadMirrorPlaneFrame({ ...document, parts: [{ ...part, copies: [] }] }, mirror)).toHaveProperty('error');
});
