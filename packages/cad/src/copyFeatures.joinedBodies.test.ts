import { describe, expect, it } from 'vitest';
import {
  addPartCopy,
  addCircle,
  createCadPart,
  createCadFolder,
  createPlateDocument,
  detachPartCopy,
  isJoinedBody,
  parseCadDocument,
  resolveDrawnPlacements,
  resolveExtrudeSteps,
  setCadFolderSuppressed,
  solveCadDocument,
  type CadDocument,
} from './index';

function joinedCopy(mirrored: boolean) {
  const initial = createPlateDocument({ width: 100, height: 60, thickness: 18 });
  const source = initial.parts[0]!;
  source.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const copied = addPartCopy(initial, source.id, { mirrored, offset: { position: [200, 0, 0], rotation: [0, 0, 0, 1] } });
  const boss = createPlateDocument({ width: 20, height: 20, thickness: 5 }).parts[0]!;
  boss.name = 'Joined boss';
  boss.addTo = source.id;
  boss.drawnOn = { on: { partId: source.id, face: 'top' }, offset: 0 };
  const child = createPlateDocument({ width: 10, height: 10, thickness: 3 }).parts[0]!;
  child.name = 'Joined child';
  child.addTo = boss.id;
  child.drawnOn = { on: { partId: boss.id, face: 'top' }, offset: 0 };
  return {
    document: resolveDrawnPlacements({ ...copied.document, parts: [...copied.document.parts, boss, child] }).document,
    sourceId: source.id,
    copyId: copied.id,
    bossId: boss.id,
  };
}

describe('detaching copies of joined bodies', () => {
  it.each([false, true])('refuses to lose active Add bodies atomically (mirrored copy: %s)', mirrored => {
    const { document, sourceId, copyId, bossId } = joinedCopy(mirrored);
    expect(isJoinedBody(document, document.parts.find(part => part.id === bossId)!)).toBe(true);
    const before = JSON.stringify(document);
    expect(detachPartCopy(document, sourceId, copyId)).toEqual({
      error: 'This part has active joined bodies. Suppress or remove those Add steps before detaching a copy.',
    });
    expect(JSON.stringify(document)).toBe(before);
  });

  it.each([
    [false, 'suppressed'],
    [true, 'suppressed'],
    [false, 'sketch'],
    [true, 'sketch'],
    [false, 'folder'],
    [true, 'folder'],
  ] as const)('allows the current plain geometry when Add bodies are inactive (mirrored: %s, %s)', (mirrored, inactive) => {
    const fixture = joinedCopy(mirrored);
    let document: CadDocument = fixture.document;
    if (inactive === 'folder') {
      const folder = createCadFolder(document, { name: 'Inactive additions', partIds: document.parts.slice(1).map(part => part.id) });
      if ('error' in folder) throw new Error(folder.error);
      const suppressed = setCadFolderSuppressed(folder.document, folder.id, true);
      if ('error' in suppressed) throw new Error(suppressed.error);
      document = suppressed.document;
    } else {
      document = {
        ...document,
        parts: document.parts.map(part =>
          part.id === fixture.sourceId ? part : inactive === 'suppressed' ? { ...part, suppressed: true } : { ...part, extrude: false }
        ),
      };
    }
    const before = JSON.stringify(document);
    const detached = detachPartCopy(document, fixture.sourceId, fixture.copyId);
    if ('error' in detached) throw new Error(detached.error);
    expect(JSON.stringify(document)).toBe(before);
    expect(detached.document.parts.some(part => part.id === detached.partId)).toBe(true);
    expect(detached.document.parts.find(part => part.id === fixture.sourceId)!.copies?.some(copy => copy.id === fixture.copyId)).toBe(
      false
    );
    for (const addition of document.parts.slice(1)) expect(detached.document.parts.find(part => part.id === addition.id)).toEqual(addition);
  });

  it('retains a derived Extrude Remove pocket as ordinary features on the detached board after reload', async () => {
    let document = createPlateDocument({ width: 200, height: 100, thickness: 18 });
    const board = document.parts[0]!;
    board.drawnOn = { on: { plane: 'top' }, offset: 0 };
    const pocket = createCadPart('Pocket');
    pocket.drawnOn = { on: { partId: board.id, face: 'top' }, offset: 0 };
    pocket.remove = { depth: 6 };
    pocket.sketch = addCircle(pocket.sketch, { x: 50, y: 40, radius: 10, dimensioned: true, positioned: true });
    document = resolveExtrudeSteps({ ...document, parts: [...document.parts, pocket] });
    expect(document.parts[0]!.features!.every(feature => feature.removedBy === pocket.id)).toBe(true);
    const copied = addPartCopy(document, board.id, { offset: { position: [300, 0, 0], rotation: [0, 0, 0, 1] } });
    const detached = detachPartCopy(copied.document, board.id, copied.id);
    if ('error' in detached) throw new Error(detached.error);
    const own = detached.document.parts.find(part => part.id === detached.partId)!;
    expect(own.features).toHaveLength(2);
    expect(own.features!.every(feature => feature.removedBy === undefined)).toBe(true);
    const solved = await solveCadDocument(parseCadDocument(JSON.parse(JSON.stringify(detached.document))));
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.document.parts.find(part => part.id === detached.partId)!.features!.map(feature => feature.id)).toEqual(
      own.features!.map(feature => feature.id)
    );
    expect(solved.parts.find(part => part.partId === detached.partId)!.cuts!.map(cut => [cut.from, cut.to])).toEqual([[0, 6]]);
  });
});
