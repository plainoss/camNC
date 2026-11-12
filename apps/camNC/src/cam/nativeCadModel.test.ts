import {
  addCircle,
  addFaceSketch,
  addLine,
  addPartCopy,
  addRectangle,
  cadSketchRegions,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  mirroredPartId,
  pointInPolygon,
  polygonArea,
  setCutDepth,
  solveCadDocument,
  type CadDocument,
} from '@wbcnc/cad';
import type { HoleChoice } from '@wbcnc/cam';
import { describe, expect, it } from 'vitest';
import { camPart, extractFeatures, flipPart } from '@wbcnc/cam';
import { camWorker } from './camQueries';
import { nativeCadModel } from './nativeCadModel';
import { missingNativeHoleChoices } from './holeChoices';
import { kDefaultPlan, toCamSettings } from './planSettings';

describe('native CAD to CAM', () => {
  it('compiles solved profiles and through holes directly, with stable IDs and a display solid', async () => {
    const document = createPlateDocument({ width: 100, height: 60, thickness: 12 });
    const part = document.parts[0];
    part.sketch = addCircle(part.sketch, { x: 30, y: 30, radius: 6 });
    const { model, entries } = await nativeCadModel(document);
    expect(model.parts[0].id).toBe(part.id);
    expect(model.parts[0].size).toEqual([100, 60, 12]);
    expect(model.parts[0].shape.holes).toHaveLength(1);
    expect(model.meshes[0].positions.length).toBeGreaterThan(24);
    const features = entries.get(part.id)!.features;
    expect(features.pockets).toEqual([]);
    expect(features.throughHoles).toHaveLength(1);
    expect(features.levels).toHaveLength(1);
  });

  it('cuts a part once more for each copy, and its mirror image as a part of its own', async () => {
    let document = createPlateDocument({ width: 100, height: 60, thickness: 12 });
    const part = document.parts[0];
    part.name = 'Side';
    part.sketch = addCircle(part.sketch, { x: 20, y: 30, radius: 6 });
    document = addPartCopy(document, part.id).document;
    document = addPartCopy(document, part.id, { mirrored: true }).document;
    const { model } = await nativeCadModel(document);
    expect(model.parts.map(p => [p.id, p.name, p.names])).toEqual([
      [part.id, 'Side', ['Side', 'Side 2']],
      [mirroredPartId(part.id), 'Side 3 (mirrored)', ['Side 3']],
    ]);
    // Several mirror images cut alike are one piece, named for the part with each copy listed.
    const twice = await nativeCadModel(addPartCopy(document, part.id, { mirrored: true }).document);
    expect(twice.model.parts.map(p => [p.name, p.names])).toEqual([
      ['Side', ['Side', 'Side 2']],
      ['Side (mirrored)', ['Side 3', 'Side 4']],
    ]);
    // The hole near the left end of the side is near the right end of its mirror image.
    const holeX = (index: number) => Math.min(...model.parts[index].shape.holes[0].map(p => p[0]));
    expect(holeX(0)).toBeCloseTo(14, 6);
    expect(holeX(1)).toBeCloseTo(74, 6);
  });

  it('passes the bit diameter a design relieved its corners for on to planning, mirror images included', async () => {
    let document = createPlateDocument({ width: 100, height: 60, thickness: 12 });
    const part = document.parts[0];
    part.cornerRelief = { diameter: 6 };
    document = addPartCopy(document, part.id, { mirrored: true }).document;
    const { entries } = await nativeCadModel(document);
    expect([...entries.values()].map(entry => entry.cornerRelief)).toEqual([6, 6]);
  });

  it('generates a complete cutting program in the existing CAM worker without model-file bytes', async () => {
    const document = createPlateDocument({ width: 100, height: 60, thickness: 12 });
    const key = `${document.id}:native`;
    const model = await camWorker().importDesign(document, key);
    const partId = document.parts[0].id;
    expect(model.parts[0].id).toBe(partId);
    const result = await camWorker().generate(key, partId, toCamSettings(kDefaultPlan));
    expect(result.programs.length).toBeGreaterThan(0);
    expect(result.gcode).toContain('G');
    expect(result.ops.some(op => op.kind === 'profile')).toBe(true);
    expect(result.safety).toEqual([]);
    expect(result.path.length).toBeGreaterThan(0);
  });

  describe('with cuts', () => {
    function plate() {
      const document = createPlateDocument({ width: 100, height: 60, thickness: 12 }),
        part = document.parts[0];
      part.sketch = addCircle(part.sketch, { x: 30, y: 30, radius: 12 });
      part.sketch = addCircle(part.sketch, { x: 75, y: 30, radius: 5 });
      return document;
    }
    const regionAt = (document: CadDocument, sketchId: string, x: number, y: number) =>
      cadSketchRegions(document.parts[0], sketchId).find(region => {
        const xs = region.points.map(p => p.x),
          ys = region.points.map(p => p.y);
        return !region.holes.length && Math.min(...xs) < x && x < Math.max(...xs) && Math.min(...ys) < y && y < Math.max(...ys);
      })!;
    const pocketed = (depth: number | 'through', document = plate()) => {
      const sketchId = document.parts[0].sketch.id;
      return setCutDepth(document, document.parts[0].id, sketchId, regionAt(document, sketchId, 30, 30).id, depth);
    };

    it('turns a loop with a depth into a pocket, and keeps the other hole’s identity', async () => {
      const original = plate(),
        before = await nativeCadModel(original),
        document = pocketed(5, original),
        { model, entries } = await nativeCadModel(document),
        part = model.parts[0],
        features = entries.get(part.id)!.features;
      expect(features.pockets.map(pocket => pocket.floorZ)).toEqual([7]);
      expect(features.throughHoles).toHaveLength(1);
      expect(part.shape.holes).toHaveLength(1);
      expect(part.holeIds).toEqual([before.model.parts[0].holeIds![1]]);
      expect(part.shape.pockets.map(pocket => pocket.depth)).toEqual([5]);
      expect(part.summary.needsFlip).toBe(false);
    });

    it('leaves a part unchanged when its loop is cut through', async () => {
      const original = plate(),
        plain = await nativeCadModel(original),
        through = await nativeCadModel(pocketed('through', original));
      expect(through.model.parts[0].holeIds).toEqual(plain.model.parts[0].holeIds);
      expect(through.model.parts[0].shape).toEqual(plain.model.parts[0].shape);
      expect(through.entries.get(through.model.parts[0].id)!.features).toEqual(plain.entries.get(plain.model.parts[0].id)!.features);
    });

    it('generates a program that reaches the pocket floor in the CAM worker', async () => {
      const document = pocketed(5),
        key = `${document.id}:native-pocket`,
        model = await camWorker().importDesign(document, key),
        result = await camWorker().generate(key, model.parts[0].id, toCamSettings(kDefaultPlan));
      expect(result.programs.length).toBeGreaterThan(0);
      expect(result.safety).toEqual([]);
      expect(result.ops.some(op => op.kind === 'pocket' && Math.abs(op.zBottom - 7) < 0.01)).toBe(true);
    });

    it('cuts a rabbet from a face sketch, in part coordinates for a sketch away from the origin', async () => {
      const base = createCadDocument(),
        plateAway = createCadPart('Plate', 12),
        partId = plateAway.id;
      plateAway.sketch = addRectangle(plateAway.sketch, { x: 40, y: 10, width: 100, height: 60 });
      base.parts.push(plateAway);
      const added = addFaceSketch(base, partId, 'top'),
        face = added.document.parts[0].features![0]!;
      if (face.type !== 'sketch') throw new Error('Expected a sketch');
      face.sketch = addLine(face.sketch, { x1: 120, y1: 0, x2: 120, y2: 80 });
      const rabbet = regionAt(added.document, added.sketchId, 130, 40),
        { model, entries } = await nativeCadModel(setCutDepth(added.document, partId, added.sketchId, rabbet.id, 4)),
        pocket = entries.get(partId)!.features.pockets[0]!,
        strict = pocket.strictRegion.flat();
      expect(pocket.floorZ).toBe(8);
      expect(Math.min(...strict.map(p => p.x))).toBeCloseTo(80, 3);
      expect(Math.max(...strict.map(p => p.x))).toBeCloseTo(100, 3);
      expect(model.parts[0].sourceOrigin).toEqual([40, 10]);
      expect(model.parts[0].size).toEqual([100, 60, 12]);
    });

    it('generates G-code for a recess, a through slot and a rabbet on one part', async () => {
      const base = createPlateDocument({ width: 200, height: 120, thickness: 18 }),
        partId = base.parts[0].id;
      base.parts[0].sketch = addCircle(base.parts[0].sketch, { x: 50, y: 60, radius: 25 });
      base.parts[0].sketch = addCircle(base.parts[0].sketch, { x: 120, y: 60, radius: 10 });
      const recess = regionAt(base, base.parts[0].sketch.id, 50, 60),
        withRecess = setCutDepth(base, partId, base.parts[0].sketch.id, recess.id, 6),
        added = addFaceSketch(withRecess, partId, 'top'),
        face = added.document.parts[0].features!.find(f => f.type === 'sketch')!;
      if (face.type !== 'sketch') throw new Error('Expected a sketch');
      face.sketch = addLine(face.sketch, { x1: 176, y1: -5, x2: 176, y2: 125 });
      const document = setCutDepth(added.document, partId, added.sketchId, regionAt(added.document, added.sketchId, 190, 60).id, 3),
        key = `${document.id}:native-mixed`,
        model = await camWorker().importDesign(document, key),
        result = await camWorker().generate(key, partId, toCamSettings(kDefaultPlan));
      expect(model.parts[0].shape.pockets.map(pocket => pocket.depth).sort()).toEqual([3, 6]);
      expect(model.parts[0].shape.holes).toHaveLength(1);
      expect(result.safety).toEqual([]);
      expect(result.ops.filter(op => op.kind === 'pocket').map(op => +op.zBottom.toFixed(2))).toEqual(expect.arrayContaining([12, 15]));
      expect(result.gcode).toContain('Z12');
      expect(result.gcode).toContain('Z15');
    });

    it('names a through cut’s hole after the cut, keeps hole choices on it, and refuses a through cut at the edge', async () => {
      const base = createPlateDocument({ width: 100, height: 60, thickness: 12 }),
        partId = base.parts[0].id;
      base.parts[0].sketch = addCircle(base.parts[0].sketch, { x: 20, y: 30, radius: 8 });
      const added = addFaceSketch(base, partId, 'top'),
        face = added.document.parts[0].features![0]!;
      if (face.type !== 'sketch') throw new Error('Expected a sketch');
      face.sketch = addCircle(face.sketch, { x: 60, y: 30, radius: 10 });
      const document = setCutDepth(added.document, partId, added.sketchId, regionAt(added.document, added.sketchId, 60, 30).id, 'through'),
        cutId = document.parts[0].features!.at(-1)!.id,
        { model } = await nativeCadModel(document),
        holeIds = model.parts[0].holeIds!;
      expect(holeIds).toHaveLength(2);
      expect(holeIds[1]).toBe(cutId);
      expect(model.parts[0].size).toEqual([100, 60, 12]);
      const solved = await solveCadDocument(document);
      expect(missingNativeHoleChoices(solved.parts, { [partId]: { [cutId]: { clear: true } as unknown as HoleChoice } })).toEqual([]);

      face.sketch = addLine(face.sketch, { x1: 90, y1: -5, x2: 90, y2: 65 });
      const edge = regionAt(added.document, added.sketchId, 95, 30);
      await expect(nativeCadModel(setCutDepth(added.document, partId, added.sketchId, edge.id, 'through'))).rejects.toThrow('edge');
    });
  });

  describe('cuts from the underside', () => {
    const regionAt = (document: CadDocument, sketchId: string, x: number, y: number) =>
      cadSketchRegions(document.parts[0], sketchId)
        .filter(region => pointInPolygon({ x, y }, region.points) && !region.holes.some(hole => pointInPolygon({ x, y }, hole)))
        .sort((a, b) => Math.abs(polygonArea(a.points)) - Math.abs(polygonArea(b.points)))[0]!;
    /** A through hole near the left, a pocket from below near the right, and a shallow pocket from the top between them. */
    function bothSides(depth = 4, { topPocket = true } = {}) {
      let base = createPlateDocument({ width: 100, height: 60, thickness: 12 });
      const partId = base.parts[0].id;
      base.parts[0].sketch = addCircle(base.parts[0].sketch, { x: 20, y: 30, radius: 6 });
      if (topPocket) {
        base.parts[0].sketch = addCircle(base.parts[0].sketch, { x: 45, y: 15, radius: 5 });
        base = setCutDepth(base, partId, base.parts[0].sketch.id, regionAt(base, base.parts[0].sketch.id, 45, 15).id, 3);
      }
      const added = addFaceSketch(base, partId, 'underside'),
        face = added.document.parts[0].features!.find(f => f.type === 'sketch')!;
      if (face.type !== 'sketch') throw new Error('Expected a sketch');
      // Seen from below, X runs the other way, so this sits at x = 70 on the part.
      face.sketch = addCircle(face.sketch, { x: -70, y: 30, radius: 10 });
      const region = regionAt(added.document, added.sketchId, -70, 30);
      return { document: setCutDepth(added.document, partId, added.sketchId, region.id, depth), partId };
    }
    const center = (paths: { x: number; y: number }[][]) => {
      const points = paths.flat();
      return { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
    };

    it('turns a part cut only from below over, so it mills in one setup', async () => {
      const { document, partId } = bothSides(4, { topPocket: false }),
        { entries, model } = await nativeCadModel(document),
        entry = entries.get(partId)!;
      expect(entry.features.pockets.map(pocket => +pocket.floorZ.toFixed(3))).toEqual([8]);
      // Turned over end for end: the pocket at x = 70 is now at 30, and the hole at 20 is at 80.
      expect(center(entry.features.pockets[0]!.strictRegion).x).toBeCloseTo(30, 0);
      expect(center(entry.features.throughHoles).x).toBeCloseTo(80, 0);
      expect(center(entry.features.throughHoles).y).toBeCloseTo(30, 0);
      expect(entry.features.bottomFaces).toEqual([]);
      expect(entry.flipped).toBeUndefined();
      expect(model.parts[0].summary.needsFlip).toBe(false);
      expect(model.parts[0].holeIds).toHaveLength(1);
      expect(model.parts[0].size).toEqual([100, 60, 12]);
    });

    it('mills a rabbet cut from below from the top, with no second side', async () => {
      const base = createPlateDocument({ width: 100, height: 60, thickness: 12 }),
        partId = base.parts[0].id,
        added = addFaceSketch(base, partId, 'underside'),
        face = added.document.parts[0].features!.find(f => f.type === 'sketch')!;
      if (face.type !== 'sketch') throw new Error('Expected a sketch');
      // Seen from below, X runs the other way: this rabbet runs along the part's right end, x = 80 to 100.
      face.sketch = addLine(face.sketch, { x1: -80, y1: -5, x2: -80, y2: 65 });
      const document = setCutDepth(added.document, partId, added.sketchId, regionAt(added.document, added.sketchId, -90, 30).id, 4),
        key = `${document.id}:native-underside-rabbet`,
        model = await camWorker().importDesign(document, key),
        result = await camWorker().generate(key, partId, toCamSettings(kDefaultPlan));
      expect(model.parts[0].summary.needsFlip).toBe(false);
      expect(model.parts[0].shape.pockets.map(pocket => pocket.depth)).toEqual([4]);
      // Turned over, the rabbet runs along the left end.
      const xs = model.parts[0].shape.pockets[0]!.region.flat().map(p => p[0]);
      expect(Math.min(...xs)).toBeCloseTo(0, 3);
      expect(Math.max(...xs)).toBeCloseTo(20, 3);
      expect(result.safety).toEqual([]);
      expect(result.warnings.filter(w => w.includes('flipped'))).toEqual([]);
      expect(result.ops.some(op => op.kind === 'pocket' && Math.abs(op.zBottom - 8) < 0.01)).toBe(true);
    });

    it('leaves side A alone, and asks for a second side', async () => {
      const { document, partId } = bothSides(),
        { entries, model } = await nativeCadModel(document),
        { features } = entries.get(partId)!;
      expect(features.pockets.map(pocket => +pocket.floorZ.toFixed(3))).toEqual([9]);
      expect(features.throughHoles).toHaveLength(1);
      expect(features.bottomFaces.map(face => face.z)).toEqual([4]);
      expect(model.parts[0].summary.needsFlip).toBe(true);
    });

    it('gives side B the pocket where it lies after turning over, with holes lining up', async () => {
      const { document, partId } = bothSides(),
        { entries } = await nativeCadModel(document),
        { x, y } = entries.get(partId)!.flipped!;
      expect(x!.pockets.map(pocket => +pocket.floorZ.toFixed(3))).toEqual([8]);
      expect(center(x!.pockets[0]!.strictRegion).x).toBeCloseTo(70, 0);
      expect(center(y!.pockets[0]!.strictRegion).x).toBeCloseTo(30, 0);
      expect(center(x!.throughHoles).x).toBeCloseTo(20, 0);
      expect(center(y!.throughHoles).x).toBeCloseTo(80, 0);
      expect(center(x!.throughHoles).y).toBeCloseTo(30, 0);
    });

    it('matches what the mesh extractor reads from the same part turned over', async () => {
      const { document, partId } = bothSides(),
        { entries } = await nativeCadModel(document),
        { part, flipped, features } = entries.get(partId)!,
        read = extractFeatures(flipPart(part, 'x').mesh, 12),
        { pockets, throughHoles } = flipped!.x!;
      expect(read.pockets.map(pocket => +pocket.floorZ.toFixed(2))).toEqual(pockets.map(pocket => +pocket.floorZ.toFixed(2)));
      expect(read.pockets[0]!.area).toBeCloseTo(pockets[0]!.area, 0);
      expect(center(read.pockets[0]!.strictRegion).x).toBeCloseTo(center(pockets[0]!.strictRegion).x, 0);
      expect(read.throughHoles).toHaveLength(throughHoles.length);
      expect(extractFeatures(part.mesh, 12).bottomFaces.map(face => +face.z.toFixed(2))).toEqual(features.bottomFaces.map(face => face.z));
    });

    it('cuts the pocket from side B without cutting through', async () => {
      const { document, partId } = bothSides(),
        { entries } = await nativeCadModel(document),
        cam = camPart(entries.get(partId)!.flipped!.x!, { ...toCamSettings(kDefaultPlan), cutThrough: false });
      expect(cam.operations.some(op => op.feature === 'pocket')).toBe(true);
      expect(cam.operations.some(op => op.feature === 'outline')).toBe(false);
    });

    it('keeps a through cut from a pocket floor inside that pocket', async () => {
      const base = createPlateDocument({ width: 100, height: 60, thickness: 12 }),
        partId = base.parts[0].id;
      base.parts[0].sketch = addCircle(base.parts[0].sketch, { x: 30, y: 30, radius: 10 });
      const pocket = regionAt(base, base.parts[0].sketch.id, 30, 30),
        pocketed = setCutDepth(base, partId, base.parts[0].sketch.id, pocket.id, 4),
        cutId = pocketed.parts[0].features!.find(f => f.type === 'cut')!.id,
        added = addFaceSketch(pocketed, partId, { floorOf: cutId }),
        face = added.document.parts[0].features!.find(f => f.type === 'sketch')!;
      if (face.type !== 'sketch') throw new Error('Expected a sketch');
      // Reaches well past the pocket, to x = 55.
      face.sketch = addRectangle(face.sketch, { x: 30, y: 25, width: 25, height: 10 });
      const slot = regionAt(added.document, added.sketchId, 45, 30),
        { entries } = await nativeCadModel(setCutDepth(added.document, partId, added.sketchId, slot.id, 'through')),
        xs = entries
          .get(partId)!
          .features.throughHoles.flat()
          .map(p => p.x);
      expect(Math.max(...xs)).toBeLessThanOrEqual(40 + 0.01);
    });

    it('refuses cuts from the two faces that meet', async () => {
      const { document, partId } = bothSides(8),
        part = document.parts[0];
      part.sketch = addCircle(part.sketch, { x: 70, y: 30, radius: 15 });
      const pocket = regionAt(document, part.sketch.id, 70, 30),
        meeting = setCutDepth(document, partId, part.sketch.id, pocket.id, 6);
      await expect(nativeCadModel(meeting)).rejects.toThrow(/two faces meet/);
    });
  });
});
