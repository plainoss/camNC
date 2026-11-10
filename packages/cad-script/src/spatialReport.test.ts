import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  addCopyTransform,
  addPartCut,
  addRectangle,
  cadPartReference,
  copyOperationPrefix,
  createCadPart,
  createPlateDocument,
  evaluateCadDocument,
  parseCadDocument,
  setPartPattern,
  updatePartCut,
} from '@wbcnc/cad';
import { inspectCadDocument, type CadReport } from './inspect';
import { fullCadReport } from './fullReport';
import { compactCadReport } from './compactReport';
import { cadViewBodies } from './views/geometry';
import { renderCadViews } from './views/render';
import { runCadWorkflow } from './iteration/workflow';
import { spatialReportFixture } from './spatialReport.testFixtures';
import type { CadPhysicalReportBody } from './spatialReport';

const spatial = (report: CadReport) => {
  const value = report.spatial;
  expect(value, 'V4 reports must distinguish ordered operations from generation').toBeDefined();
  return value!;
};
const camVolume = (body: CadPhysicalReportBody) => {
  expect(body.cam).toBeDefined();
  if (!body.cam || !('volume' in body.cam)) throw Error(`Missing CAM material for ${body.name}: ${JSON.stringify(body.cam)}`);
  return body.cam.volume;
};
const imported = (source: ReturnType<typeof spatialReportFixture>['source']) => parseCadDocument(JSON.parse(JSON.stringify(source)));

it('reports imported moved/notched physical copies at evaluated poses without saving their final poses', async () => {
  const f = spatialReportFixture(),
    source = imported(f.source),
    before = JSON.stringify(source),
    hash = createHash('sha256').update(before).digest('hex');
  const inspected = await inspectCadDocument(source, new Map(), { toolpaths: false });
  // Raw creation is400; the actual copy occupies500..600 after its saved operation.
  expect(inspected.report.assembly!.parts.find(part => part.name === 'Panel 3')).toEqual({
    name: 'Panel 3',
    at: [500, 0, 0],
    size: [100, 60, 18],
  });
  const state = spatial(inspected.report),
    body = state.physical.find(body => body.id === f.reference)!;
  expect(state.scope).toBe('generation-before-spatial');
  expect(state.operationOrder).toEqual([f.first, f.move, f.second, f.consume]);
  expect(state.legacyPartCutIds).toEqual([f.first]);
  expect(state.through).toBe(f.consume);
  expect(body.placement!.position).toEqual([500, 0, 0]);
  expect(body.bounds).toEqual({ at: [500, 0, 0], size: [100, 60, 18] });
  expect(camVolume(body)).toBeCloseTo(100 * 60 * 18 - 10 * 10 * 18 - 2 * 10 * 20 * 18, 5);
  expect(body.cutIds.some(id => id.startsWith(`cut-parts:${f.first}:`))).toBe(true);
  expect(body.cutIds.some(id => id.startsWith(`cut-parts:${f.second}:`))).toBe(true);
  expect(inspected.document.parts[0]!.copies![1]!.placement!.position).toEqual([400, 0, 0]);
  expect(inspected.document.copyTransforms).toEqual(source.copyTransforms);
  expect(createHash('sha256').update(JSON.stringify(source)).digest('hex')).toBe(hash);
  expect(JSON.stringify(source)).toBe(before);
  const views = renderCadViews(inspected.document, inspected.parts);
  expect(views[0]!.bounds).toEqual({ at: [0, -5], size: [600, 65] });
  expect(cadViewBodies(inspected.document, inspected.parts).find(body => body.id === f.reference)!.placement!.position).toEqual([
    500, 0, 0,
  ]);
});

it('reports each operation from its own prefix and keeps generation features separate from final openings', async () => {
  const f = spatialReportFixture(),
    inspected = await inspectCadDocument(imported(f.source), new Map(), { toolpaths: false }),
    state = spatial(inspected.report);
  const first = state.operations.find(operation => operation.id === f.first)!,
    move = state.operations.find(operation => operation.id === f.move)!,
    second = state.operations.find(operation => operation.id === f.second)!;
  expect(first.after.physical.find(body => body.id === f.reference)!.placement!.position).toEqual([400, 0, 0]);
  expect(first.after.openings).toContainEqual(expect.objectContaining({ at: { x: 0, y: 0 }, width: 10, length: 20, depth: 18 }));
  expect(move.after.physical.find(body => body.id === f.reference)!.placement!.position).toEqual([500, 0, 0]);
  expect(move.after.physical.find(body => body.id === f.reference)!.cutIds.some(id => id.startsWith(`cut-parts:${f.second}:`))).toBe(false);
  expect(second.after.openings).toContainEqual(expect.objectContaining({ at: { x: 30, y: 0 }, width: 10, length: 20, depth: 18 }));
  expect(inspected.report.steps?.some(step => step.kind === 'partCut')).toBe(false);
  const compact = compactCadReport(inspected.document, inspected.report);
  expect(compact.featureList.some(step => step.kind === 'partCut')).toBe(false);
  const prefix = await inspectCadDocument(copyOperationPrefix(inspected.document, f.move), new Map(), { toolpaths: false });
  expect(spatial(prefix.report).through).toBe(f.move);
  expect(camVolume(spatial(prefix.report).physical.find(body => body.id === f.reference)!)).toBeCloseTo(
    100 * 60 * 18 - 10 * 10 * 18 - 10 * 20 * 18,
    5
  );
  expect(spatial(prefix.report).physical.map(body => body.name)).toContain('Knife A');
});

it('reports missing/restored slots by the same reference and omits a really consumed tool from final CAM', async () => {
  const f = spatialReportFixture();
  const missing = await inspectCadDocument(imported(setPartPattern(f.source, f.partId, { count: 2, axis: 'x', spacing: 200 })), new Map(), {
    toolpaths: false,
  });
  expect(spatial(missing.report).physical.some(body => body.id === f.reference)).toBe(false);
  expect(missing.report.warnings).toContainEqual(expect.objectContaining({ code: 'copy-transform-target-missing' }));
  const restored = await inspectCadDocument(
    imported(setPartPattern(missing.document, f.partId, { count: 3, axis: 'x', spacing: 200 })),
    new Map(),
    { toolpaths: false }
  );
  expect(spatial(restored.report).physical.find(body => body.id === f.reference)!.placement!.position).toEqual([500, 0, 0]);
  expect(spatial(restored.report).physical.map(body => body.name)).not.toContain('Knife A');
  const full = await fullCadReport(restored.document, restored, { views: true });
  expect(full.boards.flatMap(board => board.parts.map(part => part.name)).sort()).toEqual([
    'Knife B',
    'Panel',
    'Panel 2',
    'Panel 3',
    'Receiver',
  ]);
  expect(full.features.some(feature => feature.kind === 'partCut')).toBe(false);
  expect(full.spatial!.operationOrder).toEqual([f.first, f.move, f.second, f.consume]);
  expect(restored.document.parts.some(part => part.id === f.toolA)).toBe(true);
});

it('keeps workflow source snapshots/hash and saved creation frames raw while body metadata uses final poses', async () => {
  const f = spatialReportFixture(),
    sourceText = `${JSON.stringify(f.source, null, 1)}\n`;
  const result = await runCadWorkflow({
    id: 'ordered-copy-report',
    name: 'Ordered copy report',
    create: () => f.source,
    checkpoints: [
      {
        id: 'imported',
        checks: [
          {
            layer: 'source',
            description: 'Creation pose stays raw before spatial operations',
            expected: [400, 0, 0],
            actual: ({ sourceDocument }) => sourceDocument.parts[0]!.copies![1]!.placement!.position,
          },
        ],
      },
    ],
  });
  const row = result.checkpoints[0]!;
  expect(row.sourceText).toBe(sourceText);
  expect(row.sourceSha256).toBe(createHash('sha256').update(sourceText).digest('hex'));
  expect(row.sourceDocument.copyTransforms).toEqual(f.source.copyTransforms);
  expect(row.solvedDocument!.parts[0]!.copies![1]!.placement!.position).toEqual([400, 0, 0]);
  expect(row.bodies.find(body => body.copyId === f.copyId)!.placement!.position).toEqual([500, 0, 0]);
  expect(row.bodies.some(body => body.sourcePartId === f.toolA)).toBe(false);
});

it('reports joined component copies at their parent poses and removes the complete consumed compound only at its stage', async () => {
  let source = createPlateDocument({ name: 'Joined panel', width: 100, height: 60, thickness: 18 });
  const parent = source.parts[0]!;
  parent.name = 'Panel';
  parent.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  source = setPartPattern(source, parent.id, { count: 3, axis: 'x', spacing: 200 });
  const copyId = source.parts[0]!.copies![0]!.id;
  const boss = createCadPart('Boss', 6);
  boss.addTo = parent.id;
  boss.sketch = addRectangle(boss.sketch, { x: 0, y: 0, width: 10, height: 8 });
  boss.placement = { position: [10, 20, 18], rotation: [0, 0, 0, 1] };
  const receiver = createCadPart('Receiver', 18);
  receiver.sketch = addRectangle(receiver.sketch, { x: 95, y: 10, width: 20, height: 20 });
  receiver.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  source = { ...source, parts: [...source.parts, boss, receiver] };
  const move = addCopyTransform(source, parent.id, copyId, { by: [100, 0, 0] });
  const consume = addPartCut(move.document, [parent.id], [receiver.id], { value: 0 });
  source = updatePartCut(consume.document, consume.id, { consumeTools: true });
  const bytes = JSON.stringify(source),
    inspected = await inspectCadDocument(source, new Map(), { toolpaths: false });
  const history = spatial(inspected.report),
    afterMove = history.operations[0]!.after;
  const child = afterMove.physical.find(body => body.id === cadPartReference(boss.id, copyId))!;
  expect(child.name).toBe('Boss · Panel 2');
  expect(child.placement!.position).toEqual([310, 20, 18]);
  expect(child.bounds).toEqual({ at: [310, 20, 18], size: [10, 8, 6] });
  expect(afterMove.physical.filter(body => body.partId === boss.id)).toHaveLength(3);
  expect(history.physical.map(body => body.name)).toEqual(['Receiver']);
  expect(history.camGroups.map(group => group.names)).toEqual([['Receiver']]);
  expect(camVolume(history.physical[0]!)).toBeCloseTo((20 * 20 - 5 * 20) * 18, 5);
  expect(inspected.document.parts.find(part => part.id === boss.id)!.copies).toBeUndefined();
  expect(JSON.stringify(source)).toBe(bytes);
});

it.each([false, true])(
  'keeps final V4 material authoritative when a drawing caller provides generation parts, supplied evaluation=%s',
  supplied => {
    const f = spatialReportFixture(),
      generation = evaluateCadDocument(copyOperationPrefix(f.source)),
      final = evaluateCadDocument(f.source);
    const view = renderCadViews(f.source, generation.parts, supplied ? final : undefined)[0]!;
    expect(view.svg).toContain(`data-cut="cut-parts:${f.second}:`);
    expect(view.svg).not.toContain('data-body="Knife A"');
    const body = cadViewBodies(f.source, generation.parts, supplied ? final : undefined).find(body => body.id === f.reference)!;
    expect(body.placement!.position).toEqual([500, 0, 0]);
    expect(body.shape.cuts!.some(cut => cut.id.startsWith(`cut-parts:${f.second}:`))).toBe(true);
  }
);
