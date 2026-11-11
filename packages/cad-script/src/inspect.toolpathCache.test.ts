import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { planBoard } from '@wbcnc/cam';
import { beforeAll, expect, it, vi } from 'vitest';
import { cupboard, editCad, inspectCadDocument } from './index';

vi.mock('@wbcnc/cam', async importOriginal => {
  const cam = await importOriginal<typeof import('@wbcnc/cam')>();
  return { ...cam, planBoard: vi.fn(cam.planBoard) };
});

const summaries = (report: Awaited<ReturnType<typeof inspectCadDocument>>['report']) =>
  report.parts.map(part => [part.name, part.toolpaths]);

let design: CadDocument;
beforeAll(async () => {
  const result = await editCad(
    createPlateDocument(),
    cupboard({ name: 'Cupboard', width: '600mm', height: '720mm', depth: '300mm', board: '18mm', shelves: 3, at: [100, 0, 0] })
  );
  expect(result.ok).toBe(true);
  design = result.document;
}, 60_000);

it('plans each part once, however often the same design is inspected', async () => {
  const first = await inspectCadDocument(design);
  vi.mocked(planBoard).mockClear();
  const again = await inspectCadDocument(structuredClone(design));
  expect(planBoard).not.toHaveBeenCalled();
  expect(summaries(again.report)).toEqual(summaries(first.report));
  expect(again.report.parts.filter(part => part.toolpaths).length).toBeGreaterThan(1);
}, 60_000);

it('plans again only the parts that changed', async () => {
  await inspectCadDocument(design);
  vi.mocked(planBoard).mockClear();
  // The edit inspects its result, the way the assistant's check does.
  const deeper = await editCad(design, d => d.existingFolder('Cupboard', d => d.variable('depth', '320mm')));
  expect(deeper.ok).toBe(true);
  const cupboardParts = new Set(deeper.document.folders![0]!.partIds);
  const plate = deeper.document.parts.find(part => !cupboardParts.has(part.id))!;
  const { report } = deeper;
  // Every cupboard part got deeper, so each is planned again; the unchanged plate keeps its summary.
  const planned = vi.mocked(planBoard).mock.calls.map(([board]) => board.name);
  expect(planned.length).toBeGreaterThan(0);
  expect(planned).not.toContain(plate.name);
  expect(report.parts.find(part => part.name === plate.name)!.toolpaths).toBeDefined();
}, 60_000);

it('gives each report its own summary', async () => {
  const first = await inspectCadDocument(design);
  const part = first.report.parts.find(candidate => candidate.toolpaths)!;
  part.toolpaths!.warnings.push('changed by a caller');
  const again = await inspectCadDocument(design);
  expect(again.report.parts.find(candidate => candidate.name === part.name)!.toolpaths!.warnings).not.toContain('changed by a caller');
}, 60_000);
