import { describe, expect, it } from 'vitest';
import {
  addPartCopy,
  addPartMirror,
  applyCadVariables,
  cadCopyName,
  cadPartsToCut,
  createCadDocument,
  createPlateDocument,
  detachPartCopy,
  parseCadDocument,
  resolvePartPatterns,
  setCadVariable,
  setPartPattern,
  solveCadDocument,
  type CadDocument,
} from './index';

const kAway = { offset: { position: [0, 300, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] } };

function tray(): { document: CadDocument; partId: string } {
  const divider = createPlateDocument({ width: 200, height: 60, thickness: 12 }).parts[0]!;
  divider.name = 'Divider';
  divider.placement = { position: [90, 0, 0], rotation: [0, 0, 0, 1] };
  const document = setPartPattern({ ...createCadDocument(), parts: [divider] }, divider.id, { axis: 'x', count: 3, spacing: 84 });
  return { document, partId: divider.id };
}

const pattern = (document: CadDocument, partId: string, count: number) =>
  setPartPattern(document, partId, { axis: 'x', count, spacing: 84 });

/** Every copy's name by its id, as the design lays it out. */
const names = (given: CadDocument, partId: string) => {
  const document = resolvePartPatterns(given);
  const part = document.parts.find(candidate => candidate.id === partId)!;
  return Object.fromEntries((part.copies ?? []).map((copy, index) => [copy.id, cadCopyName(part, index)]));
};
const reopened = (document: CadDocument) => parseCadDocument(JSON.parse(JSON.stringify(document)));
const slot = (document: CadDocument, partId: string, k: number) => `${document.parts.find(part => part.id === partId)!.pattern!.id}:${k}`;

describe('copy names', () => {
  it('keeps pattern copies named when a transformed copy is added, and after reopening', () => {
    const { document, partId } = tray();
    expect(Object.values(names(document, partId))).toEqual(['Divider 2', 'Divider 3']);
    const added = addPartCopy(document, partId, kAway);
    expect(names(added.document, partId)).toEqual({
      [slot(document, partId, 1)]: 'Divider 2',
      [slot(document, partId, 2)]: 'Divider 3',
      [added.id]: 'Divider 4',
    });
    expect(names(reopened(added.document), partId)).toEqual(names(added.document, partId));
    const next = addPartCopy(added.document, partId, kAway);
    expect(names(next.document, partId)[next.id]).toBe('Divider 5');
  });

  it('keeps pattern copies named when a mirror is added', () => {
    const { document, partId } = tray();
    const before = names(document, partId);
    const mirrored = addPartMirror(document, partId, { across: { plane: 'right' } });
    expect(names(mirrored.document, partId)).toEqual({ ...before, [mirrored.id]: 'Divider 4' });
    expect(names(reopened(mirrored.document), partId)).toEqual(names(mirrored.document, partId));
  });

  it('gives a grown pattern the numbers no copy holds', () => {
    const { document, partId } = tray();
    const added = addPartCopy(document, partId, kAway);
    const grown = pattern(added.document, partId, 5);
    expect(names(grown, partId)).toEqual({
      [slot(document, partId, 1)]: 'Divider 2',
      [slot(document, partId, 2)]: 'Divider 3',
      [slot(document, partId, 3)]: 'Divider 5',
      [slot(document, partId, 4)]: 'Divider 6',
      [added.id]: 'Divider 4',
    });
  });

  it('names a pattern as before once its count goes down to one and back', () => {
    const { document, partId } = tray();
    const added = addPartCopy(document, partId, kAway);
    const single = pattern(added.document, partId, 1);
    expect(names(single, partId)).toEqual({ [added.id]: 'Divider 4' });
    expect(names(pattern(reopened(single), partId, 3), partId)).toEqual(names(added.document, partId));
  });

  it('keeps an excluded slot’s number, for the copies after it and for new ones', () => {
    const { document, partId } = tray();
    const detached = detachPartCopy(document, partId, slot(document, partId, 1));
    if ('error' in detached) throw new Error(detached.error);
    expect(detached.document.parts.find(part => part.id === detached.partId)!.name).toBe('Divider 2');
    const added = addPartCopy(detached.document, partId, kAway);
    expect(names(added.document, partId)).toEqual({ [slot(document, partId, 2)]: 'Divider 3', [added.id]: 'Divider 4' });
    expect(names(pattern(added.document, partId, 4), partId)[slot(document, partId, 3)]).toBe('Divider 5');
  });

  it('keeps names when a variable changes the count', () => {
    const { document: start, partId } = tray();
    const variable = setCadVariable(start, { name: 'dividers', expression: '3' });
    if ('error' in variable) throw new Error(variable.error);
    const document = setPartPattern(variable.document, partId, { axis: 'x', count: 3, countExpression: 'dividers', spacing: 84 });
    const added = addPartCopy(document, partId, kAway);
    const grown = setCadVariable(added.document, { id: variable.id, name: 'dividers', expression: '4' });
    if ('error' in grown) throw new Error(grown.error);
    expect(names(applyCadVariables(grown.document), partId)).toEqual({
      [slot(document, partId, 1)]: 'Divider 2',
      [slot(document, partId, 2)]: 'Divider 3',
      [slot(document, partId, 3)]: 'Divider 5',
      [added.id]: 'Divider 4',
    });
  });

  it('numbers copies saved without numbers as before', () => {
    const divider = createPlateDocument({ width: 200, height: 60, thickness: 12 }).parts[0]!;
    divider.name = 'Divider';
    divider.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    const document = setPartPattern(
      { ...createCadDocument(), parts: [{ ...divider, copies: [{ id: 'by-hand', ...kAway }] }] },
      divider.id,
      { axis: 'x', count: 3, spacing: 84 }
    );
    expect(names(document, divider.id)).toEqual({
      'by-hand': 'Divider 2',
      [slot(document, divider.id, 1)]: 'Divider 3',
      [slot(document, divider.id, 2)]: 'Divider 4',
    });
    expect(() => parseCadDocument({ ...document, parts: [{ ...document.parts[0]!, copies: [{ id: 'x', number: 1.5 }] }] })).toThrow(/copy/);
  });

  it('lists the same names for the pieces to cut', async () => {
    const { document, partId } = tray();
    const added = addPartCopy(document, partId, kAway);
    const solved = await solveCadDocument(added.document);
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(
      cadPartsToCut(solved.document, solved.parts)
        .flatMap(piece => piece.names)
        .sort()
    ).toEqual(['Divider', 'Divider 2', 'Divider 3', 'Divider 4']);
  });
});
