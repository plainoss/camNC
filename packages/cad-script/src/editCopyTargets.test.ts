import { cadPartsToCut } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { editCad } from './edit';

it('creates and edits a Cut parts step with exact physical target handles', async () => {
  const first = await editCad(null, d => {
    const shelf = d.newPart('Shelf', { thickness: 18 });
    shelf.profile.rect({ at: [0, 0], w: 300, h: 200 });
    shelf.place({ at: [0, 0, 0] });
    const copies = shelf.pattern({ axis: 'z', count: 3, spacing: 100 });
    const tool = d.newPart('Cable chase', { thickness: 300 });
    tool.profile.rect({ at: [40, -10], w: 20, h: 40 });
    tool.place({ at: [0, 0, 0] });
    d.cutParts(copies[0]!, { with: tool });
  });
  expect(first.scriptError).toBeUndefined();
  const shelf = first.document.parts[0]!,
    step = first.document.partCuts![0]!;
  expect(step.targets).toEqual([`${shelf.id}:${shelf.copies![0]!.id}`]);
  expect(first.parts[0]!.cuts ?? []).toEqual([]);
  expect(first.parts[0]!.copyCuts?.[shelf.copies![0]!.id]).toHaveLength(1);
  expect(cadPartsToCut(first.document, first.parts).map(group => group.names)).toEqual([
    ['Shelf', 'Shelf 3'],
    ['Shelf 2'],
    ['Cable chase'],
  ]);
  const changed = await editCad(first.document, d => d.step(step.id).set({ targets: [d.existingCopy('Shelf 3')] }));
  expect(changed.scriptError).toBeUndefined();
  expect(changed.document.partCuts![0]!.targets).toEqual([`${shelf.id}:${shelf.copies![1]!.id}`]);
  expect(changed.parts[0]!.copyCuts?.[shelf.copies![0]!.id]).toBeUndefined();
  expect(changed.parts[0]!.copyCuts?.[shelf.copies![1]!.id]).toHaveLength(1);
  expect(changed.report.steps?.find(step => step.kind === 'partCut')).toMatchObject({ targets: ['Shelf 3'] });
});
