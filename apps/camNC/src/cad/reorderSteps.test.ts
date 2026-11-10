import { createCadDocument, createCadFolder, createPlateDocument, parseCadDocument, type CadDocument } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { designSteps } from '@wbcnc/cad';
import { reorderedSteps } from './reorderSteps';

const plate = (name: string) => ({ ...createPlateDocument({ width: 100, height: 50 }).parts[0]!, name });
const step = (document: CadDocument, id: string) => designSteps(document).find(candidate => candidate.id === id)!;

describe('reordering steps', () => {
  it('moves a part’s steps together, ahead of the part dropped on', () => {
    const [a, b] = [plate('A'), plate('B')];
    const document: CadDocument = { ...createCadDocument(), parts: [a, b] };
    const result = reorderedSteps(document, step(document, `${b.id}:extrude`), step(document, `${a.id}:sketch`));
    if ('error' in result) throw new Error(result.error);
    expect(result.document.parts.map(part => part.name)).toEqual(['B', 'A']);
  });

  it('won’t put a part ahead of the part it’s drawn on', () => {
    const a = plate('A');
    const b = { ...plate('B'), drawnOn: { on: { partId: a.id, face: 'top' as const }, offset: 0 } };
    const document: CadDocument = { ...createCadDocument(), parts: [a, b] };
    expect(reorderedSteps(document, step(document, `${b.id}:sketch`), step(document, `${a.id}:sketch`))).toEqual({
      error: 'B is built on A, so it comes after it.',
    });
  });
  it('keeps a group contiguous when its parts are reordered and refuses moving one out', () => {
    const parts = [plate('A'), plate('B'), plate('Outside')];
    const made = createCadFolder({ ...createCadDocument(), parts }, { name: 'Box', partIds: parts.slice(0, 2).map(part => part.id) });
    if ('error' in made) throw new Error(made.error);
    const document = made.document;
    const internal = reorderedSteps(document, step(document, `${parts[1]!.id}:sketch`), step(document, `${parts[0]!.id}:sketch`));
    if ('error' in internal) throw new Error(internal.error);
    expect(internal.document.folders![0]!.partIds).toEqual([parts[1]!.id, parts[0]!.id]);
    expect(parseCadDocument(internal.document)).toEqual(internal.document);
    expect(reorderedSteps(document, step(document, `${parts[0]!.id}:sketch`), step(document, `${parts[2]!.id}:sketch`))).toHaveProperty(
      'error'
    );
    expect(reorderedSteps(document, step(document, `${parts[2]!.id}:sketch`), step(document, `${parts[1]!.id}:sketch`))).toHaveProperty(
      'error'
    );
  });
});
