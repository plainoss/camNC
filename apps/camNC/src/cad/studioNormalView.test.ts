import { createCadPart, updateCopyTransform } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { orderedCopyFixture } from '@/test/orderedCopyFixture';
import { studioNormalView } from './studioNormalView';

it('looks normal to the evaluated selected copy and alternates sides without editing its creation frame', () => {
  const f = orderedCopyFixture();
  const document = updateCopyTransform(f.document, f.move, {
    turn: { about: [200, 0, 0], axis: [0, 1, 0], degrees: 90 },
  });
  const bytes = JSON.stringify(document);
  const request = studioNormalView(document, null, { partId: f.partId, copyId: f.copyId, face: 'top' });
  expect(request).not.toBeNull();
  const first = request!(undefined),
    second = request!(first),
    third = request!(second);
  expect(first).toMatchObject({ name: 'normal', seq: 1, up: [0, 1, 0] });
  expect(first.direction![0]).toBeCloseTo(1, 12);
  expect(first.direction![2]).toBeCloseTo(0, 12);
  expect(second.seq).toBe(2);
  expect(second.direction).toEqual(first.direction!.map(value => -value));
  expect(third.direction).toEqual(first.direction);
  expect(JSON.stringify(document)).toBe(bytes);
});

it('gives an explicit base plane priority while preserving a source sketch generation frame', () => {
  const f = orderedCopyFixture();
  const document = updateCopyTransform(f.document, f.move, {
    turn: { about: [200, 0, 0], axis: [0, 1, 0], degrees: 90 },
  });
  const face = { partId: f.partId, copyId: f.copyId, face: 'top' as const };
  expect(studioNormalView(document, 'top', face)!(undefined).direction).toEqual([0, 0, 1]);
  const dependent = createCadPart('Independent generated sketch');
  dependent.drawnOn = { on: face, offset: 0 };
  expect(studioNormalView(document, null, null, dependent)!(undefined).direction).toEqual([0, 0, 1]);
  expect(studioNormalView(document, null, { ...face, copyId: 'missing' })).toBeNull();
});
