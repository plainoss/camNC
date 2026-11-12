import { expect, it } from 'vitest';
import {
  addCopyTransform,
  addPartCut,
  addRectangle,
  copyOperationPrefix,
  createCadFolder,
  createCadPart,
  createPlateDocument,
  evaluateCadDocument,
  parseCadDocument,
  type CadDocument,
} from './index';

it('retains valid source folders, variables and flags in saved operation prefixes without editing the full source', () => {
  let source = createPlateDocument({ width: 100, height: 60, thickness: 18 });
  const parent = source.parts[0]!;
  parent.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  parent.copies = [{ id: 'owned-copy', placement: { position: [150, 0, 0], rotation: [0, 0, 0, 1] } }];
  const tool = createCadPart('Pocket tool', 6);
  tool.sketch = addRectangle(tool.sketch, { x: 10, y: 10, width: 20, height: 20 });
  tool.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  source = { ...source, parts: [...source.parts, tool] };
  const cut = addPartCut(source, [tool.id], [parent.id], { value: 0 });
  const folder = createCadFolder(cut.document, { name: 'Stock', partIds: [parent.id, tool.id], partCutIds: [cut.id] });
  if ('error' in folder) throw Error(folder.error);
  source = {
    ...folder.document,
    folders: folder.document.folders!.map(group => ({ ...group, collapsed: true })),
    variables: [{ id: 'travel-variable', name: 'travel', expression: '20mm', folderId: folder.id }],
  };
  const move = addCopyTransform(source, parent.id, 'owned-copy', { by: [20, 0, 0], byExpressions: ['travel', null, null] });
  source = move.document;
  const bytes = JSON.stringify(source);
  const check = (prefix: CadDocument, ids: string[]) => {
    expect(prefix.folders).toEqual([{ ...source.folders![0]!, partCutIds: ids }]);
    expect(prefix.variables).toEqual(source.variables);
    expect(prefix.parts).toBe(source.parts);
    expect(() => parseCadDocument(JSON.parse(JSON.stringify(prefix)))).not.toThrow();
    expect(evaluateCadDocument(prefix).diagnostics).toEqual([]);
  };
  check(copyOperationPrefix(source), []);
  check(copyOperationPrefix(source, cut.id), [cut.id]);
  check(copyOperationPrefix(source, move.id), [cut.id]);
  expect(JSON.stringify(source)).toBe(bytes);
  expect(source.folders![0]!.partCutIds).toEqual([cut.id]);
});
