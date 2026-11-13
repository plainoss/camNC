import { createPlateDocument } from '@wbcnc/cad';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDemoModeForTest } from '@/lib/demo/demo-mode';
import {
  createCarvingJob,
  createDesignJob,
  createJob,
  deleteJob,
  getJob,
  getModelBytes,
  importDesignJob,
  listJobs,
  replaceModel,
  saveJob,
  updateJobForModel,
} from './jobDb';

const context = vi.hoisted(() => ({ rehearsal: null as string | null }));
vi.mock('@/lib/demo/demo-mode', async original => ({
  ...(await original<typeof import('@/lib/demo/demo-mode')>()),
  getRehearsalId: () => context.rehearsal,
}));

afterEach(() => {
  setDemoModeForTest(false);
  context.rehearsal = null;
});

// The saved and demo databases and a rehearsal's memory are one kind of store: every job function behaves the same.
describe.each(['saved', 'demo', 'rehearsal'] as const)('job functions over the %s store', kind => {
  const enter = () => {
    setDemoModeForTest(kind !== 'saved');
    context.rehearsal = kind === 'rehearsal' ? 'rehearsal' : null;
  };

  it('hands out copies, so changing a job that was read or saved leaves the stored one alone', async () => {
    enter();
    const parts = [{ id: 'a', name: 'Side', quantity: 2, milled: true }];
    const job = await createJob(new File(['bytes'], 'copies.step'), { parts });
    parts[0]!.name = 'Changed default';
    job.parts[0]!.name = 'Changed result';
    const read = (await getJob(job.id))!;
    expect(read.parts[0]!.name).toBe('Side');
    read.parts[0]!.name = 'Changed read';
    (await listJobs()).find(listed => listed.id === job.id)!.parts[0]!.name = 'Changed listing';
    (await getModelBytes(job.id))!.fill(0);
    expect((await getJob(job.id))!.parts[0]!.name).toBe('Side');
    expect(new TextDecoder().decode((await getModelBytes(job.id))!)).toBe('bytes');
  });

  it('updates a job only while it exists with the model the update was computed from', async () => {
    enter();
    const job = await createJob(new File(['first'], 'guarded.step'));
    const update = vi.fn((current: typeof job) => ({ ...current, nestObjective: 'wood' as const }));
    const updated = await updateJobForModel(job, update);
    expect(updated).toMatchObject({ id: job.id, nestObjective: 'wood' });
    expect(await getJob(job.id)).toEqual(updated);
    // Null from the update stores nothing.
    expect(await updateJobForModel(job, () => null)).toBeNull();
    expect(await getJob(job.id)).toEqual(updated);

    const replaced = await replaceModel(job, new File(['second'], 'guarded.step'));
    expect(replaced).toMatchObject({ modelRevision: 1, nestObjective: 'wood' });
    update.mockClear();
    expect(await updateJobForModel(job, update)).toBeNull();
    await expect(saveJob({ ...job, name: 'Late edit' }, job)).rejects.toThrow('This job or its model changed');
    expect(update).not.toHaveBeenCalled();
    expect(await getJob(job.id)).toEqual(replaced);

    await deleteJob(job.id);
    expect(await updateJobForModel(replaced, update)).toBeNull();
    await expect(replaceModel(replaced, new File(['third'], 'guarded.step'))).rejects.toThrow('This job no longer exists');
    expect(update).not.toHaveBeenCalled();
    expect(await getJob(job.id)).toBeNull();
    expect(await getModelBytes(job.id)).toBeNull();
  });

  it('saves a job without a base whatever is stored, even nothing', async () => {
    enter();
    const job = await createDesignJob(`Blind ${crypto.randomUUID()}`);
    await deleteJob(job.id);
    const saved = await saveJob({ ...job, name: 'Restored' });
    expect(saved.updatedAt).toBeGreaterThanOrEqual(job.updatedAt);
    expect(await getJob(job.id)).toEqual(saved);
    await deleteJob(job.id);
  });

  it('lists the most recently saved job first', async () => {
    enter();
    const older = await createDesignJob(`Order ${crypto.randomUUID()}`);
    const newer = await createDesignJob(`Order ${crypto.randomUUID()}`);
    const order = async () => (await listJobs()).map(job => job.id).filter(id => id === older.id || id === newer.id);
    await saveJob({ ...newer, updatedAt: 0 });
    vi.spyOn(Date, 'now').mockReturnValue(newer.updatedAt + 60_000);
    try {
      await saveJob(older);
    } finally {
      vi.restoreAllMocks();
    }
    expect(await order()).toEqual([older.id, newer.id]);
  });

  it('starts every kind of job under a name no other job has', async () => {
    enter();
    const name = `Shelf ${crypto.randomUUID()}`;
    const model = await createJob(new File(['bytes'], `${name}.step`));
    const named = await createJob(new File(['bytes'], 'other.stl'), { name });
    const design = await createDesignJob(name);
    const carving = await createCarvingJob(name);
    const imported = await importDesignJob({ ...createPlateDocument(), name }, 'plate.json');
    expect([model, named, design, carving, imported].map(job => job.name)).toEqual([
      name,
      `${name} (2)`,
      `${name} (3)`,
      `${name} (4)`,
      `${name} (5)`,
    ]);
    expect([model, named, design, carving, imported].map(job => job.fileName)).toEqual([
      `${name}.step`,
      'other.stl',
      `${name} (3)`,
      `${name} (4)`,
      'plate.json',
    ]);
    expect(design.design!.draft.name).toBe(`${name} (3)`);
    expect(imported.design!.draft.name).toBe(`${name} (5)`);
    for (const job of [model, named, design, carving, imported]) {
      expect(job).toMatchObject({ v: 1, parts: [] });
      expect(job.updatedAt).toBe(job.createdAt);
      expect(await getJob(job.id)).toEqual(job);
    }
  });
});
