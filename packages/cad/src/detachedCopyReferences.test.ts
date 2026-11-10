import { describe, expect, it } from 'vitest';
import {
  addPartCopy,
  addPartMirror,
  cadFaceFrame,
  cadSketchFrame,
  createCadDocument,
  createPlateDocument,
  detachPartCopy,
  parseCadDocument,
  resolveDrawnPlacements,
  resolvePartPatterns,
  setCadVariable,
  setPartPattern,
  solveCadDocument,
  withUsedPoints,
  type CadDocument,
  type CadPart,
  type CadPointEntity,
} from './index';

const panel = (name: string, width = 20, height = 15): CadPart => ({
  ...createPlateDocument({ width, height, thickness: 5 }).parts[0]!,
  name,
  drawnOn: { on: { plane: 'top' }, offset: 0 },
});

function supportedShelving() {
  const shelf = panel('Shelf', 100, 60);
  let document = resolveDrawnPlacements({ ...createCadDocument('Shelving and dependent steps'), parts: [shelf] }).document;
  document = setPartPattern(document, shelf.id, { axis: 'z', count: 3, spacing: 100 });
  const copyId = document.parts[0]!.copies![0]!.id;
  const right = shelf.sketch.entities.find(
    entity =>
      entity.type === 'line' &&
      shelf.sketch.entities.some(point => point.type === 'point' && point.id === entity.startId && point.x === 100 && point.y === 0)
  )!;
  if (right.type !== 'line') throw new Error('No right edge');
  const on = { partId: shelf.id, copyId, face: 'top' as const };
  const edge = { ...on, face: { edge: right.id } };
  const cap = { ...panel('Cap'), drawnOn: { on, offset: 0 } };
  const side = { ...panel('Side'), drawnOn: { on: edge, offset: 0 } };
  const used = panel('Used corner');
  used.drawnOn = { on: { plane: 'front' }, offset: 0 };
  used.sketch.entities.push({
    id: 'used-corner',
    type: 'point',
    x: 100,
    y: 105,
    fixed: true,
    construction: true,
    used: { partId: shelf.id, copyId, pointId: right.startId, side: 'top' },
  });
  const move = { ...panel('Moved by edge'), moved: { along: edge, distance: 12 } };
  const pattern = {
    ...panel('Pattern by edge'),
    pattern: { id: 'child-pattern', axis: 'z' as const, direction: { along: edge }, count: 2, spacing: 25 },
  };
  const upto = { ...panel('Up to shelf'), upTo: on };
  const datum = { ...panel('On offset plane'), drawnOn: { on, offset: 10, datum: 'copy-plane' } };
  document = {
    ...document,
    parts: [...document.parts, cap, side, used, move, pattern, upto, datum],
    planes: [{ id: 'copy-plane', name: 'Above shelf', on, offset: 10, offsetExpression: 'gap' }],
  };
  const variable = setCadVariable(document, { name: 'gap', expression: '10 mm' });
  if ('error' in variable) throw new Error(variable.error);
  document = variable.document;
  const transformed = addPartCopy(document, move.id);
  document = transformed.document;
  document.parts.find(part => part.id === move.id)!.copies![0]!.along = { along: edge, distance: 20, distanceExpression: 'gap * 2' };
  const mirror = addPartMirror(document, cap.id, { across: on });
  document = resolvePartPatterns(mirror.document);
  document.partCuts = [{ id: 'copy-tool', tools: [`${shelf.id}:${copyId}`], targets: [used.id], clearance: 0 }];
  return { document, sourceId: shelf.id, copyId, rightId: right.id, pointId: right.startId, mirrorId: mirror.id };
}

describe('detaching copy reference integration', () => {
  it('preserves a complete shelving design’s face, edge, vertex, datum, direction, mirror and up-to references', async () => {
    const initial = supportedShelving();
    const before = await solveCadDocument(initial.document);
    expect(before.status, JSON.stringify(before.diagnostics)).toBe('solved');
    const snapshot = JSON.stringify(before.document);
    const detached = detachPartCopy(before.document, initial.sourceId, initial.copyId, 'Independent shelf');
    if ('error' in detached) throw new Error(detached.error);
    expect(JSON.stringify(before.document)).toBe(snapshot);
    const source = detached.document.parts.find(part => part.id === detached.partId)!;
    const right = source.sketch.entities.find(
      entity =>
        entity.type === 'line' &&
        source.sketch.entities.some(point => point.type === 'point' && point.id === entity.startId && point.x === 100 && point.y === 0)
    )!;
    if (right.type !== 'line') throw new Error('No detached right edge');
    expect(right.id).not.toBe(initial.rightId);
    expect(detached.document.parts.find(part => part.name === 'Side')!.drawnOn!.on).toEqual({
      partId: source.id,
      face: { edge: right.id },
    });
    const used = detached.document.parts
      .find(part => part.name === 'Used corner')!
      .sketch.entities.find(entity => entity.id === 'used-corner') as CadPointEntity;
    expect(used.used).toEqual({ partId: source.id, pointId: right.startId, side: 'top' });
    expect(detached.document.planes![0]!.on).toEqual({ partId: source.id, face: 'top' });
    expect(detached.document.parts.find(part => part.name === 'Up to shelf')!.upTo).toEqual({ partId: source.id, face: 'top' });
    expect(detached.document.parts.find(part => part.name === 'Moved by edge')!.moved).toEqual({
      along: { partId: source.id, face: { edge: right.id } },
      distance: 12,
    });
    expect(detached.document.parts.find(part => part.name === 'Pattern by edge')!.pattern!.direction!.along).toEqual({
      partId: source.id,
      face: { edge: right.id },
    });
    expect(
      detached.document.parts.find(part => part.name === 'Cap')!.copies!.find(copy => copy.id === initial.mirrorId)!.mirror!.across
    ).toEqual({ partId: source.id, face: 'top' });
    expect(detached.document.parts.find(part => part.name === 'Moved by edge')!.copies![0]!.along!.distanceExpression).toBe('gap * 2');
    expect(detached.document.variables).toEqual(before.document.variables);
    expect(detached.document.partCuts![0]!.tools).toEqual([source.id]);

    const solved = await solveCadDocument(parseCadDocument(JSON.parse(JSON.stringify(detached.document))));
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    for (const original of before.document.parts.filter(part => part.id !== initial.sourceId)) {
      const current = solved.document.parts.find(part => part.id === original.id)!;
      expect(current.placement, current.name).toEqual(original.placement);
      expect(current.thickness, current.name).toBe(original.thickness);
      expect(
        current.copies?.map(copy => copy.placement),
        current.name
      ).toEqual(original.copies?.map(copy => copy.placement));
    }
    const sameTop = cadFaceFrame(solved.document, { partId: source.id, face: 'top' });
    expect(sameTop).toEqual(cadFaceFrame(before.document, { partId: initial.sourceId, copyId: initial.copyId, face: 'top' }));

    // The detached board can now move and reshape independently, and the rebound used corner still follows it.
    const moved: CadDocument = {
      ...solved.document,
      parts: solved.document.parts.map(part =>
        part.id === source.id ? { ...part, placement: { ...part.placement!, position: [0, 0, 150] } } : part
      ),
    };
    const target = moved.parts.find(part => part.name === 'Used corner')!;
    expect(cadSketchFrame(moved, target)).toBeTruthy();
    expect(withUsedPoints(moved, target).entities.find(entity => entity.id === 'used-corner')).toMatchObject({ x: 100, y: 155 });
    const grown = setPartPattern(moved, initial.sourceId, { axis: 'z', count: 4, spacing: 300 });
    const latest = await solveCadDocument(grown);
    expect(latest.status, JSON.stringify(latest.diagnostics)).toBe('solved');
    expect(latest.document.parts.find(part => part.name === 'Cap')!.placement!.position[2]).toBe(155);
    expect(latest.document.parts[0]!.copies!.some(copy => copy.id === initial.copyId)).toBe(false);
  });

  it.each(['top', 'edge', 'corner'] as const)(
    'refuses a mirrored snapshot with an external %s reference without changing its source',
    kind => {
      const source = panel('Mirrored shelf', 100, 60);
      const placed = resolveDrawnPlacements({ ...createCadDocument(), parts: [source] }).document;
      const mirrored = addPartCopy(placed, source.id, { mirrored: true, offset: { position: [200, 0, 0], rotation: [0, 0, 0, 1] } });
      const line = source.sketch.entities.find(entity => entity.type === 'line')!;
      if (line.type !== 'line') throw new Error('No source line');
      const child = panel('Dependent');
      if (kind === 'corner')
        child.sketch.entities.push({
          id: 'used-mirror',
          type: 'point',
          x: 200,
          y: 5,
          fixed: true,
          used: { partId: source.id, copyId: mirrored.id, pointId: line.startId, side: 'top' },
        });
      else child.drawnOn = { on: { partId: source.id, copyId: mirrored.id, face: kind === 'edge' ? { edge: line.id } : 'top' }, offset: 0 };
      const document = { ...mirrored.document, parts: [...mirrored.document.parts, child] };
      const snapshot = JSON.stringify(document);
      expect(detachPartCopy(document, source.id, mirrored.id)).toEqual({
        error: 'This mirrored copy has a face or corner reference. Remove those references before detaching it.',
      });
      expect(JSON.stringify(document)).toBe(snapshot);
    }
  );
  it('refuses a reference to a joined body inherited by the detached copy without changing its source', () => {
    const source = panel('Shelf', 100, 60);
    let document = resolveDrawnPlacements({ ...createCadDocument(), parts: [source] }).document;
    document = setPartPattern(document, source.id, { axis: 'z', count: 2, spacing: 100 });
    const copyId = document.parts[0]!.copies![0]!.id;
    const boss = { ...panel('Joined block'), addTo: source.id, drawnOn: { on: { partId: source.id, face: 'top' as const }, offset: 0 } };
    const target = panel('Mirror target');
    document = resolveDrawnPlacements({ ...document, parts: [...document.parts, boss, target] }).document;
    document = addPartMirror(document, target.id, { across: { partId: boss.id, copyId, face: 'top' } }).document;
    const snapshot = JSON.stringify(document);
    expect(detachPartCopy(document, source.id, copyId)).toEqual({
      error: 'This copy has a reference to a joined body on it. Remove that reference before detaching the copy.',
    });
    expect(JSON.stringify(document)).toBe(snapshot);
  });
});
