import { expect, it } from 'vitest';
import {
  createPlateDocument,
  newExtrudeOnFace,
  resolveExtrudeSteps,
  evaluateCadPart,
  designSteps,
  rolledBackTo,
  parseCadDocument,
  addRectangle,
  cadFaceFacing,
  extrudeStepProblem,
  isCadPart,
  addFaceSketch,
  cadSketchRegions,
  setCutDepth,
} from './index';

it('extrudes a selected side face as a single feature and follows changes to the supporting face', () => {
  const source = createPlateDocument({ width: 60, height: 80, thickness: 25 });
  const support = source.parts[0]!;
  const face = cadFaceFacing(source, support.id, '+x');
  if ('error' in face) throw new Error(face.error);
  const made = newExtrudeOnFace(source, { partId: support.id, face: face.face }, 'Side');
  const document = { ...source, parts: [support, made] };
  expect(evaluateCadPart(made).part).toMatchObject({
    outline: [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 25 },
      { x: 0, y: 25 },
    ],
    thickness: 25,
  });
  expect(designSteps(document).map(step => step.kind)).toEqual(['sketch', 'extrude', 'extrude']);
  expect(rolledBackTo(document, `${made.id}:extrude`).parts).toHaveLength(2);
  expect(rolledBackTo(document, `${support.id}:extrude`).parts).toHaveLength(1);
  const changed = resolveExtrudeSteps({ ...document, parts: [{ ...support, thickness: 18 }, made] });
  expect(evaluateCadPart(changed.parts[1]!).part?.outline).toMatchObject([
    { x: 0, y: 0 },
    { x: 80, y: 0 },
    { x: 80, y: 18 },
    { x: 0, y: 18 },
  ]);
  expect(parseCadDocument(JSON.parse(JSON.stringify(changed))).parts[1]!.faceProfile).toBe(true);
  const waiting = { ...made, addTo: '' };
  expect(isCadPart(waiting)).toBe(false);
  expect(extrudeStepProblem(document, waiting)).toMatch(/merge scope/);
  expect(parseCadDocument(JSON.parse(JSON.stringify({ ...document, parts: [support, waiting] }))).parts[1]!.addTo).toBe('');
  const end = newExtrudeOnFace(document, { partId: made.id, face: 'top' }, 'End');
  const chain = resolveExtrudeSteps({ ...document, parts: [{ ...support, thickness: 18 }, made, end] });
  expect(evaluateCadPart(chain.parts[2]!).part?.outline.map(p => p.y)).toContain(18);
  expect(evaluateCadPart(chain.parts[2]!).part?.outline.map(p => p.y)).not.toContain(25);
});

it('refuses modified faces rather than extruding the uncut outline, including after regeneration', () => {
  const source = createPlateDocument({ width: 100, height: 60, thickness: 18 });
  const id = source.parts[0]!.id;
  const existing = newExtrudeOnFace(source, { partId: id, face: 'top' }, 'Raised');
  const added = addFaceSketch(source, id, 'top');
  const part = added.document.parts[0]!;
  const face = part.features!.find(feature => feature.type === 'sketch' && feature.sketch.id === added.sketchId)!;
  if (face.type !== 'sketch') throw new Error('Missing face sketch');
  face.sketch = addRectangle(face.sketch, { x: 20, y: 10, width: 60, height: 40 });
  const region = cadSketchRegions(part, added.sketchId).find(region =>
    region.points.every(p => p.x >= 19 && p.x <= 81 && p.y >= 9 && p.y <= 51)
  )!;
  const pocketed = setCutDepth(added.document, id, added.sketchId, region.id, 6);
  expect(() => newExtrudeOnFace(pocketed, { partId: id, face: 'top' }, 'Wrong rectangle')).toThrow(/modified by cuts/);
  const after = resolveExtrudeSteps({ ...pocketed, parts: [...pocketed.parts, existing] });
  expect(evaluateCadPart(after.parts[1]!).part).toBeUndefined();
  expect(extrudeStepProblem(after, after.parts[1]!)).toMatch(/modified by cuts/);
});

it('keeps holes when a flat face is extruded and rejects malformed saved face profiles', () => {
  const source = createPlateDocument({ width: 60, height: 80 });
  const support = source.parts[0]!;
  support.sketch = addRectangle(support.sketch, { x: 10, y: 10, width: 10, height: 10 });
  const made = newExtrudeOnFace(source, { partId: support.id, face: 'top' }, 'Raised');
  expect(evaluateCadPart(made).part?.holes).toHaveLength(1);
  for (const drawnOn of [undefined, null, {}, { on: null }, { on: 5 }, { on: { plane: 'top' } }]) {
    expect(() => parseCadDocument({ ...source, parts: [{ ...support, faceProfile: true, drawnOn }] })).toThrow(
      'Invalid CAD face extrusion'
    );
  }
});
