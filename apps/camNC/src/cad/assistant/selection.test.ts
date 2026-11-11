import { createPlateDocument, setPartPattern } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { assistantSelection } from './selection';

it('keeps the exact physical-copy identity and displayed name in model context', () => {
  const source = createPlateDocument();
  source.parts[0].name = 'Shelf';
  const document = setPartPattern(source, source.parts[0].id, { axis: 'z', count: 3, spacing: 100 });
  const copyId = document.parts[0].copies![0].id;
  expect(assistantSelection(document, { partId: source.parts[0].id, copyId })).toEqual({
    partId: source.parts[0].id,
    copyId,
    name: 'Shelf 2',
  });
  expect(assistantSelection(document, { partId: source.parts[0].id })).toEqual({ partId: source.parts[0].id, name: 'Shelf' });
});

it('leaves out an empty sketch, so a new studio is talked about as a whole', () => {
  const document = createPlateDocument();
  document.parts[0].sketch.entities = [];
  expect(assistantSelection(document, { partId: document.parts[0].id })).toBeUndefined();
});
