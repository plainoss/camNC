import {
  addCircle,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  evaluateCadPart,
  newExtrudeOf,
  sketchRegions,
  splitApartRegions,
  designSteps,
  handOverEmptyExtrude,
  CAD_CHORD_TOLERANCE,
  parseCadDocument,
} from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { replaceExtrudeProfile, sketchSelectionRegions } from './profileSelection';
import { withRegionToggled } from './extrudeRegionViews';
import saved from '../../../../packages/cad-script/fixtures/designs/extrude-three-profiles.json';
import apart from '../../../../packages/cad-script/fixtures/designs/extrude-sketch-apart.json';

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

it('picks every closed shape of a sketch of shapes apart, each a part on OK, rather than the sketch as one outline', () => {
  const document = parseCadDocument(structuredClone(apart));
  const selectme = document.parts.find(p => p.sketchName === 'selectme')!;
  const target = document.parts.find(p => p.sketchOf === selectme.id)!;
  // As saved, the extrude takes the whole sketch: two circles and a rectangle apart aren't one outline.
  expect(evaluateCadPart(target).part).toBeUndefined();
  const shapes = sketchRegions(selectme.sketch, CAD_CHORD_TOLERANCE).map(region => region.id);
  expect(shapes).toHaveLength(3);
  // Picked again for this extrude, and picked for another, the sketch starts with all of its shapes.
  const again = replaceExtrudeProfile(document, target.id, { sketch: selectme.id });
  expect(again.parts.find(p => p.id === target.id)!.regions).toEqual(shapes);
  const other = document.parts.find(p => p.name === 'Part 1 sketch')!;
  const extruded = { ...other, extrude: undefined };
  const retargeted = replaceExtrudeProfile({ ...document, parts: [...document.parts.filter(p => p.id !== other.id), extruded] }, other.id, {
    sketch: selectme.id,
  });
  expect(retargeted.parts.find(p => p.id === other.id)!.regions).toEqual(shapes);
  const split = splitApartRegions(again, target.id).parts.filter(p => p.sketchOf === selectme.id);
  expect(split).toHaveLength(3);
  for (const part of split) expect(evaluateCadPart(part).part).toBeDefined();
});

it('picks several regions of the sketch an extrude shares, and takes one back out when it is picked again', () => {
  const document = parseCadDocument(structuredClone(apart));
  const selectme = document.parts.find(p => p.sketchName === 'selectme')!;
  const target = document.parts.find(p => p.sketchOf === selectme.id)!;
  const [a, b, c] = sketchRegions(selectme.sketch, CAD_CHORD_TOLERANCE).map(region => region.id);
  const pick = (doc: typeof document, region: string) => replaceExtrudeProfile(doc, target.id, { sketch: selectme.id, region });
  const regionsOf = (doc: typeof document) => doc.parts.find(p => p.id === target.id)!.regions;
  // Start from one region, as the dialog does once one is picked.
  const first = { ...document, parts: document.parts.map(p => (p.id === target.id ? { ...p, regions: [a!] } : p)) };
  const three = pick(pick(first, b!), c!);
  expect(regionsOf(three)).toEqual([a, b, c]);
  expect(three.parts.filter(p => p.sketchOf === selectme.id)).toHaveLength(1);
  expect(regionsOf(pick(three, b!))).toEqual([a, c]);
  // On OK, New makes each region apart a part of its own.
  expect(splitApartRegions(three, target.id).parts.filter(p => p.sketchOf === selectme.id)).toHaveLength(3);
});

it('takes a region out of an extrude of the whole shared sketch when it is picked, keeping the others', () => {
  const document = parseCadDocument(structuredClone(apart));
  const selectme = document.parts.find(p => p.sketchName === 'selectme')!;
  const target = document.parts.find(p => p.sketchOf === selectme.id)!;
  expect(target.regions).toBeUndefined();
  const [a, b, c] = sketchRegions(selectme.sketch, CAD_CHORD_TOLERANCE).map(region => region.id);
  const next = replaceExtrudeProfile(document, target.id, { sketch: selectme.id, region: b! });
  expect(next.parts.find(p => p.id === target.id)!.regions).toEqual([a, c]);
});

it('takes a region off the part an extrude made too, and that part away once it has none, keeping one feature', () => {
  const document = parseCadDocument(structuredClone(apart));
  const selectme = document.parts.find(p => p.sketchName === 'selectme')!;
  const target = document.parts.find(p => p.sketchOf === selectme.id)!;
  const shapes = sketchRegions(selectme.sketch, CAD_CHORD_TOLERANCE).map(region => region.id);
  const picked = { ...document, parts: document.parts.map(p => (p.id === target.id ? { ...p, regions: shapes } : p)) };
  const split = splitApartRegions(picked, target.id);
  const made = split.parts.filter(p => p.extrudedWith === target.id);
  expect(made).toHaveLength(2);
  const region = made[0]!.regions![0]!;
  const next = replaceExtrudeProfile(split, target.id, { sketch: selectme.id, region });
  expect(next.parts.some(p => p.id === made[0]!.id)).toBe(false);
  expect(next.parts.find(p => p.id === target.id)!.regions).toEqual(split.parts.find(p => p.id === target.id)!.regions);
  // Picked again, it's the extrude's own, and OK makes a part of it again.
  const back = replaceExtrudeProfile(next, target.id, { sketch: selectme.id, region });
  expect(back.parts.find(p => p.id === target.id)!.regions).toContain(region);
  expect(splitApartRegions(back, target.id).parts.filter(p => p.extrudedWith === target.id)).toHaveLength(2);
});

it('hands the feature, on OK, to the next part it made when its own sketch’s extrude loses its last region', () => {
  const part = { ...createCadPart('Posts', 10), drawnOn: { on: { plane: 'top' as const }, offset: 0 } };
  part.sketch = [100, 200, 300].reduce((sketch, x) => addCircle(sketch, { x, y: 10, radius: 5 }), part.sketch);
  const shapes = sketchRegions(part.sketch, CAD_CHORD_TOLERANCE).map(region => region.id);
  expect(shapes).toHaveLength(3);
  const split = splitApartRegions({ ...createCadDocument(), parts: [{ ...part, regions: shapes }] }, part.id);
  const own = split.parts[0]!.regions!;
  const [second, third] = split.parts.filter(p => p.extrudedWith === part.id);
  // A counterbore added to the second part, and a name of its own.
  const bore = { type: 'sketch' as const, id: 'bore', on: 'top' as const, sketch: createCadPart('Bore', 1).sketch };
  const withBore = {
    ...split,
    parts: split.parts.map(p => (p.id === second!.id ? { ...p, name: 'Leg', features: [bore] } : p)),
  };
  // Unpicked, the extrude keeps making the others rather than falling back to the whole sketch.
  const unpicked = withRegionToggled(withBore, part.id, own[0]!);
  expect(unpicked.parts.find(p => p.id === part.id)!.regions).toEqual([]);
  expect(unpicked.parts.filter(p => p.extrudedWith === part.id)).toHaveLength(2);
  // On OK the second part takes over the feature, keeping all it had; the first is its sketch alone.
  const handed = handOverEmptyExtrude(unpicked, part.id);
  const lead = handed.parts.find(p => p.id === second!.id)!;
  expect(lead).toMatchObject({ name: 'Leg', features: [bore], regions: second!.regions });
  expect(lead.extrudedWith).toBeUndefined();
  expect(handed.parts.find(p => p.id === third!.id)!.extrudedWith).toBe(second!.id);
  expect(handed.parts.find(p => p.id === part.id)!.extrude).toBe(false);
  const extrudes = designSteps(handed).filter(step => step.kind === 'extrude');
  expect(extrudes.map(step => [step.partId, step.detail])).toEqual([[second!.id, '10 mm · 2 parts']]);
});
