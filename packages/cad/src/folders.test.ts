import { describe, expect, it } from 'vitest';
import {
  activeDesign,
  addCircle,
  cadFolderForPart,
  cadFolderSteps,
  cadFolderVariableUses,
  cadSketchRegions,
  createCadDocument,
  createCadFolder,
  createPlateDocument,
  deleteCadFolder,
  designSteps,
  dissolveCadFolder,
  evaluateCadDocument,
  moveCadFolder,
  parseCadDocument,
  renameCadFolder,
  rolledBackTo,
  rolledBackToFolder,
  setCadFolderCollapsed,
  setCadFolderSuppressed,
  setCadVariable,
  setCutDepth,
  solveCadDocument,
  type CadDocument,
} from './index';

const part = (name: string) => ({ ...createPlateDocument({ width: 120, height: 80, thickness: 18 }).parts[0]!, name });
const studio = (): CadDocument => ({ ...createCadDocument('Furniture'), parts: [part('Side'), part('Shelf'), part('Other')] });
function grouped(document = studio(), count = 2) {
  const result = createCadFolder(document, {
    id: 'cupboard',
    name: 'Cupboard',
    partIds: document.parts.slice(0, count).map(part => part.id),
  });
  if ('error' in result) throw new Error(result.error);
  return result.document;
}
function changed(result: { document: CadDocument } | { error: string }) {
  if ('error' in result) throw new Error(result.error);
  return result.document;
}

describe('source folders', () => {
  it('groups the real ordered steps without changing any part or evaluated geometry', () => {
    const before = studio();
    const steps = designSteps(before);
    const document = grouped(before);
    expect(document.version).toBe(3);
    expect(document.parts).toBe(before.parts);
    expect(designSteps(document)).toEqual(steps);
    expect(cadFolderSteps(document, 'cupboard').map(step => step.id)).toEqual(steps.slice(0, 4).map(step => step.id));
    expect(cadFolderForPart(document, before.parts[0]!.id)?.name).toBe('Cupboard');
    const renamed = changed(renameCadFolder(document, 'cupboard', 'Bookshelf'));
    const unpacked = dissolveCadFolder(renamed, 'cupboard');
    expect(unpacked.folders).toBeUndefined();
    expect(unpacked.version).toBe(1);
    for (const edited of [document, renamed, unpacked]) {
      expect(edited.parts).toBe(before.parts);
      expect(evaluateCadDocument(edited)).toEqual(evaluateCadDocument(before));
    }
  });

  it('groups trailing cut-parts steps and planes while preserving their IDs', () => {
    const before = studio();
    before.parts.pop();
    before.partCuts = [{ id: 'housings', tools: [before.parts[1]!.id], targets: [before.parts[0]!.id], clearance: 0.2 }];
    before.planes = [{ id: 'back-plane', name: 'Back plane', on: { plane: 'front' }, offset: 20 }];
    const document = changed(
      createCadFolder(before, { name: 'Box', partIds: before.parts.map(part => part.id), planeIds: ['back-plane'] })
    );
    expect(document.folders![0]!.partCutIds).toEqual(['housings']);
    expect(document.folders![0]!.planeIds).toEqual(['back-plane']);
    expect(cadFolderSteps(document, document.folders![0]!.id).at(-1)?.id).toBe('housings');
    expect(parseCadDocument(document)).toEqual(document);
  });

  it('refuses a non-contiguous selection, an overlapping group and invalid source references', () => {
    const before = studio();
    expect(createCadFolder(before, { name: 'Gap', partIds: [before.parts[0]!.id, before.parts[2]!.id] })).toHaveProperty('error');
    const document = grouped(before);
    expect(createCadFolder(document, { name: 'Overlap', partIds: [before.parts[0]!.id] })).toHaveProperty('error');
    expect(() => parseCadDocument({ ...document, folders: [{ ...document.folders![0], partIds: ['gone'] }] })).toThrow('missing part');
    expect(() => parseCadDocument({ ...document, folders: [{ ...document.folders![0], id: before.parts[0]!.id }] })).toThrow('unique');
    expect(() => parseCadDocument({ ...document, folders: [{ ...document.folders![0], suppressed: false }] })).toThrow('folder');
    expect(() => parseCadDocument({ ...document, version: 1 })).toThrow('Invalid CAD document');
    expect(() => parseCadDocument({ ...before, version: 3 })).toThrow('Invalid CAD document');
  });

  it('suppresses a folder with a mask and restores every individual source flag', () => {
    const before = studio();
    before.parts[1]!.suppressed = true;
    before.partCuts = [{ id: 'housings', tools: [before.parts[0]!.id], targets: [before.parts[2]!.id], clearance: 0 }];
    let document = grouped(before);
    const source = structuredClone(document.parts);
    document = changed(setCadFolderSuppressed(document, 'cupboard', true));
    const built = activeDesign(document);
    expect(built.parts.slice(0, 2).every(part => part.extrude === false)).toBe(true);
    expect(built.parts[2]!.extrude).not.toBe(false);
    expect(built.partCuts).toBeUndefined();
    expect(document.parts).toEqual(source);
    document = changed(setCadFolderSuppressed(document, 'cupboard', false));
    expect(document.parts).toEqual(source);
    expect(activeDesign(document).parts[0]!.extrude).not.toBe(false);
    expect(activeDesign(document).parts[1]!.extrude).toBe(false);
  });
  it('keeps a suppressed folder with its cut-parts steps valid while another folder is built', () => {
    const before = studio();
    before.partCuts = [{ id: 'owned-housing', tools: [before.parts[1]!.id], targets: [before.parts[0]!.id], clearance: 0 }];
    const document = grouped(before);
    expect(document.folders![0]!.partCutIds).toEqual(['owned-housing']);
    const suppressed = changed(setCadFolderSuppressed(document, 'cupboard', true));
    expect(activeDesign(suppressed).partCuts).toBeUndefined();
    expect(evaluateCadDocument(suppressed).diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([]);
    expect(suppressed.folders![0]!.partCutIds).toEqual(['owned-housing']);
    expect(suppressed.partCuts).toEqual(before.partCuts);
  });

  it('moves a folder as a block and does not insert one group into another', () => {
    const document = grouped();
    const moved = changed(moveCadFolder(document, 'cupboard'));
    expect(moved.parts.map(part => part.name)).toEqual(['Other', 'Side', 'Shelf']);
    expect(moved.folders).toEqual(document.folders);
    const back = changed(moveCadFolder(moved, 'cupboard', moved.parts[0]!.id));
    expect(back.parts).toEqual(document.parts);
    let two = { ...document, parts: [...document.parts, part('Extra')] };
    two = changed(createCadFolder(two, { id: 'second', name: 'Second', partIds: two.parts.slice(2).map(part => part.id) }));
    expect(moveCadFolder(two, 'cupboard', two.parts[3]!.id)).toHaveProperty('error');
  });

  it('rolls to the same real step whether the folder is collapsed or open', () => {
    const document = grouped();
    const collapsed = changed(setCadFolderCollapsed(document, 'cupboard', true));
    expect(rolledBackToFolder(document, 'cupboard').parts).toEqual(rolledBackToFolder(collapsed, 'cupboard').parts);
    expect(designSteps(rolledBackToFolder(document, 'cupboard'))).toEqual(designSteps(rolledBackToFolder(collapsed, 'cupboard')));
    const last = cadFolderSteps(document, 'cupboard').at(-1)!;
    expect(rolledBackToFolder(document, 'cupboard')).toEqual(rolledBackTo(document, last.id));
    expect(rolledBackToFolder(document, 'cupboard').parts.map(part => part.name)).toEqual(['Side', 'Shelf']);
    const partial = rolledBackTo(document, `${document.parts[0]!.id}:extrude`);
    expect(partial.folders![0]!.partIds).toEqual([document.parts[0]!.id]);
    expect(parseCadDocument(partial)).toEqual(partial);
  });

  it('keeps version 3 when face features are added and removed by normal editing', () => {
    let document = grouped();
    const first = document.parts[0]!;
    first.sketch = addCircle(first.sketch, { x: 40, y: 40, radius: 5 });
    const region = cadSketchRegions(first, first.sketch.id).find(region => region.curveIds.length === 1)!;
    document = setCutDepth(document, first.id, first.sketch.id, region.id, 5);
    expect(document.version).toBe(3);
    expect(parseCadDocument(document)).toEqual(document);
    expect(dissolveCadFolder(document, 'cupboard').version).toBe(2);
  });
});

describe('folder variables', () => {
  it('keeps associations through edits, keeps names unique and renames expressions globally', () => {
    let document = grouped();
    const result = setCadVariable(document, { name: 'width', expression: '120 mm', folderId: 'cupboard' });
    document = changed(result);
    const id = document.variables![0]!.id;
    document.parts[0]!.thicknessExpression = 'width / 10';
    expect(setCadVariable(document, { name: 'width', expression: '80 mm' })).toHaveProperty('error');
    expect(setCadVariable(document, { name: 'bad', expression: '1', folderId: 'gone' })).toHaveProperty('error');
    document = changed(setCadVariable(document, { id, name: 'case_width', expression: '150 mm' }));
    expect(document.variables![0]!.folderId).toBe('cupboard');
    expect(document.parts[0]!.thicknessExpression).toBe('case_width / 10');
    expect(document.parts[0]!.thickness).toBe(15);
    document = changed(setCadVariable(document, { id, name: 'case_width', expression: '150 mm', folderId: null }));
    expect(document.variables![0]!.folderId).toBeUndefined();
  });

  it('deletes owned variables only after listing and removing outside uses', () => {
    let document = grouped();
    document = changed(setCadVariable(document, { name: 'width', expression: '120 mm', folderId: 'cupboard' }));
    document.parts[0]!.thicknessExpression = 'width / 10';
    document.parts[2]!.thicknessExpression = 'width / 20';
    document = changed(setCadVariable(document, { name: 'half_width', expression: 'width / 2' }));
    const uses = cadFolderVariableUses(document, 'cupboard');
    expect(uses.map(use => use.ownerName)).toEqual(['Other', 'half_width']);
    const refusal = deleteCadFolder(document, 'cupboard');
    expect(refusal).toHaveProperty('error');
    if ('error' in refusal) expect(refusal.error).toContain('width in Other');
    delete document.parts[2]!.thicknessExpression;
    document.variables = document.variables!.filter(variable => variable.name !== 'half_width');
    const removed = changed(deleteCadFolder(document, 'cupboard'));
    expect(removed.parts.map(part => part.name)).toEqual(['Other']);
    expect(removed.variables).toBeUndefined();
    expect(removed.folders).toBeUndefined();
    expect(removed.version).toBe(1);
  });

  it('unpacks variables into document settings without changing their IDs or values', () => {
    let document = grouped();
    document = changed(setCadVariable(document, { name: 'width', expression: '120 mm', folderId: 'cupboard' }));
    const unpacked = dissolveCadFolder(document, 'cupboard');
    expect(unpacked.variables).toEqual(document.variables!.map(({ folderId: _folderId, ...variable }) => variable));
    expect(parseCadDocument(unpacked)).toEqual(unpacked);
  });

  it('changes one folder width without changing the other one', async () => {
    let document = grouped();
    document = changed(createCadFolder(document, { id: 'second', name: 'Second', partIds: [document.parts[2]!.id] }));
    document = changed(setCadVariable(document, { name: 'width', expression: '120 mm', folderId: 'cupboard' }));
    document = changed(setCadVariable(document, { name: 'width_2', expression: '80 mm', folderId: 'second' }));
    document.parts[0]!.thicknessExpression = 'width / 10';
    document.parts[2]!.thicknessExpression = 'width_2 / 10';
    const variable = document.variables![0]!;
    document = changed(setCadVariable(document, { id: variable.id, name: variable.name, expression: '160 mm' }));
    const solved = await solveCadDocument(document);
    expect(solved.document.parts[0]!.thickness).toBe(16);
    expect(solved.document.parts[2]!.thickness).toBe(8);
    expect(solved.document.variables!.map(variable => variable.folderId)).toEqual(['cupboard', 'second']);
  });
});
