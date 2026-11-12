import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDesignJob, getJob, saveJob, type CamJobV1 } from './jobDb';

afterEach(() => vi.restoreAllMocks());

/** An inch design job stored as the app stored it before plain numbers took the design's unit. */
async function legacyJob(): Promise<CamJobV1> {
  const empty = await createDesignJob('Legacy inch plate');
  const draft: CadDocument = {
    ...createPlateDocument(),
    id: empty.design!.draft.id,
    lengthUnit: 'in',
    variables: [{ id: 't', name: 't', expression: '0.75 in' }],
  };
  Object.assign(draft.parts[0]!, { thickness: 19.175, thicknessExpression: 't + 0.125' });
  return saveJob({ ...empty, design: { ...empty.design!, draft } });
}

const storedExpression = async (id: string) => {
  // Read straight from IndexedDB, without the migration getJob applies.
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open('camnc-cam');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  const job = await new Promise<CamJobV1>((resolve, reject) => {
    const read = db.transaction('jobs').objectStore('jobs').get(id);
    read.onsuccess = () => resolve(read.result as CamJobV1);
    read.onerror = () => reject(read.error);
  });
  db.close();
  return { name: job.name, expression: job.design!.draft.parts[0]!.thicknessExpression };
};

describe('opening a stored design saved before plain numbers took its unit', () => {
  it('stores the migrated design, so the editor starts from what is stored', async () => {
    const job = await legacyJob();
    expect(await storedExpression(job.id)).toMatchObject({ expression: 't + 0.125' });
    expect((await getJob(job.id))!.design!.draft.parts[0]!.thicknessExpression).toBe('t + 0.125 mm');
    expect(await storedExpression(job.id)).toMatchObject({ expression: 't + 0.125 mm' });
  });

  it('leaves a job changed between the read and the write-back as it was changed', async () => {
    const job = await legacyJob();
    // Saved while getJob's read is in flight: its write-back finds a newer job and doesn't replace it.
    const reading = getJob(job.id);
    const newer = saveJob({ ...job, name: 'Renamed elsewhere' });
    const read = await reading;
    await newer;
    expect(read!.design!.draft.parts[0]!.thicknessExpression).toBe('t + 0.125 mm');
    expect(await storedExpression(job.id)).toEqual({ name: 'Renamed elsewhere', expression: 't + 0.125' });
    // The next read migrates the newer job.
    expect(await getJob(job.id)).toMatchObject({ name: 'Renamed elsewhere' });
    expect(await storedExpression(job.id)).toEqual({ name: 'Renamed elsewhere', expression: 't + 0.125 mm' });
  });

  it('still opens the job when the write-back fails', async () => {
    const job = await legacyJob();
    // As a full or blocked database does: the write-back's transaction aborts.
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore) {
      this.transaction.abort();
      return undefined as unknown as IDBRequest<IDBValidKey>;
    });
    expect((await getJob(job.id))!.design!.draft.parts[0]!.thicknessExpression).toBe('t + 0.125 mm');
    vi.restoreAllMocks();
    expect(await storedExpression(job.id)).toMatchObject({ expression: 't + 0.125' });
  });
});
