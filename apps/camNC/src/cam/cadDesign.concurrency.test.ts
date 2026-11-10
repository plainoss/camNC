import { createPlateDocument, updateDimension } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { saveDesignDraft } from './cadDesign';
import { createDesignJob, getJob } from './jobDb';

it('S5 rejects an old editor source even when its route has refreshed to another view’s newer job', async () => {
  const empty = await createDesignJob('Concurrent native draft');
  const document = { ...createPlateDocument(), id: empty.design!.draft.id };
  const savedA = await saveDesignDraft(empty, document);
  const width = document.parts[0].sketch.constraints.find(c => c.label === 'Width')!;
  const draftB = updateDimension(document, width.id, 180);
  const savedB = await saveDesignDraft(savedA, draftB);
  const staleEdit = updateDimension(document, width.id, 160);
  // The third argument is the editor's actual source, independent of refreshed route data.
  await expect(saveDesignDraft(savedB, staleEdit, document)).rejects.toThrow(/changed in another view/);
  expect((await getJob(savedA.id))!.design!.draft).toEqual(draftB);
});

it('starts a new design in cm and saves a renamed title and preference without accepting geometry', async () => {
  const original = await createDesignJob();
  expect(original.design!.draft.lengthUnit).toBe('cm');
  const draft = { ...original.design!.draft, name: 'Cupboard', lengthUnit: 'in' as const };
  const saved = await saveDesignDraft(original, draft);
  expect(saved.name).toBe('Cupboard');
  expect(saved.fileName).toBe('Cupboard');
  expect((await getJob(saved.id))!.design!.draft).toEqual(draft);
  expect(saved.design!.accepted).toBeUndefined();
});
