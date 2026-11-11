import { expect, it } from 'vitest';
import { evaluateCadDocument, parseCadDocument } from './index';
import { notchedSeedSource } from './physicalSeedTransforms.testFixtures';

it.each(['seed', 'copy'] as const)('validates saved operation IDs before masking a suppressed %s family', kind => {
  const f = notchedSeedSource(),
    source = { ...f.source, parts: f.source.parts.map(part => (part.id === f.partId ? { ...part, suppressed: true as const } : part)) };
  if (kind === 'copy')
    source.copyTransforms = [{ id: f.moveId, partId: f.partId, copyId: f.source.parts[0]!.copies![0]!.id, by: [0, 25, 0] }];
  const bytes = JSON.stringify(source),
    loaded = parseCadDocument(JSON.parse(bytes)),
    result = evaluateCadDocument(loaded);
  expect(result.diagnostics.map(diagnostic => ({ code: diagnostic.code, severity: diagnostic.severity }))).toEqual([
    { code: kind === 'seed' ? 'physical-transform-target-missing' : 'copy-transform-target-missing', severity: 'warning' },
  ]);
  expect(result.available).not.toContain(f.partId);
  expect(loaded.operationOrder).toEqual([f.moveId, f.cutId]);
  expect(loaded.partCuts!.map(step => step.id)).toEqual([f.cutId]);
  expect(JSON.stringify(source)).toBe(bytes);
});

it('skips a suppressed cut while retaining its source record and the moved original', () => {
  const f = notchedSeedSource(),
    source = { ...f.source, partCuts: f.source.partCuts!.map(step => ({ ...step, suppressed: true as const })) };
  const result = evaluateCadDocument(source);
  expect(result.diagnostics).toEqual([]);
  expect(result.placements![f.partId]!.position).toEqual([0, 25, 0]);
  expect(result.parts.find(part => part.partId === f.partId)!.cuts ?? []).toEqual([]);
  expect(source.operationOrder).toEqual([f.moveId, f.cutId]);
  expect(source.partCuts[0]!.id).toBe(f.cutId);
});

it('still rejects a genuinely dangling raw operation order rather than repairing malformed source', () => {
  const f = notchedSeedSource(),
    source = { ...f.source, partCuts: [] };
  expect(() => parseCadDocument(JSON.parse(JSON.stringify(source)))).toThrow(/operation order/);
  expect(evaluateCadDocument(source).diagnostics).toContainEqual(
    expect.objectContaining({ code: 'invalid-copy-operations', severity: 'error' })
  );
});
