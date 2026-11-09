import { describe, expect, it } from 'vitest';
import { addRectangle, createCadDocument, createCadPart } from './document';
import { cadCornerSources, cadSketchFrame, cornerKey, withUsedPoints } from './usedEdges';
import type { CadDocument, CadPointEntity } from './types';

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
