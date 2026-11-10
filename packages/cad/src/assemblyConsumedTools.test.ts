import { expect, it } from 'vitest';
import {
  addPartCut,
  assemblyReport,
  createCadDocument,
  createCadFolder,
  createPlateDocument,
  evaluateCadDocument,
  parseCadDocument,
  setCadFolderSuppressed,
  type CadDocument,
} from './index';

function source() {
  const panel = (name: string, x: number, width = 100) => ({
    ...createPlateDocument({ width, height: width, thickness: 18 }).parts[0]!,
    name,
    placement: { position: [x, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] },
  });
  const target = panel('Target', 0),
    tool = panel('Tool', 10, 20);
  tool.copies = [{ id: 'tool-copy', placement: panel('Copy', 210).placement }];
  const made = addPartCut(
    { ...createCadDocument(), parts: [target, tool, panel('Untouched', 0), panel('Remote', 200)] },
    [tool.id],
    [target.id],
    { value: 0 }
  );
  made.document.partCuts![0]!.consumeTools = true;
  return { document: made.document, tool, cutId: made.id };
}
const report = (document: CadDocument) => assemblyReport(document, evaluateCadDocument(document).parts)!;

it('excludes a consumed source and every copy without discarding history, cuts, or legitimate collisions', () => {
  const { document, tool } = source();
  const before = structuredClone(document),
    built = evaluateCadDocument(document).parts;
  expect(report(document).parts.map(part => part.name)).toEqual(['Target', 'Untouched', 'Remote']);
  expect(report(document).collisions.map(clash => clash.parts)).toEqual([['Target', 'Untouched']]);
  expect(document.parts.find(part => part.id === tool.id)).toEqual(tool);
  expect(document).toEqual(before);
  expect(report(parseCadDocument(JSON.parse(JSON.stringify(document))))).toEqual(report(document));
  const kept = structuredClone(document);
  delete kept.partCuts![0]!.consumeTools;
  expect(evaluateCadDocument(kept).parts).toEqual(built);
  expect(report(kept).parts.map(part => part.name)).toEqual(['Target', 'Tool', 'Tool 2', 'Untouched', 'Remote']);
  expect(report(kept).collisions.map(clash => clash.parts)).toEqual([
    ['Target', 'Untouched'],
    ['Tool', 'Untouched'],
    ['Tool 2', 'Remote'],
  ]);
  // Undoing Keep tools restores membership without changing any source/copy or target reference.
  kept.partCuts![0]!.consumeTools = true;
  expect(report(kept)).toEqual(report(document));
});

it.each(['step', 'folder'] as const)('a suppressed %s does not consume its tool family', kind => {
  const { document, cutId } = source();
  let suppressed: CadDocument;
  if (kind === 'step') {
    suppressed = structuredClone(document);
    suppressed.partCuts![0]!.suppressed = true;
  } else {
    const grouped = createCadFolder(document, { id: 'cut-folder', name: 'Cut', partIds: [], partCutIds: [cutId] });
    if ('error' in grouped) throw new Error(grouped.error);
    const changed = setCadFolderSuppressed(grouped.document, 'cut-folder', true);
    if ('error' in changed) throw new Error(changed.error);
    suppressed = changed.document;
  }
  expect(report(suppressed).parts.map(part => part.name)).toEqual(['Target', 'Tool', 'Tool 2', 'Untouched', 'Remote']);
  expect(report(suppressed).collisions.map(clash => clash.parts)).toEqual([
    ['Target', 'Tool'],
    ['Target', 'Untouched'],
    ['Tool', 'Untouched'],
    ['Tool 2', 'Remote'],
  ]);
});
