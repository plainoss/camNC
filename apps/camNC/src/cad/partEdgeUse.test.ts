import { createCadDocument, createCadPart, createPlateDocument, cadSketchFrame, withUsedPoints, type CadDocument } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { addUsedPartEdges } from './partEdgeUse';
import { partVertices } from './partVertices';

function design() {
  const decoy = createPlateDocument({ width: 100, height: 20, thickness: 18 }).parts[0]!,
    source = createPlateDocument({ width: 120, height: 20, thickness: 18 }).parts[0]!,
    target = createCadPart('Target');
  decoy.placement = source.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  target.drawnOn = { on: { plane: 'front' }, offset: 0 };
  const document: CadDocument = { ...createCadDocument(), parts: [decoy, source, target] };
  return { document, decoy, source, target };
}

const bound = (sketch: ReturnType<typeof addUsedPartEdges>['sketch']) =>
  sketch.entities.flatMap(entity => (entity.type === 'point' && entity.used ? [entity.used] : []));

describe('the physical source of a used edge', () => {
  it('binds both endpoints to the picked owner when another part shares one projected corner', () => {
    const { document, source, target } = design(),
      before = JSON.stringify(document),
      edge = { key: 'picked', partId: source.id, x1: 0, y1: 18, x2: 120, y2: 18, onPlane: true };
    const used = addUsedPartEdges(target.sketch, [edge], [edge.key], document, cadSketchFrame(document, target), target.id);
    expect(bound(used.sketch)).toHaveLength(2);
    expect(bound(used.sketch).every(reference => reference.partId === source.id && reference.copyId === undefined)).toBe(true);
    expect(JSON.stringify(document)).toBe(before);
  });

  it('keeps a selected copy at a shared seed endpoint and follows that copy after reload', () => {
    const { document, source, target } = design();
    source.copies = [{ id: 'copy', placement: { position: [-120, 0, 0], rotation: [0, 0, 0, 1] } }];
    const before = JSON.stringify(document),
      edge = { key: 'copy-edge', partId: source.id, copyId: 'copy', x1: -120, y1: 18, x2: 0, y2: 18, onPlane: true };
    const used = addUsedPartEdges(target.sketch, [edge], [edge.key], document, cadSketchFrame(document, target), target.id);
    expect(bound(used.sketch)).toHaveLength(2);
    expect(bound(used.sketch).every(reference => reference.partId === source.id && reference.copyId === 'copy')).toBe(true);
    const loaded = JSON.parse(JSON.stringify(document)) as CadDocument;
    loaded.parts[1]!.copies![0]!.placement!.position[0] = -150;
    const moved = withUsedPoints(loaded, { ...target, sketch: used.sketch });
    expect(moved.entities.flatMap(entity => (entity.type === 'point' && entity.used ? [[entity.x, entity.y]] : []))).toEqual([
      [-150, 18],
      [-30, 18],
    ]);
    expect(JSON.stringify(document)).toBe(before);
  });

  it('retains rotated mirrored-copy ownership for edges and vertices', () => {
    const { document, source, target } = design();
    source.sketch = createPlateDocument({ width: 100, height: 20 }).parts[0]!.sketch;
    source.copies = [{ id: 'mirror', mirrored: true, placement: { position: [100, 20, 0], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] } }];
    target.drawnOn = { on: { plane: 'top' }, offset: 0 };
    const before = JSON.stringify(document),
      edge = { key: 'mirror-edge', partId: source.id, copyId: 'mirror', x1: 100, y1: 20, x2: 100, y2: -80, onPlane: true },
      frame = cadSketchFrame(document, target);
    const used = addUsedPartEdges(target.sketch, [edge], [edge.key], document, frame, target.id);
    expect(bound(used.sketch)).toHaveLength(2);
    expect(bound(used.sketch).every(reference => reference.partId === source.id && reference.copyId === 'mirror')).toBe(true);
    const vertex = addUsedPartEdges(target.sketch, [edge], [partVertices([edge])[0]!.key], document, frame, target.id);
    expect(bound(vertex.sketch)).toHaveLength(1);
    expect(bound(vertex.sketch)[0]).toMatchObject({ partId: source.id, copyId: 'mirror' });
    expect(JSON.stringify(document)).toBe(before);
  });

  it('refuses an unavailable authored endpoint instead of binding a coincident corner from a different part', () => {
    const { document, source, target } = design(),
      before = JSON.stringify(document),
      edge = { key: 'unavailable', partId: source.id, x1: 0, y1: 18, x2: 100, y2: 18, onPlane: true };
    const used = addUsedPartEdges(target.sketch, [edge], [edge.key], document, cadSketchFrame(document, target), target.id);
    expect(used.sketch).toBe(target.sketch);
    expect(used.selected).toEqual([]);
    expect('problem' in used && used.problem).toMatch(/source corners|linked/i);
    expect(JSON.stringify(document)).toBe(before);
  });

  it('refuses an ambiguous projected edge without adding unlinked geometry', () => {
    const { document, source, target } = design(),
      before = JSON.stringify(document),
      edge = { key: 'ambiguous', partId: source.id, x1: 0, y1: 18, x2: 120, y2: 18, onPlane: true, ambiguous: true };
    const used = addUsedPartEdges(target.sketch, [edge], [edge.key], document, cadSketchFrame(document, target), target.id);
    expect(used.sketch).toBe(target.sketch);
    expect('problem' in used && used.problem).toMatch(/more than one|ambiguous|overlap/i);
    expect(JSON.stringify(document)).toBe(before);
  });

  it('does not reuse a previously bound target point for another physical owner at the same location', () => {
    const { document, source, decoy, target } = design(),
      frame = cadSketchFrame(document, target),
      first = { key: 'first', partId: decoy.id, x1: 0, y1: 18, x2: 100, y2: 18, onPlane: true },
      second = { key: 'second', partId: source.id, x1: 0, y1: 18, x2: 120, y2: 18, onPlane: true };
    const one = addUsedPartEdges(target.sketch, [first], [first.key], document, frame, target.id);
    const two = addUsedPartEdges(one.sketch, [second], [second.key], document, frame, target.id);
    expect(bound(two.sketch).map(reference => reference.partId)).toEqual([decoy.id, decoy.id, source.id, source.id]);
    const original = JSON.stringify(one.sketch);
    source.thickness = 21;
    const moved = withUsedPoints(document, { ...target, sketch: two.sketch });
    expect(moved.entities.flatMap(entity => (entity.type === 'point' && entity.used ? [entity.y] : []))).toEqual([18, 18, 21, 21]);
    expect(JSON.stringify(one.sketch)).toBe(original);
  });
});
