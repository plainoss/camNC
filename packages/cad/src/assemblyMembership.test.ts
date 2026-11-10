import { expect, it } from 'vitest';
import {
  assemblyReport,
  createCadDocument,
  createPlateDocument,
  createCadFolder,
  evaluateCadDocument,
  setCadFolderSuppressed,
  parseCadDocument,
  resolveDrawnPlacements,
  type CadDocument,
  type CadPart,
} from './index';

const panel = (name: string, x = 0) => ({
  ...createPlateDocument({ width: 100, height: 80, thickness: 18 }).parts[0]!,
  name,
  placement: { position: [x, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] },
});
const report = (document: CadDocument) => assemblyReport(document, evaluateCadDocument(document).parts);

it('excludes a suppressed folder while retaining collisions in the active assembly through reload and restore', () => {
  const source = { ...createCadDocument(), parts: [panel('Hidden A'), panel('Hidden B'), panel('Active A', 200), panel('Active B', 200)] };
  const grouped = createCadFolder(source, { id: 'hidden', name: 'Hidden', partIds: source.parts.slice(0, 2).map(p => p.id) });
  if ('error' in grouped) throw new Error(grouped.error);
  const before = grouped.document;
  expect(report(before)?.collisions.map(c => c.parts)).toEqual([
    ['Hidden A', 'Hidden B'],
    ['Active A', 'Active B'],
  ]);
  const change = setCadFolderSuppressed(before, 'hidden', true);
  if ('error' in change) throw new Error(change.error);
  const suppressed = parseCadDocument(JSON.parse(JSON.stringify(change.document)));
  expect(suppressed.parts).toEqual(before.parts);
  expect(report(suppressed)?.parts.map(p => p.name)).toEqual(['Active A', 'Active B']);
  expect(report(suppressed)?.collisions.map(c => c.parts)).toEqual([['Active A', 'Active B']]);
  const restore = setCadFolderSuppressed(suppressed, 'hidden', false);
  if ('error' in restore) throw new Error(restore.error);
  expect(report(restore.document)).toEqual(report(before));
});

it.each(['sketch', 'suppressed'] as const)('excludes a %s and its placed copies', kind => {
  const inactive = {
    ...panel('Inactive'),
    copies: [{ id: 'copy', placement: panel('Copy').placement }],
    ...(kind === 'sketch' ? { extrude: false as const } : { suppressed: true as const }),
  };
  const document = { ...createCadDocument(), parts: [inactive, panel('Active')] };
  expect(report(document)?.parts.map(p => p.name)).toEqual(['Active']);
  expect(report(document)?.collisions).toEqual([]);
});

it('excludes suppressed copies and restores their original names', () => {
  const part = {
    ...panel('Panel'),
    copies: [
      { id: 'one', suppressed: true as const, placement: panel('Copy').placement },
      { id: 'two', placement: panel('Copy', 200).placement },
    ],
  };
  const document = { ...createCadDocument(), parts: [part] };
  expect(report(document)?.parts.map(p => p.name)).toEqual(['Panel', 'Panel 3']);
  expect(report(document)?.collisions).toEqual([]);
});

it('retains an active joined Add body in assembly diagnostics', () => {
  const base = panel('Base');
  const boss: CadPart = { ...panel('Boss'), addTo: base.id, drawnOn: { on: { partId: base.id, face: 'top' }, offset: 0 } };
  const document = resolveDrawnPlacements({ ...createCadDocument(), parts: [base, boss] }).document;
  expect(report(document)?.parts.map(p => p.name)).toEqual(['Base', 'Boss']);
  expect(report(document)?.collisions).toEqual([]);
});
