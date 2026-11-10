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

it('resolves an Add body face on an inherited parent copy', () => {
  const document = createPlateDocument({ width: 100, height: 100, thickness: 18 });
  const block = document.parts[0]!;
  block.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  block.copies = [{ id: 'along', placement: { position: [200, 0, 0], rotation: [0, 0, 0, 1] } }];
  const boss = createPlateDocument({ width: 20, height: 20, thickness: 10 }).parts[0]!;
  boss.addTo = block.id;
  boss.placement = { position: [40, 40, 18], rotation: [0, 0, 0, 1] };
  document.parts.push(boss);
  const frame = cadMirrorPlaneFrame(document, { across: { partId: `${boss.id}:along`, face: 'top' } });
  if (!frame || 'error' in frame) throw new Error('Missing inherited face');
  expect(frame.origin).toEqual([240, 40, 28]);
  expect(frame.normal).toEqual([0, 0, 1]);
});
