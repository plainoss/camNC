import { addRectangle, createCadDocument, createCadPart, createPlateDocument, resolveDrawnPlacements, withUsedPoints } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { bindPartCorners, partCornerInference } from './partCornerInference';
import type { PartEdge } from './partEdges';

it('snaps to an on-plane part corner before the grid and keeps the drawn corner following it', () => {
  const support = createPlateDocument({ width: 10.7, height: 20.3, thickness: 25 }).parts[0]!;
  support.drawnOn = { on: { plane: 'top' }, offset: 0 };
  const part = { ...createCadPart('Next'), drawnOn: { on: { partId: support.id, face: 'top' as const }, offset: 0 } };
  const offPlane = createPlateDocument({ width: 10.7, height: 20.3, thickness: 2 }).parts[0]!;
  offPlane.drawnOn = { on: { plane: 'top' }, offset: 100 };
  const document = resolveDrawnPlacements({ ...createCadDocument(), parts: [offPlane, support, part] }).document;
  const edge: PartEdge = { key: 'corner', partId: support.id, x1: 0, y1: 20.3, x2: 10.7, y2: 20.3, onPlane: true };
  const inferred = { point: { x: 11, y: 20 }, snap: null, alignments: [], guides: [] };
  const raw = { x: 10.72, y: 20.28 },
    project = (p: { x: number; y: number }) => ({ x: p.x * 5, y: p.y * 5 });
  const hint = partCornerInference(document, part, [edge], raw, inferred, project);
  expect(hint.point).toEqual({ x: 10.7, y: 20.3 });
  expect(partCornerInference(document, part, [{ ...edge, onPlane: false }], raw, inferred, project)).toBe(inferred);
  expect(partCornerInference(document, part, [edge], raw, inferred, project, { y: 20 })).toBe(inferred);
  expect(partCornerInference(document, part, [edge], raw, inferred, project, { y: 20.3 }).point).toEqual({ x: 10.7, y: 20.3 });
  const drawn = bindPartCorners(part.sketch, addRectangle(part.sketch, { x: 0, y: 0, width: 10.7, height: 20.3 }), [hint]);
  expect(drawn.entities.filter(e => e.type === 'point' && e.used)).toHaveLength(2);
  expect(drawn.entities.flatMap(e => (e.type === 'point' && e.used ? [e.used.partId] : []))).toEqual([support.id, support.id]);
  const movedOffPlane = {
    ...offPlane,
    sketch: { ...offPlane.sketch, entities: offPlane.sketch.entities.map(e => (e.type === 'point' ? { ...e, x: e.x + 5 } : e)) },
  };
  const unchanged = withUsedPoints(
    { ...document, parts: [movedOffPlane, support, { ...part, sketch: drawn }] },
    { ...part, sketch: drawn }
  );
  expect(unchanged.entities.find(e => e.type === 'point' && e.used)).toMatchObject({ x: 10.7, y: 20.3 });
  const resized = {
    ...support,
    sketch: { ...support.sketch, entities: support.sketch.entities.map(e => (e.type === 'point' && e.x === 10.7 ? { ...e, x: 12.2 } : e)) },
  };
  const after = withUsedPoints({ ...document, parts: [resized, { ...part, sketch: drawn }] }, { ...part, sketch: drawn });
  expect(after.entities.find(e => e.type === 'point' && e.used)).toMatchObject({ x: 12.2, y: 20.3 });
});
