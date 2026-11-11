import { expect, it } from 'vitest';
import {
  addCopyTransform,
  addPhysicalTransform,
  copyOperationPrefix,
  copyOperationSteps,
  evaluateCadDocument,
  cadPartsToCut,
  parseCadDocument,
  physicalCadView,
  setCadVariable,
  solveCadDocument,
  type CadPhysicalTarget,
} from './index';
import { notchedSeedSource } from './physicalSeedTransforms.testFixtures';

it('requires an explicit physical target and keeps the old creation command copy-only', () => {
  const f = notchedSeedSource(),
    source = copyOperationPrefix(f.source),
    bytes = JSON.stringify(source);
  const seed = addPhysicalTransform(source, { kind: 'seed', partId: f.partId }, { by: [0, 25, 0] });
  expect(seed.document.copyTransforms![0]).toEqual({ id: seed.id, partId: f.partId, seed: true, by: [0, 25, 0] });
  expect(seed.document.version).toBe(4);
  expect(evaluateCadDocument(seed.document).placements![f.partId]!.position).toEqual([0, 25, 0]);
  expect(copyOperationSteps(seed.document)[0]).toMatchObject({ id: seed.id, target: { kind: 'seed', partId: f.partId } });
  const copyId = source.parts[0]!.copies![0]!.id;
  const copy = addCopyTransform(source, f.partId, copyId, { by: [0, 25, 0] });
  expect(copy.document.copyTransforms![0]).toEqual({ id: copy.id, partId: f.partId, copyId, by: [0, 25, 0] });
  expect(copy.document.copyTransforms![0]).not.toHaveProperty('seed');
  expect(() => addCopyTransform(source, f.partId, undefined as unknown as string, { by: [0, 25, 0] })).toThrow(/target|copy/);
  for (const target of [
    { partId: f.partId },
    { kind: 'family', partId: f.partId },
    { kind: 'copy', partId: f.partId },
    { kind: 'seed', partId: f.partId, copyId },
    { kind: 'seed', partId: '' },
  ])
    expect(() => addPhysicalTransform(source, target as CadPhysicalTarget, { by: [0, 25, 0] })).toThrow(/target/);
  expect(() => addPhysicalTransform(source, { kind: 'seed', partId: f.childId }, { by: [0, 25, 0] })).toThrow(/independent|joined/);
  expect(JSON.stringify(source)).toBe(bytes);
});

it('blocks machining an entire saved compound move when an available component is unplaced, and restores it without replacing IDs', async () => {
  const f = notchedSeedSource(),
    source = f.source,
    child = source.parts.find(part => part.id === f.childId)!;
  const unplaced = { ...source, parts: source.parts.map(part => (part.id === child.id ? { ...part, placement: undefined } : part)) };
  const result = evaluateCadDocument(unplaced);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'physical-transform-component-unplaced', severity: 'error', partId: f.partId })
  );
  expect(result.parts).toEqual([]);
  expect(cadPartsToCut(unplaced, result.parts)).toEqual([]);
  const solved = await solveCadDocument(unplaced);
  expect(solved.status).toBe('invalid');
  expect(solved.parts).toEqual([]);
  expect(solved.document.copyTransforms![0]!.id).toBe(f.moveId);
  expect(result.placements![f.partId]!.position).toEqual([0, 0, 0]);
  expect(result.placements).not.toHaveProperty(f.childId);
  expect(() => addPhysicalTransform(copyOperationPrefix(unplaced), { kind: 'seed', partId: f.partId }, { by: [0, 25, 0] })).toThrow(
    /component|joined|placement/
  );
  const restored = parseCadDocument(JSON.parse(JSON.stringify(source)));
  expect(restored.copyTransforms![0]!.id).toBe(f.moveId);
  expect(evaluateCadDocument(restored).placements![f.childId]!.position).toEqual([20, 55, 18]);
  const suppressed = {
    ...unplaced,
    parts: unplaced.parts.map(part => (part.id === child.id ? { ...part, suppressed: true as const } : part)),
  };
  expect(evaluateCadDocument(suppressed).placements![f.partId]!.position).toEqual([0, 25, 0]);
});

it('blocks an imported component-seed operation without widening it to its independent owner', async () => {
  const f = notchedSeedSource(),
    source = copyOperationPrefix(f.source, f.moveId);
  source.copyTransforms = [{ ...source.copyTransforms![0]!, partId: f.childId }];
  const saved = parseCadDocument(JSON.parse(JSON.stringify(source))),
    result = await solveCadDocument(saved);
  expect(result.status).toBe('invalid');
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'physical-transform-seed-unsupported', severity: 'error', partId: f.childId })
  );
  expect(result.parts).toEqual([]);
  expect(cadPartsToCut(result.document, result.parts)).toEqual([]);
  expect(result.placements![f.partId]!.position).toEqual([0, 0, 0]);
  expect(result.document.copyTransforms![0]).toMatchObject({ id: f.moveId, partId: f.childId, seed: true });
});

it('blocks an available original with an unknown physical frame instead of inventing identity', async () => {
  const f = notchedSeedSource(),
    source = {
      ...copyOperationPrefix(f.source, f.moveId),
      parts: f.source.parts
        .filter(part => part.id !== f.dependentId)
        .map(part => (part.id === f.partId ? { ...part, placement: undefined, drawnOn: undefined } : part)),
    };
  const result = evaluateCadDocument(source);
  expect(result.available).toContain(f.partId);
  expect(result.placements).not.toHaveProperty(f.partId);
  expect(result.parts).toEqual([]);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'physical-transform-seed-unplaced', severity: 'error', partId: f.partId })
  );
  expect(() => addPhysicalTransform(copyOperationPrefix(source), { kind: 'seed', partId: f.partId }, { by: [0, 25, 0] })).toThrow(
    /placement/
  );
  const solved = await solveCadDocument(source);
  expect(solved.status).toBe('invalid');
  expect(cadPartsToCut(solved.document, solved.parts)).toEqual([]);
  expect(solved.document.copyTransforms![0]!.id).toBe(f.moveId);
});

it('rejects component overflow atomically instead of partially moving its host', () => {
  const f = notchedSeedSource();
  let source = copyOperationPrefix(f.source, f.moveId);
  source = {
    ...source,
    parts: source.parts.map(part =>
      part.id === f.childId ? { ...part, placement: { position: [1e308, 0, 18], rotation: [0, 0, 0, 1] } } : part
    ),
    copyTransforms: [{ ...source.copyTransforms![0]!, by: [1e308, 0, 0] }],
  };
  const result = evaluateCadDocument(source);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'physical-transform-nonfinite', severity: 'error' }));
  expect(result.placements![f.partId]!.position).toEqual([0, 0, 0]);
  expect(result.placements![f.childId]!.position).toEqual([1e308, 0, 18]);
  expect(Object.values(result.placements!).every(pose => [...pose.position, ...pose.rotation].every(Number.isFinite))).toBe(true);
});

it('resolves and renames seed operation expressions without changing source target kind or creation poses', () => {
  const f = notchedSeedSource();
  let source = copyOperationPrefix(f.source, f.moveId);
  source.variables = [{ id: 'travel', name: 'travel', expression: '25mm' }];
  source.copyTransforms = [{ ...source.copyTransforms![0]!, by: [0, 0, 0], byExpressions: [null, '#travel', null] }];
  const renamed = setCadVariable(source, { id: 'travel', name: 'offset', expression: '35mm' });
  if ('error' in renamed) throw Error(renamed.error);
  expect(renamed.document.copyTransforms![0]).toMatchObject({
    id: f.moveId,
    seed: true,
    by: [0, 35, 0],
    byExpressions: [null, '#offset', null],
  });
  expect(renamed.document.copyTransforms![0]).not.toHaveProperty('copyId');
  expect(renamed.document.parts[0]!.placement!.position).toEqual([0, 0, 0]);
  expect(evaluateCadDocument(renamed.document).placements![f.partId]!.position).toEqual([0, 35, 0]);
});

it.each(['suppressed', 'removed'] as const)(
  'retains an unavailable original operation for restoration without ghost material: %s',
  mode => {
    const f = notchedSeedSource(),
      source = {
        ...f.source,
        parts:
          mode === 'removed'
            ? f.source.parts.filter(part => part.id !== f.partId)
            : f.source.parts.map(part => (part.id === f.partId ? { ...part, suppressed: true as const } : part)),
      };
    const loaded = parseCadDocument(JSON.parse(JSON.stringify(source))),
      result = evaluateCadDocument(loaded);
    expect(loaded.copyTransforms![0]).toMatchObject({ id: f.moveId, partId: f.partId, seed: true });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'physical-transform-target-missing', severity: 'warning' }));
    expect(result.available).not.toContain(f.partId);
    expect(result.available).not.toContain(f.childId);
    expect(result.placements).not.toHaveProperty(f.partId);
    const view = physicalCadView(loaded, result);
    expect(cadPartsToCut(view.document, view.parts).flatMap(group => group.names)).not.toContain('Panel');
    const restored = parseCadDocument(JSON.parse(JSON.stringify(f.source))),
      again = evaluateCadDocument(restored);
    expect(restored.copyTransforms![0]!.id).toBe(f.moveId);
    expect(again.placements![f.partId]!.position).toEqual([0, 25, 0]);
    expect(again.placements![f.childId]!.position).toEqual([20, 55, 18]);
  }
);
