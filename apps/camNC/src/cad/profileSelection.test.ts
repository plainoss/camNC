import { createPlateDocument, newExtrudeOf, sketchRegions, CAD_CHORD_TOLERANCE, parseCadDocument } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { replaceExtrudeProfile, sketchSelectionRegions } from './profileSelection';
import saved from '../../../../packages/cad-script/fixtures/designs/extrude-three-profiles.json';

it('chooses the whole authored sketch without losing Remove settings or feature identity', () => {
  const document = parseCadDocument(structuredClone(saved));
  const target = document.parts[1]!;
  expect(target.regions).toHaveLength(2);
  expect(sketchRegions(target.sketch, CAD_CHORD_TOLERANCE)).toHaveLength(3);
  const next = replaceExtrudeProfile(document, target.id, { sketch: target.id });
  expect(next.parts[1]!.regions).toBeUndefined();
  expect(next.parts[1]!.sketch).toBe(target.sketch);
  expect(next.parts[1]!.remove).toEqual({ depth: 6 });
  expect(next.parts[1]!.drawnOn).toEqual(target.drawnOn);
  expect(next.parts[1]!.id).toBe(target.id);
  expect(target.regions).toHaveLength(2);
  expect(replaceExtrudeProfile(next, target.id, { sketch: target.id })).toBe(next);
});

it('preserves authored sketch ownership, downstream shared sketches, depth and feature identity when retargeting', () => {
  const source = createPlateDocument({ width: 60, height: 80, thickness: 25 });
  const original = source.parts[0]!;
  original.thicknessExpression = '#depth';
  const shared = newExtrudeOf(source, original, 'Shared');
  const replacement = createPlateDocument({ width: 20, height: 30, thickness: 10 }).parts[0]!;
  replacement.extrude = false;
  source.parts.push(shared, replacement);
  const region = sketchRegions(replacement.sketch, CAD_CHORD_TOLERANCE)[0]!.id;
  const next = replaceExtrudeProfile(source, original.id, { sketch: replacement.id, region });
  const kept = next.parts.find(p => p.extrude === false && p.sketch.id === original.sketch.id)!;
  expect(kept).toBeDefined();
  expect(next.parts.find(p => p.id === shared.id)?.sketchOf).toBe(kept.id);
  expect(next.parts.find(p => p.id === original.id)).toMatchObject({
    thickness: 25,
    thicknessExpression: '#depth',
    sketchOf: replacement.id,
    regions: [region],
  });
  expect(source.parts).toHaveLength(3);
  expect(source.parts[0]!.sketchOf).toBeUndefined();
});

it('rejects cyclic profiles and omits hidden sketch pick surfaces', () => {
  const source = createPlateDocument({ width: 60, height: 80, thickness: 25 });
  const base = source.parts[0]!;
  const dependent = createPlateDocument({ width: 20, height: 30, thickness: 10 }).parts[0]!;
  dependent.drawnOn = { on: { partId: base.id, face: 'top' }, offset: 0 };
  dependent.extrude = false;
  source.parts.push(dependent);
  expect(() => replaceExtrudeProfile(source, base.id, { sketch: dependent.id })).toThrow('does not depend');
  const views = sketchSelectionRegions(source, id => id === `${dependent.id}:sketch`, null);
  expect(views).toHaveLength(1);
  expect(JSON.parse(views[0]!.id)[0]).toBe(dependent.id);
  expect(views[0]!.frame.origin[2]).toBeCloseTo(25.1);
});

it('includes end conditions in cycle checks and keeps the feature direction when replacing sketches and faces', () => {
  const source = createPlateDocument({ width: 60, height: 80, thickness: 25 });
  const target = source.parts[0]!;
  target.drawnOn = { on: { plane: 'front' }, offset: 0, inward: false };
  const profile = createPlateDocument({ width: 20, height: 30, thickness: 10 }).parts[0]!;
  profile.drawnOn = { on: { plane: 'front' }, offset: 0, inward: true };
  profile.upTo = { partId: target.id, face: 'top' };
  source.parts.push(profile);
  expect(() => replaceExtrudeProfile(source, target.id, { sketch: profile.id })).toThrow('does not depend');
  delete profile.upTo;
  const corner = profile.sketch.entities.find(entity => entity.type === 'point')!;
  if (corner.type === 'point') corner.used = { partId: target.id, pointId: 'corner', side: 'top' };
  expect(() => replaceExtrudeProfile(source, target.id, { sketch: profile.id })).toThrow('does not depend');
  if (corner.type === 'point') delete corner.used;
  expect(replaceExtrudeProfile(source, target.id, { sketch: profile.id }).parts.find(p => p.id === target.id)?.drawnOn?.inward).toBe(false);
  target.drawnOn.inward = true;
  expect(
    replaceExtrudeProfile(source, target.id, { face: { partId: profile.id, face: 'top' } }).parts.find(p => p.id === target.id)?.drawnOn
      ?.inward
  ).toBe(true);
});
