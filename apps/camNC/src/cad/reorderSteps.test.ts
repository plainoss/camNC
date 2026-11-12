import {
  createCadDocument,
  createCadFolder,
  createPlateDocument,
  edgeFilletProblems,
  evaluateCadPart,
  parseCadDocument,
  polygonArea,
  type CadDocument,
  type CadPart,
} from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { designSteps } from '@wbcnc/cad';
import { reorderDrop, reorderedSteps } from './reorderSteps';

const plate = (name: string) => ({ ...createPlateDocument({ width: 100, height: 50 }).parts[0]!, name });
const step = (document: CadDocument, id: string) => designSteps(document).find(candidate => candidate.id === id)!;
const rounded = (name: string, ids: string[]) => ({ ...plate(name), fillets: ids.map(id => ({ id, corners: [], radius: 5 })) });

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

describe('where a dragged step would land', () => {
  it('lands a part ahead of the first step of the part it’s dropped on, and nowhere when dropped on itself', () => {
    const [a, b, c] = [plate('A'), plate('B'), plate('C')];
    const document: CadDocument = { ...createCadDocument(), parts: [a, b, c] };
    expect(reorderDrop(document, `${c.id}:sketch`, `${b.id}:extrude`)).toEqual({ before: `${b.id}:sketch` });
    expect(reorderDrop(document, `${a.id}:extrude`, `${c.id}:sketch`)).toEqual({ before: `${c.id}:sketch` });
    expect(reorderDrop(document, `${b.id}:extrude`, `${b.id}:sketch`)).toBeNull();
    expect(reorderDrop(document, `${b.id}:extrude`, `${b.id}:extrude`)).toBeNull();
    // Dropped on the part right after it, a part stays where it is.
    expect(reorderDrop(document, `${a.id}:extrude`, `${b.id}:sketch`)).toBeNull();
  });

  it('lands a part used by a Cut parts step ahead of the part dropped on, not at the cut that moves along with it', () => {
    const [side, back, shelf] = [plate('Side'), plate('Back'), plate('Shelf')];
    const document: CadDocument = {
      ...createCadDocument(),
      parts: [side, back, shelf],
      partCuts: [{ id: 'joint', tools: [shelf.id], targets: [side.id], clearance: 0 }],
    };
    expect(reorderDrop(document, `${shelf.id}:extrude`, `${back.id}:extrude`)).toEqual({ before: `${back.id}:sketch` });
  });

  it('says why a step can’t go where it’s dragged', () => {
    const a = plate('A');
    const b = { ...plate('B'), drawnOn: { on: { partId: a.id, face: 'top' as const }, offset: 0 } };
    const document: CadDocument = { ...createCadDocument(), parts: [a, b] };
    expect(reorderDrop(document, `${b.id}:extrude`, `${a.id}:sketch`)).toEqual({ error: 'B is built on A, so it comes after it.' });
  });
});

describe('reordering fillets', () => {
  const cupboard = () => {
    const [top, back, shelf] = [plate('Top'), rounded('Back', ['round']), plate('Shelf')];
    return { top, back, shelf, document: { ...createCadDocument(), parts: [top, back, shelf] } as CadDocument };
  };

  it('moves a fillet’s part with it when it’s dropped on another part', () => {
    const { top, back, document } = cupboard();
    const result = reorderedSteps(document, step(document, 'round'), step(document, `${top.id}:extrude`));
    if ('error' in result) throw new Error(result.error);
    expect(result.document.parts.map(part => part.name)).toEqual(['Back', 'Top', 'Shelf']);
    expect(result.document.parts[0]!.fillets).toEqual(back.fillets);
    expect(reorderDrop(document, 'round', `${top.id}:extrude`)).toEqual({ before: `${top.id}:sketch` });
  });

  it('takes a part dropped on another part’s fillet ahead of that part', () => {
    const { back, shelf, document } = cupboard();
    const result = reorderedSteps(document, step(document, `${shelf.id}:extrude`), step(document, 'round'));
    if ('error' in result) throw new Error(result.error);
    expect(result.document.parts.map(part => part.name)).toEqual(['Top', 'Shelf', 'Back']);
    expect(reorderDrop(document, `${shelf.id}:extrude`, 'round')).toEqual({ before: `${back.id}:sketch` });
  });

  it('reorders a part’s fillets among themselves, and puts one dropped on a copy last', () => {
    const part = { ...rounded('Back', ['first', 'second']), copies: [{ id: 'copy' }] };
    const document: CadDocument = { ...createCadDocument(), parts: [part] };
    const swapped = reorderedSteps(document, step(document, 'second'), step(document, 'first'));
    if ('error' in swapped) throw new Error(swapped.error);
    expect(swapped.document.parts[0]!.fillets!.map(fillet => fillet.id)).toEqual(['second', 'first']);
    expect(reorderDrop(document, 'second', 'first')).toEqual({ before: 'first' });
    const last = reorderedSteps(document, step(document, 'first'), step(document, 'copy'));
    if ('error' in last) throw new Error(last.error);
    expect(last.document.parts[0]!.fillets!.map(fillet => fillet.id)).toEqual(['second', 'first']);
    // Already just before the fillet after it, a fillet stays put.
    expect(reorderDrop(document, 'first', 'second')).toBeNull();
  });

  it('keeps a fillet after the extrude whose edges it rounds, and says so', () => {
    const { back, document } = cupboard();
    const why = 'Fillet · Back rounds the edges Extrude · Back makes, so it comes after it.';
    expect(reorderDrop(document, 'round', `${back.id}:extrude`)).toEqual({ error: why });
    expect(reorderDrop(document, 'round', `${back.id}:sketch`)).toEqual({ error: why });
  });

  it('keeps a part built on a filleted part after it when the fillet is dragged', () => {
    const top = plate('Top');
    const back = { ...rounded('Back', ['round']), drawnOn: { on: { partId: top.id, face: 'top' as const }, offset: 0 } };
    const document: CadDocument = { ...createCadDocument(), parts: [top, back] };
    expect(reorderDrop(document, 'round', `${top.id}:sketch`)).toEqual({ error: 'Back is built on Top, so it comes after it.' });
  });

  it('keeps a face sketch with its part, and puts it last of its part’s face steps when dropped on its fillet', () => {
    const back = rounded('Back', ['round']);
    const faces = ['early', 'late'].map(id => ({
      type: 'sketch' as const,
      id,
      on: 'top' as const,
      sketch: { ...back.sketch, id: `${id}-sketch` },
    }));
    const top = plate('Top');
    const document: CadDocument = { ...createCadDocument(), parts: [top, { ...back, features: faces }] };
    const last = reorderedSteps(document, step(document, 'early'), step(document, 'round'));
    if ('error' in last) throw new Error(last.error);
    expect(last.document.parts[1]!.features!.map(feature => feature.id)).toEqual(['late', 'early']);
    expect(reorderDrop(document, 'early', `${top.id}:sketch`)).toEqual({
      error: 'Sketch on the top · Back is on Back’s faces, so it stays with Back’s steps.',
    });
  });

  it('draws the line where a step that goes last lands, not at the row it’s dropped on', () => {
    const back = { ...rounded('Back', ['first', 'second']), copies: [{ id: 'one' }, { id: 'two' }] };
    const faces = ['early', 'late'].map(id => ({
      type: 'sketch' as const,
      id,
      on: 'top' as const,
      sketch: { ...back.sketch, id: `${id}-sketch` },
    }));
    const document: CadDocument = { ...createCadDocument(), parts: [{ ...back, features: faces }] };
    // A face sketch dropped on the second fillet goes last of the face steps, just ahead of the first fillet.
    expect(reorderDrop(document, 'early', 'second')).toEqual({ before: 'first' });
    expect(reorderDrop(document, 'early', 'two')).toEqual({ before: 'first' });
    // A fillet dropped on the second copy goes last of the fillets, just ahead of the first copy.
    expect(reorderDrop(document, 'first', 'two')).toEqual({ before: 'one' });
  });

  it('names the Transform a face sketch follows', () => {
    const back: CadPart = { ...rounded('Back', ['round']), moved: { by: [10, 0, 0] } };
    const face = { type: 'sketch' as const, id: 'face', on: 'top' as const, sketch: { ...back.sketch, id: 'face-sketch' } };
    const document: CadDocument = { ...createCadDocument(), parts: [{ ...back, features: [face] }] };
    expect(reorderDrop(document, 'face', `${back.id}:extrude`)).toEqual({
      error: 'Sketch on the top · Back is on Back’s faces, so it comes after Transform · Back.',
    });
    expect(reorderDrop(document, 'round', 'face')).toEqual({
      error: 'Fillet · Back rounds Back’s outline, so it moves only among its fillets.',
    });
  });

  it('swaps which of two fillets on the same corner rounds it', () => {
    const part = plate('Back');
    const corner = part.sketch.entities.find(entity => entity.type === 'point' && entity.x === 100 && entity.y === 50)!.id;
    const filleted = {
      ...part,
      fillets: [
        { id: 'small', corners: [corner], radius: 5 },
        { id: 'large', corners: [corner], radius: 20 },
      ],
    };
    const document: CadDocument = { ...createCadDocument(), parts: [filleted] };
    const area = (made: CadPart) => Math.abs(polygonArea(evaluateCadPart(made).part!.outline));
    const cornerArea = (radius: number) => 5000 - radius * radius * (1 - Math.PI / 4);
    expect(area(filleted)).toBeCloseTo(cornerArea(5), 0);
    expect(edgeFilletProblems(filleted).map(problem => problem.filletId)).toEqual(['large']);
    const swapped = reorderedSteps(document, step(document, 'large'), step(document, 'small'));
    if ('error' in swapped) throw new Error(swapped.error);
    const reordered = swapped.document.parts[0]!;
    expect(area(reordered)).toBeCloseTo(cornerArea(20), 0);
    expect(edgeFilletProblems(reordered).map(problem => problem.filletId)).toEqual(['small']);
  });
});

describe('reordering around a Remove', () => {
  it('keeps a part after the bodies its Remove picked', () => {
    const [board, other] = [plate('Board'), plate('Other')];
    const pocket = { ...plate('Pocket'), remove: { depth: 6, targets: [board.id] } };
    const document: CadDocument = { ...createCadDocument(), parts: [board, other, pocket] };
    expect(reorderDrop(document, `${pocket.id}:extrude`, `${board.id}:sketch`)).toEqual({
      error: 'Pocket is built on Board, so it comes after it.',
    });
  });

  it('won’t take a body past a plane Remove that cuts every body before it', () => {
    const [board, shelf] = [rounded('Board', ['round']), plate('Shelf')];
    const pocket = { ...plate('Pocket'), drawnOn: { on: { plane: 'top' as const }, offset: 0 }, remove: { depth: 6 } };
    const document: CadDocument = { ...createCadDocument(), parts: [board, pocket, shelf] };
    const why = 'Extrude · Pocket cuts Board, so Board comes before it.';
    expect(reorderDrop(document, 'round', `${shelf.id}:sketch`)).toEqual({ error: why });
    expect(reorderDrop(document, `${pocket.id}:extrude`, `${board.id}:sketch`)).toEqual({ error: why });
    // A body moved ahead of it is cut too, which is a move the Remove can take.
    expect(reorderDrop(document, `${shelf.id}:extrude`, `${pocket.id}:sketch`)).toEqual({ before: `${pocket.id}:sketch` });
  });

  describe('lets a body past a Remove that cuts nothing', () => {
    const [board, shelf] = [plate('Board'), plate('Shelf')];
    const planePocket = { ...plate('Pocket'), drawnOn: { on: { plane: 'top' as const }, offset: 0 }, remove: { depth: 6 } };
    const movesPast = (pocket: CadPart, extra: Partial<CadDocument> = {}) => {
      const document: CadDocument = { ...createCadDocument(), parts: [board, pocket, shelf], ...extra };
      expect(reorderDrop(document, `${board.id}:sketch`, `${shelf.id}:sketch`)).toEqual({ before: `${shelf.id}:sketch` });
    };

    it('when it’s suppressed', () => movesPast({ ...planePocket, suppressed: true }));
    it('when its folder is suppressed', () =>
      movesPast(planePocket, { folders: [{ id: 'off', name: 'Off', partIds: [planePocket.id], suppressed: true }] }));
    it('when it’s only a sketch', () => movesPast({ ...planePocket, extrude: false }));
    it('when it’s a Hole', () => movesPast({ ...planePocket, hole: { diameter: 5 } }));
  });
});
