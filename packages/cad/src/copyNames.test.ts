import { describe, expect, it } from 'vitest';
import {
  addPartCopy,
  addPartMirror,
  cadCopyName,
  createCadDocument,
  createPlateDocument,
  parseCadDocument,
  resolvePartPatterns,
  setPartPattern,
  type CadDocument,
} from './index';

function tray(): { document: CadDocument; partId: string } {
  const divider = createPlateDocument({ width: 200, height: 60, thickness: 12 }).parts[0]!;
  divider.name = 'Divider';
  divider.placement = { position: [90, 0, 0], rotation: [0, 0, 0, 1] };
  return {
    document: setPartPattern({ ...createCadDocument(), parts: [divider] }, divider.id, { axis: 'x', count: 3, spacing: 84 }),
    partId: divider.id,
  };
}

const names = (document: CadDocument, partId: string) => {
  const part = document.parts.find(candidate => candidate.id === partId)!;
  return Object.fromEntries((part.copies ?? []).map((copy, index) => [copy.id, cadCopyName(part, index)]));
};
const reopened = (document: CadDocument) => parseCadDocument(JSON.parse(JSON.stringify(document)));

describe('copy names', () => {
  it('keeps pattern copies named when a transformed copy is added, and after reopening', () => {
    const { document, partId } = tray();
    const before = names(document, partId);
    expect(Object.values(before)).toEqual(['Divider 2', 'Divider 3']);
    const added = addPartCopy(document, partId, { offset: { position: [0, 300, 0], rotation: [0, 0, 0, 1] } });
    expect(names(added.document, partId)).toEqual({ ...before, [added.id]: 'Divider 4' });
    expect(names(reopened(added.document), partId)).toEqual(names(added.document, partId));
    expect(resolvePartPatterns(added.document)).toBe(added.document);
    // Another one takes the next number; the pattern can grow without renaming copies ahead of it.
    const next = addPartCopy(added.document, partId, { offset: { position: [0, 600, 0], rotation: [0, 0, 0, 1] } });
    expect(names(next.document, partId)[next.id]).toBe('Divider 5');
    expect(names(next.document, partId)[added.id]).toBe('Divider 4');
  });

  it('keeps pattern copies named when a mirror is added', () => {
    const { document, partId } = tray();
    const before = names(document, partId);
    const mirrored = addPartMirror(document, partId, { across: { plane: 'right' } });
    expect(names(mirrored.document, partId)).toEqual({ ...before, [mirrored.id]: 'Divider 4' });
    expect(names(reopened(mirrored.document), partId)).toEqual(names(mirrored.document, partId));
  });

  it('keeps the numbers of copies made before the pattern', () => {
    const divider = createPlateDocument({ width: 200, height: 60, thickness: 12 }).parts[0]!;
    divider.name = 'Divider';
    divider.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    const first = addPartCopy({ ...createCadDocument(), parts: [divider] }, divider.id, {
      offset: { position: [0, 300, 0], rotation: [0, 0, 0, 1] },
    });
    const document = setPartPattern(first.document, divider.id, { axis: 'x', count: 3, spacing: 84 });
    expect(Object.values(names(document, divider.id))).toEqual(['Divider 2', 'Divider 3', 'Divider 4']);
    expect(names(document, divider.id)[first.id]).toBe('Divider 2');
  });
});
