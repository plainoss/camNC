import { createJob, getJob, getModelBytes } from '@/cam/jobDb';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Toaster, toast } from '@wbcnc/ui/components/sonner';
import { afterEach, describe, expect, it } from 'vitest';
import { deleteJobWithUndo, useHiddenJobIds } from './pendingJobDeletions';

afterEach(() => {
  act(() => toast.dismiss());
  cleanup();
});

function Hidden() {
  return <output>{[...useHiddenJobIds()].join(',')}</output>;
}
const saveProject = () => createJob(new File(['solid'], `shelf-${crypto.randomUUID()}.step`));

describe('deleting a project with Undo', () => {
  it('brings the project back from the toast’s Undo button, without touching storage', async () => {
    const job = await saveProject();
    render(
      <>
        <Toaster />
        <Hidden />
      </>
    );
    act(() => deleteJobWithUndo(job));
    expect(screen.getByRole('status').textContent).toBe(job.id);
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull());
    expect(screen.getByRole('status').textContent).toBe('');
    expect(await getJob(job.id)).toEqual(job);
    expect(await getModelBytes(job.id)).not.toBeNull();
  });

  it('removes the project and its model once the toast closes', async () => {
    const job = await saveProject();
    let removed = 0;
    render(
      <>
        <Toaster />
        <Hidden />
      </>
    );
    act(() => deleteJobWithUndo(job, () => removed++));
    expect(await screen.findByText(`Deleted ${job.name}`)).toBeTruthy();
    act(() => toast.dismiss());
    await waitFor(async () => expect(await getJob(job.id)).toBeNull());
    expect(await getModelBytes(job.id)).toBeNull();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(''));
    expect(removed).toBe(1);
  });
});
