import { addCopyTransform, setPartPattern } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { compactCadReport } from './compactReport';
import { fullCadReport } from './fullReport';
import { inspectCadDocument } from './inspect';
import { spatialReportFixture } from './spatialReport.testFixtures';

it('keeps actual ordered pattern history independent of copy count while full reports retain every stage instance', async () => {
  const f = spatialReportFixture();
  let source = setPartPattern(f.source, f.partId, { count: 12, axis: 'x', spacing: 200 });
  for (const [index, copy] of source.parts[0]!.copies!.slice(0, 8).entries())
    source = addCopyTransform(source, f.partId, copy.id, { by: [0, index + 1, 0] }).document;
  const inspect = (count: number) =>
    inspectCadDocument(setPartPattern(source, f.partId, { count, axis: 'x', spacing: 200 }), new Map(), { toolpaths: false });
  const smaller = await inspect(12),
    larger = await inspect(24);
  const raw = JSON.stringify(smaller.report.spatial),
    small = compactCadReport(smaller.document, smaller.report).spatial!,
    large = compactCadReport(larger.document, larger.report).spatial!;
  expect(small.operationOrder).toEqual(source.operationOrder);
  expect(small.legacyPartCutIds).toEqual([f.first]);
  expect(small.physical).toEqual(smaller.report.spatial!.physical);
  expect(large.physical).toHaveLength(26);
  for (const [index, operation] of small.operations.entries()) {
    const original = smaller.report.spatial!.operations[index]!;
    expect(operation).toEqual({
      ...original,
      after: {
        physicalCount: index < 3 ? 15 : 14,
        placedCount: index < 3 ? 15 : 14,
        diagnosticCodes: [],
        ...(original.kind === 'partCut' && { openingCount: 1 }),
      },
    });
    expect(operation.after).not.toHaveProperty('physical');
    expect(operation.after).not.toHaveProperty('openings');
  }
  for (const [index, operation] of large.operations.entries())
    expect(operation.after).toMatchObject({ physicalCount: index < 3 ? 27 : 26, placedCount: index < 3 ? 27 : 26, diagnosticCodes: [] });
  // Identical operation settings and two-digit counts produce equal history payloads despite twice as many copies.
  expect(JSON.stringify(large.operations).length).toBe(JSON.stringify(small.operations).length);
  expect(smaller.report.spatial!.operations[0]!.after.physical).toHaveLength(15);
  expect(larger.report.spatial!.operations[0]!.after.physical).toHaveLength(27);
  const full = await fullCadReport(smaller.document, smaller);
  expect(full.spatial).toEqual(smaller.report.spatial);
  expect(full.spatial!.operations[0]!.after.physical).toHaveLength(15);
  expect(JSON.stringify(smaller.report.spatial)).toBe(raw);
});

it('keeps missing-copy diagnostics and real prefix counts without manufacturing aggregate geometry', async () => {
  const f = spatialReportFixture(),
    source = setPartPattern(f.source, f.partId, { count: 2, axis: 'x', spacing: 200 });
  const inspected = await inspectCadDocument(source, new Map(), { toolpaths: false }),
    before = JSON.stringify(inspected.report);
  const compact = compactCadReport(inspected.document, inspected.report).spatial!;
  const missing = compact.operations.find(operation => operation.id === f.move)!;
  expect(missing.after).toMatchObject({
    physicalCount: 5,
    placedCount: 5,
    diagnosticCodes: expect.arrayContaining(['copy-transform-target-missing']),
  });
  expect(missing.settings).toEqual(inspected.report.spatial!.operations.find(operation => operation.id === f.move)!.settings);
  expect(compact.physical).toHaveLength(4);
  for (const operation of compact.operations) {
    expect(operation.after).not.toHaveProperty('physical');
    expect(operation.after).not.toHaveProperty('bounds');
    expect(operation.after).not.toHaveProperty('volume');
  }
  expect(JSON.stringify(inspected.report)).toBe(before);
});
