import { describe, expect, it } from 'vitest';
import {
  addCopyFaceSketch,
  addPartCopy,
  addPartCut,
  addRectangle,
  cadPartReference,
  cadPartsToCut,
  cadSketchRegions,
  createCadPart,
  createPlateDocument,
  evaluateCadDocument,
  evaluatedPartCopy,
  parseCadDocument,
  polygonArea,
  setPartCopyOffset,
  addCopyTransform,
  orderedCadDocument,
  copyOperationPrefix,
  setPartPattern,
  updatePartCut,
  physicalCadView,
  cadFaceFrame,
  cadCornerSources,
  withUsedPoints,
  copyOperationSteps,
  rolledBackTo,
  updateCopyTransform,
  removeCopyTransform,
  solveCadDocument,
  createCadFolder,
  deleteCadFolder,
  addCircle,
  migrateLegacyCutsToOrdered,
  setCopyOperationOrder,
  type CadDocument,
  type CadPlacement,
  type EvaluatedCadPart,
} from './index';

type CopyTransform = NonNullable<CadDocument['copyTransforms']>[number];
type OrderedSource = Omit<CadDocument, 'version'> & {
  version: 4;
  copyTransforms: CopyTransform[];
  operationOrder: string[];
  legacyPartCutIds?: string[];
};
type Stage = ReturnType<typeof evaluateCadDocument> & { placements?: Record<string, CadPlacement>; available?: string[] };
const core = (source: OrderedSource) => source as unknown as CadDocument;
const stage = (source: OrderedSource, through?: string): Stage =>
  (evaluateCadDocument as unknown as (source: CadDocument, options?: { through?: string }) => Stage)(core(source), { through });

/** Actual occupied volume for these independently specified, disjoint rectangular notches. */
function volume(shape: EvaluatedCadPart) {
  const footprint = Math.abs(polygonArea(shape.outline)) - shape.holes.reduce((sum, hole) => sum + Math.abs(polygonArea(hole)), 0);
  return (
    footprint * shape.thickness -
    (shape.cuts ?? []).reduce(
      (sum, cut) =>
        sum +
        (Math.abs(polygonArea(cut.outline)) - cut.islands.reduce((area, island) => area + Math.abs(polygonArea(island)), 0)) *
          (cut.to - cut.from),
      0
    )
  );
}

function fixture() {
  let document = createPlateDocument({ width: 100, height: 60, thickness: 18 });
  const partId = document.parts[0]!.id;
  document.parts[0]!.name = 'Panel';
  document.parts[0]!.drawnOn = { on: { plane: 'top' }, offset: 0 };
  document.parts[0]!.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const copy = addPartCopy(document, partId, { offset: { position: [200, 0, 0], rotation: [0, 0, 0, 1] } });
  const sibling = addPartCopy(copy.document, partId, { offset: { position: [400, 0, 0], rotation: [0, 0, 0, 1] } });
  const face = addCopyFaceSketch(sibling.document, partId, copy.id, 'top');
  document = face.document;
  const family = document.parts[0]!,
    sketch = family.features!.find(feature => feature.type === 'sketch' && feature.sketch.id === face.sketchId)!;
  if (sketch.type !== 'sketch') throw Error('Missing own face sketch');
  sketch.sketch = addRectangle(sketch.sketch, { x: 60, y: 5, width: 10, height: 10 });
  const ownRegion = cadSketchRegions(family, face.sketchId).find(region => Math.abs(Math.abs(polygonArea(region.points)) - 100) < 1e-8)!;
  // Keep the setup on existing public APIs; only the ordered records below are the new contract.
  const ownCut = {
    id: 'own-notch',
    type: 'cut' as const,
    copyId: copy.id,
    sketchId: face.sketchId,
    regionId: ownRegion.id,
    depth: 'through' as const,
  };
  family.features!.push(ownCut);
  const tool = (name: string, x: number) => {
    const part = createCadPart(name, 18);
    part.sketch = addRectangle(part.sketch, { x, y: 0, width: 10, height: 20 });
    part.drawnOn = { on: { plane: 'top' }, offset: 0 };
    part.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    return part;
  };
  const a = tool('Knife A', 200),
    b = tool('Knife B', 330);
  document.parts.push(a, b);
  const reference = cadPartReference(partId, copy.id);
  const cutA = addPartCut(document, [a.id], [reference], { value: 0 });
  const cutB = addPartCut(cutA.document, [b.id], [reference], { value: 0 });
  const move: CopyTransform = { id: 'move-selected', partId, copyId: copy.id, by: [100, 0, 0] };
  const source: OrderedSource = { ...cutB.document, version: 4, copyTransforms: [move], operationOrder: [cutA.id, move.id, cutB.id] };
  return { document, source, partId, copyId: copy.id, siblingId: sibling.id, reference, cutA: cutA.id, cutB: cutB.id, move };
}

const physical = (result: Stage, source: OrderedSource, partId: string, copyId?: string) => {
  const part = result.parts.find(part => part.partId === partId)!;
  if (!part) throw Error(JSON.stringify(result.diagnostics));
  return copyId ? evaluatedPartCopy(part, source.parts.find(part => part.id === partId)!.copies!.find(copy => copy.id === copyId)!) : part;
};

describe('ordered physical-copy transforms', () => {
  it('proves neither legacy all-cuts-first nor all-poses-first produces the required two notches', () => {
    const f = fixture();
    const legacy: CadDocument = { ...f.document, partCuts: f.source.partCuts };
    const allCutsFirst = evaluateCadDocument(legacy);
    const movedFirst = setPartCopyOffset(legacy, f.partId, f.copyId, { offset: { position: [300, 0, 0], rotation: [0, 0, 0, 1] } });
    const allPosesFirst = evaluateCadDocument(movedFirst);
    expect(volume(physical(allCutsFirst, f.source, f.partId, f.copyId))).toBe(102600);
    expect(volume(physical(allPosesFirst, f.source, f.partId, f.copyId))).toBe(102600);
    expect(physical(allCutsFirst, f.source, f.partId, f.copyId).cuts?.some(cut => cut.id.startsWith(`cut-parts:${f.cutA}:`))).toBe(true);
    expect(physical(allCutsFirst, f.source, f.partId, f.copyId).cuts?.some(cut => cut.id.startsWith(`cut-parts:${f.cutB}:`))).toBe(false);
    expect(physical(allPosesFirst, f.source, f.partId, f.copyId).cuts?.some(cut => cut.id.startsWith(`cut-parts:${f.cutA}:`))).toBe(false);
    expect(physical(allPosesFirst, f.source, f.partId, f.copyId).cuts?.some(cut => cut.id.startsWith(`cut-parts:${f.cutB}:`))).toBe(true);
  });
  it('carries Cut A and an own notch with the copy, then applies Cut B at the moved pose', () => {
    const f = fixture(),
      before = JSON.stringify(f.source);
    const opening = evaluateCadDocument(f.document);
    expect(volume(physical(opening, f.source, f.partId, f.copyId))).toBe(100 * 60 * 18 - 10 * 10 * 18);
    const result = stage(f.source);
    // Moving before all cuts loses A; moving after all cuts loses B. Both notches must remain in local material.
    expect(volume(physical(result, f.source, f.partId, f.copyId))).toBe(100 * 60 * 18 - 10 * 10 * 18 - 2 * 10 * 20 * 18);
    expect(volume(physical(result, f.source, f.partId))).toBe(100 * 60 * 18);
    expect(volume(physical(result, f.source, f.partId, f.siblingId))).toBe(100 * 60 * 18);
    expect(result.placements?.[f.reference]?.position).toEqual([300, 0, 0]);
    expect(result.placements?.[cadPartReference(f.partId, f.siblingId)]?.position).toEqual([400, 0, 0]);
    expect(JSON.stringify(f.source)).toBe(before);
    expect(stage(f.source)).toEqual(result);
    expect(
      cadPartsToCut(core(f.source), result.parts)
        .flatMap(group => group.names)
        .sort()
    ).toEqual(['Knife A', 'Knife B', 'Panel', 'Panel 2', 'Panel 3']);
  });

  it('returns rollback prefixes from the same material and pose stream', () => {
    const f = fixture(),
      afterA = stage(f.source, f.cutA),
      afterMove = stage(f.source, f.move.id),
      afterB = stage(f.source, f.cutB);
    expect(volume(physical(afterA, f.source, f.partId, f.copyId))).toBe(100 * 60 * 18 - 10 * 10 * 18 - 10 * 20 * 18);
    expect(afterA.placements?.[f.reference]?.position).toEqual([200, 0, 0]);
    expect(volume(physical(afterMove, f.source, f.partId, f.copyId))).toBe(volume(physical(afterA, f.source, f.partId, f.copyId)));
    expect(afterMove.placements?.[f.reference]?.position).toEqual([300, 0, 0]);
    expect(volume(physical(afterB, f.source, f.partId, f.copyId))).toBe(99000);
    expect(copyOperationSteps(core(f.source)).map(step => [step.id, step.kind])).toEqual([
      [f.cutA, 'partCut'],
      [f.move.id, 'copyTransform'],
      [f.cutB, 'partCut'],
    ]);
    const prefix = rolledBackTo(core(f.source), f.move.id);
    expect(evaluateCadDocument(prefix)).toEqual(afterMove);
    expect(parseCadDocument(JSON.parse(JSON.stringify(prefix))).operationOrder).toEqual([f.cutA, f.move.id]);
  });

  it('requires reader version 4 and round-trips operation/reference identities', () => {
    const f = fixture(),
      loaded = parseCadDocument(JSON.parse(JSON.stringify(f.source))) as unknown as OrderedSource;
    expect(loaded.copyTransforms).toEqual([f.move]);
    expect(loaded.operationOrder).toEqual([f.cutA, f.move.id, f.cutB]);
    for (const version of [1, 2, 3]) expect(() => parseCadDocument({ ...f.source, version })).toThrow(/version|reader|transform/i);
  });
});

describe('physical-copy availability and legacy upgrade', () => {
  it('retains the operation/reference through pattern3→2→3 and reload without a ghost CAM copy', () => {
    let document = createPlateDocument({ width: 100, height: 60, thickness: 18 });
    const partId = document.parts[0]!.id;
    document.parts[0]!.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    document = setPartPattern(document, partId, { count: 3, axis: 'x', spacing: 200 });
    const copyId = document.parts[0]!.copies![1]!.id,
      reference = cadPartReference(partId, copyId);
    const added = addCopyTransform(document, partId, copyId, { by: [0, 0, 50] });
    const original = JSON.stringify(added.document.copyTransforms);
    const changed = (count: number) => setPartPattern(added.document, partId, { count, axis: 'x', spacing: 200 });
    const shrunk = parseCadDocument(JSON.parse(JSON.stringify(changed(2)))),
      absent = evaluateCadDocument(shrunk);
    expect(absent.diagnostics).toContainEqual(expect.objectContaining({ code: 'copy-transform-target-missing' }));
    expect(absent.available).not.toContain(reference);
    expect(absent.placements).not.toHaveProperty(reference);
    expect(cadPartsToCut(shrunk, absent.parts, absent).flatMap(group => group.names)).toHaveLength(2);
    expect(JSON.stringify(shrunk.copyTransforms)).toBe(original);
    const restored = parseCadDocument(JSON.parse(JSON.stringify(setPartPattern(shrunk, partId, { count: 3, axis: 'x', spacing: 200 })))),
      result = evaluateCadDocument(restored);
    expect(restored.parts[0]!.copies![1]!.id).toBe(copyId);
    expect(result.placements?.[reference]?.position).toEqual([400, 0, 50]);
    expect(JSON.stringify(restored.copyTransforms)).toBe(original);
    expect(cadPartsToCut(restored, result.parts, result).flatMap(group => group.names)).toHaveLength(3);
    expect(restored.parts[0]!.copies![1]!.placement!.position).toEqual([400, 0, 0]);
  });

  it('checks consumption at its stage, including historical CAM before a later consume', () => {
    const f = fixture();
    const receiver = createCadPart('Receiver', 18);
    receiver.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    receiver.sketch = addRectangle(receiver.sketch, { x: 0, y: 30, width: 500, height: 10 });
    f.source.parts.push(receiver);
    const consumed = addPartCut(core(f.source), [f.partId], [receiver.id], { value: 0 });
    const document = updatePartCut(consumed.document, consumed.id, { consumeTools: true });
    const before = evaluateCadDocument(document, { through: f.move.id }),
      after = evaluateCadDocument(document);
    expect(before.placements?.[f.reference]?.position).toEqual([300, 0, 0]);
    expect(cadPartsToCut(document, before.parts, before).flatMap(group => group.names)).toContain('Panel 2');
    const visible = physicalCadView(document, before);
    expect(cadPartsToCut(visible.document, visible.parts).flatMap(group => group.names)).toContain('Panel 2');
    expect(volume(after.parts.find(part => part.partId === receiver.id)!)).toBe(500 * 10 * 18 - 3 * 100 * 10 * 18);
    expect(after.available).not.toContain(f.reference);
    expect(cadPartsToCut(document, after.parts, after).flatMap(group => group.names)).not.toContain('Panel 2');
    const consumedView = physicalCadView(document, after);
    expect(cadPartsToCut(consumedView.document, consumedView.parts).flatMap(group => group.names)).not.toContain('Panel 2');
    expect(consumedView.parts.some(part => part.partId === f.partId)).toBe(false);
    const reordered = { ...document, operationOrder: [f.cutA, consumed.id, f.move.id, f.cutB] };
    const missing = evaluateCadDocument(reordered);
    expect(missing.diagnostics).toContainEqual(expect.objectContaining({ code: 'copy-transform-target-missing' }));
    expect(missing.placements).not.toHaveProperty(f.reference);
    expect(() => addCopyTransform(document, f.partId, f.copyId, { by: [1, 0, 0] })).toThrow(/available/);
  });

  it('preserves legacy fixed-tool material on append while fresh ordered documents inherit earlier cuts', () => {
    let document = createPlateDocument({ width: 100, height: 60, thickness: 18 });
    const panel = document.parts[0]!;
    panel.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    const knife = createCadPart('Knife', 18),
      receiver = createCadPart('Receiver', 18),
      spare = createCadPart('Spare', 18);
    for (const part of [knife, receiver, spare]) part.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    knife.sketch = addRectangle(knife.sketch, { x: 0, y: 0, width: 10, height: 20 });
    receiver.sketch = addRectangle(receiver.sketch, { x: 0, y: 0, width: 100, height: 60 });
    spare.sketch = addRectangle(spare.sketch, { x: 1000, y: 0, width: 10, height: 10 });
    document.parts.push(knife, receiver, spare);
    const copy = addPartCopy(document, spare.id, { offset: { position: [0, 100, 0], rotation: [0, 0, 0, 1] } });
    document = copy.document;
    const a = addPartCut(document, [knife.id], [panel.id], { value: 0 });
    const b = addPartCut(a.document, [panel.id], [receiver.id], { value: 0 });
    const baseline = evaluateCadDocument(b.document),
      upgraded = addCopyTransform(b.document, spare.id, copy.id, { by: [0, 0, 50] }).document;
    const result = evaluateCadDocument(upgraded);
    expect(upgraded.legacyPartCutIds).toEqual([a.id, b.id]);
    expect(result.parts).toEqual(baseline.parts);
    expect(cadPartsToCut(upgraded, result.parts, result)).toEqual(cadPartsToCut(b.document, baseline.parts));
    expect(volume(result.parts.find(part => part.partId === receiver.id)!)).toBe(0);
    const fresh = orderedCadDocument(b.document),
      ordered = evaluateCadDocument(fresh);
    expect(fresh.legacyPartCutIds).toBeUndefined();
    const migrated = migrateLegacyCutsToOrdered(upgraded);
    expect(migrated.legacyPartCutIds).toBeUndefined();
    expect(migrated.operationOrder).toEqual(upgraded.operationOrder);
    expect(volume(evaluateCadDocument(migrated).parts.find(part => part.partId === receiver.id)!)).toBe(10 * 20 * 18);
    expect(() => setCopyOperationOrder(upgraded, [upgraded.operationOrder!.at(-1)!, a.id, b.id])).toThrow(/prefix/);
    expect(volume(ordered.parts.find(part => part.partId === receiver.id)!)).toBe(10 * 20 * 18);
    const loaded = parseCadDocument(JSON.parse(JSON.stringify(upgraded)));
    expect(evaluateCadDocument(loaded)).toEqual(result);
    const prefix = copyOperationPrefix(upgraded, a.id),
      first = evaluateCadDocument(prefix);
    expect(volume(first.parts.find(part => part.partId === receiver.id)!)).toBe(100 * 60 * 18);
    expect(prefix.operationOrder).toEqual([a.id]);
  });
});

it('projects one moved copy consistently for finite face frames and used corners without saving its final pose', () => {
  const f = fixture();
  f.source.copyTransforms[0] = { ...f.move, by: [100, 10, 5], turn: { about: [200, 0, 0], axis: [0, 0, 1], degrees: 90 } };
  f.source.partCuts = [];
  f.source.operationOrder = [f.move.id];
  const before = JSON.stringify(f.source),
    result = stage(f.source),
    view = physicalCadView(core(f.source), result);
  const frame = cadFaceFrame(view.document, { partId: f.partId, copyId: f.copyId, face: 'top' });
  expect(frame).not.toHaveProperty('error');
  if ('error' in frame) throw Error(frame.error);
  expect(frame.origin).toEqual([300, 10, 23]);
  expect(frame.x).toEqual([0, 1, 0]);
  expect(frame.normal).toEqual([0, 0, 1]);
  const world = {
    origin: [0, 0, 0] as [number, number, number],
    x: [1, 0, 0] as [number, number, number],
    y: [0, 1, 0] as [number, number, number],
    normal: [0, 0, 1] as [number, number, number],
  };
  const corners = cadCornerSources(view.document, world);
  const source = corners.get('300,10')!;
  expect(source).toEqual(expect.objectContaining({ partId: f.partId, copyId: f.copyId }));
  const target = createCadPart('Used corner', 18);
  target.drawnOn = { on: { plane: 'top' }, offset: 0 };
  target.sketch.entities.push({ type: 'point', id: 'used-reference', x: -1, y: -1, used: source });
  const sketch = withUsedPoints({ ...view.document, parts: [...view.document.parts, target] }, target);
  expect(sketch.entities.find(entity => entity.id === 'used-reference')).toEqual(expect.objectContaining({ x: 300, y: 10, used: source }));
  expect(JSON.stringify(f.source)).toBe(before);
  expect(f.source.parts[0]!.copies![0]!.placement!.position).toEqual([200, 0, 0]);
});

it('moves an absolute placement copy without rewriting or reusing its creation offset', async () => {
  const document = createPlateDocument({ width: 100, height: 60, thickness: 18 });
  const partId = document.parts[0]!.id;
  document.parts[0]!.copies = [{ id: 'absolute', placement: { position: [70, 80, 90], rotation: [0, 0, 0, 1] } }];
  const added = addCopyTransform(document, partId, 'absolute', {
    by: [1, 2, 3],
    turn: { about: [70, 80, 90], axis: [0, 0, 1], degrees: 90 },
  });
  const reference = cadPartReference(partId, 'absolute'),
    opening = JSON.stringify(added.document);
  const solved = await solveCadDocument(added.document);
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(solved.placements?.[reference]?.position).toEqual([71, 82, 93]);
  expect(solved.placements?.[reference]?.rotation).toEqual([0, 0, Math.SQRT1_2, Math.SQRT1_2]);
  expect(solved.document.parts[0]!.copies![0]!.placement!.position).toEqual([70, 80, 90]);
  expect(JSON.stringify(added.document)).toBe(opening);
  const reloaded = await solveCadDocument(parseCadDocument(JSON.parse(JSON.stringify(solved.document))));
  expect(reloaded.placements).toEqual(solved.placements);
  const edited = updateCopyTransform(solved.document, added.id, { by: [4, 5, 6] });
  expect(evaluateCadDocument(edited).placements?.[reference]?.position).toEqual([74, 85, 96]);
  const suppressed = updateCopyTransform(edited, added.id, { suppressed: true });
  expect(evaluateCadDocument(suppressed).placements?.[reference]?.position).toEqual([70, 80, 90]);
  const removed = removeCopyTransform(edited, added.id);
  expect(removed.operationOrder).toEqual([]);
  expect(evaluateCadDocument(removed).placements?.[reference]?.position).toEqual([70, 80, 90]);
});

it('keeps folder deletion and generation rollback coherent with the explicit operation stream', () => {
  const f = fixture();
  f.source.legacyPartCutIds = [f.cutA];
  const folder = createCadFolder(core(f.source), { name: 'First cut', partIds: [], partCutIds: [f.cutA] });
  if ('error' in folder) throw Error(folder.error);
  const deleted = deleteCadFolder(folder.document, folder.id);
  if ('error' in deleted) throw Error(deleted.error);
  const loaded = parseCadDocument(JSON.parse(JSON.stringify(deleted.document)));
  expect(loaded.operationOrder).toEqual([f.move.id, f.cutB]);
  expect(loaded.legacyPartCutIds).toEqual([]);
  expect(volume(physical(evaluateCadDocument(loaded), f.source, f.partId, f.copyId))).toBe(102600);
  expect(rolledBackTo(core(f.source), 'removed-history-target')).toBe(f.source);
  const generation = rolledBackTo(core(f.source), `${f.partId}:extrude`);
  expect(generation.operationOrder).toEqual([]);
  expect(generation.copyTransforms).toEqual([]);
  expect(evaluateCadDocument(generation).diagnostics.filter(d => d.severity === 'error')).toEqual([]);
});

it('carries curved material through a rigid move without decomposing or filling its holes', () => {
  let document = createPlateDocument({ width: 100, height: 60, thickness: 18 });
  const part = document.parts[0]!;
  part.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  part.sketch = addCircle(part.sketch, { x: 40, y: 30, radius: 10 });
  const copy = addPartCopy(document, part.id, { offset: { position: [200, 0, 0], rotation: [0, 0, 0, 1] } });
  document = copy.document;
  const before = evaluateCadDocument(document);
  expect(before.parts[0]!.holes).toHaveLength(1);
  const moved = addCopyTransform(document, part.id, copy.id, {
    by: [10, 20, 30],
    turn: { about: [200, 0, 0], axis: [1, 1, 1], degrees: 37 },
  }).document;
  const after = evaluateCadDocument(moved);
  expect(after.parts).toEqual(before.parts);
  expect(after.diagnostics).toEqual([]);
});

it('reports intersecting nonrectilinear tool voids instead of cutting their bounding stock', () => {
  const document = createPlateDocument({ width: 100, height: 60, thickness: 18 }),
    tool = document.parts[0]!;
  tool.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  tool.sketch = addCircle(tool.sketch, { x: 40, y: 30, radius: 10 });
  const receiver = createCadPart('Receiver', 18);
  receiver.sketch = addRectangle(receiver.sketch, { x: 0, y: 0, width: 100, height: 60 });
  receiver.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  document.parts.push(receiver);
  const cut = addPartCut(orderedCadDocument(document), [tool.id], [receiver.id], { value: 0 });
  const result = evaluateCadDocument(cut.document);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'part-cut-unresolved', message: expect.stringContaining('nonrectilinear occupied-material boundary') })
  );
  expect(volume(result.parts.find(part => part.partId === receiver.id)!)).toBe(100 * 60 * 18);
});
