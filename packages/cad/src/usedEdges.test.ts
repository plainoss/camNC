import { describe, expect, it } from 'vitest';
import { addRectangle, createCadDocument, createCadPart } from './document';
import { cadFaceFrame } from './drawnOn';
import { solveCadDocument } from './solver';
import { cadCornerSources, cadSketchFrame, cornerKey, withUsedPoints } from './usedEdges';
import type { CadDocument, CadPart, CadPointEntity } from './types';

function design() {
  const base = { ...createCadPart('Base', 18), drawnOn: { on: { plane: 'top' as const }, offset: 0 } };
  base.sketch = addRectangle(base.sketch, { x: 0, y: 0, width: 100, height: 50 });
  const side = { ...createCadPart('Side', 18), drawnOn: { on: { plane: 'front' as const }, offset: 0 } };
  return { ...createCadDocument(), parts: [base, side] } as CadDocument;
}

describe('points used from another part’s corners', () => {
  it('are found where the corners are seen on the sketch’s plane, top and bottom', () => {
    const document = design();
    const frame = cadSketchFrame(document, document.parts[1]!)!;
    const sources = cadCornerSources(document, frame, document.parts[1]!.id);
    // Seen from the front, the base's corner at x 100 is at (100, 18) on its top and (100, 0) on its bottom.
    expect(sources.get(cornerKey(100, 18))).toMatchObject({ partId: document.parts[0]!.id, side: 'top' });
    expect(sources.get(cornerKey(100, 0))).toMatchObject({ side: 'bottom' });
  });

  it('follow the corner when the part changes', () => {
    const document = design();
    const [base, side] = document.parts as [(typeof document.parts)[0], (typeof document.parts)[0]];
    const frame = cadSketchFrame(document, side)!;
    const source = cadCornerSources(document, frame, side.id).get(cornerKey(100, 18))!;
    const used: CadPointEntity = { id: 'u', type: 'point', x: 100, y: 18, fixed: true, used: source };
    const withUsed = { ...side, sketch: { ...side.sketch, entities: [...side.sketch.entities, used] } };
    // The base made wider: its corner moves from 100 to 120.
    const wider = {
      ...base,
      sketch: {
        ...base.sketch,
        entities: base.sketch.entities.map(entity => (entity.type === 'point' && entity.x === 100 ? { ...entity, x: 120 } : entity)),
      },
    };
    const next = { ...document, parts: [wider, withUsed] };
    const moved = withUsedPoints(next, withUsed).entities.find(entity => entity.id === 'u') as CadPointEntity;
    expect([moved.x, moved.y]).toEqual([120, 18]);
  });
});

describe('points used from a part standing on the Front plane', () => {
  async function standing(options: { offset?: number; inward?: boolean } = {}) {
    const side = {
      ...createCadPart('Side', 20),
      drawnOn: { on: { plane: 'front' as const }, offset: options.offset ?? 0, inward: options.inward },
    };
    side.sketch = addRectangle(side.sketch, { x: 30, y: 0, width: 130, height: 500, dimensioned: true, positioned: true });
    const back = { ...createCadPart('Back', 20), drawnOn: { on: { plane: 'right' as const }, offset: 0 } };
    return { side, back, document: (await solveCadDocument({ ...createCadDocument(), parts: [side, back] })).document };
  }

  it('are exactly where its corners are, however far from the origin', async () => {
    const { document } = await standing();
    const [side, back] = document.parts as [CadPart, CadPart];
    // The plane's turn is saved to nine places, which would put the far corner a micrometre off.
    expect(side.placement!.rotation[0]).not.toBe(Math.SQRT1_2);
    const tall = side.sketch.constraints.find(constraint => constraint.label === 'Height')!;
    const taller = structuredClone(document);
    taller.parts[0]!.sketch.constraints = taller.parts[0]!.sketch.constraints.map(c => (c.id === tall.id ? { ...c, value: 600 } : c));
    const solved = (await solveCadDocument(taller)).document;
    const keys = [...cadCornerSources(solved, cadSketchFrame(solved, back)!, back.id).keys()];
    expect(keys.sort()).toEqual(['-20,0', '-20,600', '0,0', '0,600']);
    const used: CadPointEntity = {
      id: 'u',
      type: 'point',
      x: -20,
      y: 500,
      fixed: true,
      used: cadCornerSources(document, cadSketchFrame(document, back)!, back.id).get(cornerKey(-20, 500))!,
    };
    const moved = withUsedPoints(solved, { ...back, sketch: { ...back.sketch, entities: [...back.sketch.entities, used] } }).entities.at(
      -1
    ) as CadPointEntity;
    expect([moved.x, moved.y]).toEqual([-20, 600]);
  });

  it('sit where its faces are when it starts off the plane or grows into it', async () => {
    for (const [options, xs] of [
      [{ offset: 50 }, [-70, -50]],
      [{ inward: true }, [0, 20]],
      [{ offset: 50, inward: true }, [-50, -30]],
    ] as const) {
      const { document } = await standing(options);
      const [side, back] = document.parts as [CadPart, CadPart];
      const sources = cadCornerSources(document, cadSketchFrame(document, back)!, back.id);
      expect([...new Set([...sources.keys()].map(key => Number(key.split(',')[0])))].sort((a, b) => a - b)).toEqual(xs);
      // Each is that corner on the part's top or underside, as its placement turns and moves it.
      const top = cadFaceFrame(document, { partId: side.id, face: 'top' });
      const frame = cadSketchFrame(document, back)!;
      if ('error' in top) throw new Error(top.error);
      for (const point of side.sketch.entities)
        if (point.type === 'point' && !point.construction)
          for (const [face, down] of [
            ['top', 0],
            ['bottom', side.thickness],
          ] as const) {
            const at = [0, 1, 2].map(
              i => top.origin[i]! + top.x[i]! * point.x + top.y[i]! * point.y - top.normal[i]! * down - frame.origin[i]!
            );
            const seen = (axis: number[]) => at.reduce((sum, value, i) => sum + value * axis[i]!, 0);
            expect(sources.get(cornerKey(seen(frame.x), seen(frame.y)))?.side).toBe(face);
          }
    }
  });
});
