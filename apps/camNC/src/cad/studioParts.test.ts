import { cadCopyName, setPartPattern, type CadDocument } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import cupboard from '../../../../packages/cad-script/fixtures/designs/cupboard.json';
import { builtStudioParts } from './studioParts';

const cabinet = () => structuredClone(cupboard) as CadDocument;

it('omits suppressed mirrors and pattern instances while preserving their source identities and names', () => {
  const source = cabinet(),
    shelfId = source.parts.find(part => part.name === 'Shelf')!.id;
  const patterned = setPartPattern(source, shelfId, { axis: 'z', count: 4, spacing: 120 });
  const side = patterned.parts.find(part => part.name === 'Side')!,
    shelf = patterned.parts.find(part => part.name === 'Shelf')!;
  side.copies![0]!.suppressed = true;
  shelf.pattern!.suppressed = true;
  const active = builtStudioParts(patterned);
  expect(active.map(part => part.name)).toEqual(['Side', 'Bottom', 'Top', 'Back', 'Shelf']);
  expect(active.find(part => part.name === 'Side')!.copies).toBeUndefined();
  expect(active.find(part => part.name === 'Shelf')!.copies).toBeUndefined();
  expect(side.copies).toHaveLength(1);
  expect(shelf.copies).toHaveLength(3);
  delete shelf.pattern!.suppressed;
  const restored = builtStudioParts(patterned).find(part => part.name === 'Shelf')!;
  expect(restored.copies!.map(copy => copy.id)).toEqual(shelf.copies!.map(copy => copy.id));
  expect(restored.copies!.map((_, index) => cadCopyName(restored, index))).toEqual(['Shelf 2', 'Shelf 3', 'Shelf 4']);
});

it('omits consumed tools and restores their membership when the cut is suppressed', () => {
  const document = cabinet();
  document.partCuts![0]!.consumeTools = true;
  expect(builtStudioParts(document).map(part => part.name)).toEqual(['Side', 'Shelf']);
  document.partCuts![0]!.suppressed = true;
  expect(builtStudioParts(document).map(part => part.name)).toEqual(['Side', 'Bottom', 'Top', 'Back', 'Shelf']);
});

it('lists a different-sketch Extrude Add under its host instead of counting another part', () => {
  const document = cabinet(),
    side = document.parts.find(part => part.name === 'Side')!,
    back = document.parts.find(part => part.name === 'Back')!;
  expect(back.sketch.id).not.toBe(side.sketch.id);
  back.addTo = side.id;
  expect(builtStudioParts(document).map(part => part.name)).toEqual(['Side', 'Bottom', 'Top', 'Shelf']);
});
