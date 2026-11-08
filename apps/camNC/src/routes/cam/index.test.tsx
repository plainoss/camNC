import { createJob, getJob, listJobs, saveJob } from '@/cam/jobDb';
import { createPlateDocument } from '@wbcnc/cad';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from './index';

const toastError = vi.hoisted(() => vi.fn());
const picked = vi.hoisted(() => ({ file: null as File | null }));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => () => undefined,
  useSearch: () => ({}),
  Link: ({ children, className }: { children: ReactNode; className?: string }) => <a className={className}>{children}</a>,
}));
vi.mock('@/components/page-header', () => ({ PageHeader: ({ title }: { title: string }) => <header>{title}</header> }));
vi.mock('@wbcnc/ui/components/sonner', () => ({ toast: Object.assign(vi.fn(), { error: toastError }) }));
vi.mock('@/cam/openModelFile', async importOriginal => ({
  ...(await importOriginal<typeof import('@/cam/openModelFile')>()),
  pickModelFile: async () => picked.file,
}));

const CamIndex = (Route as unknown as { options: { component: ComponentType } }).options.component;

afterEach(cleanup);

const renderIndex = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CamIndex />
    </QueryClientProvider>
  );

describe('CAM job list', () => {
  it('titles the start page and its saved list as projects', async () => {
    await createJob(new File(['x'], 'saved-project.step'));
    renderIndex();
    expect(screen.getByRole('banner').textContent).toBe('Projects');
    expect(await screen.findByRole('heading', { name: 'Recent projects' })).toBeTruthy();
  });

  it('says so when the picked file is not a model, and makes no job', async () => {
    const before = (await listJobs()).length;
    picked.file = new File(['hello'], 'notes.txt');
    renderIndex();
    fireEvent.click(screen.getByRole('button', { name: /Open model/ }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Not a STEP, STL or design file', { description: expect.stringContaining('notes.txt') })
    );
    expect(await listJobs()).toHaveLength(before);
  });

  it('starts a draft job from a design file, labelled as imported', async () => {
    picked.file = new File([JSON.stringify(createPlateDocument({ name: 'Scripted plate' }))], 'plate.json');
    renderIndex();
    fireEvent.click(screen.getByRole('button', { name: /Open model/ }));
    await waitFor(async () => expect((await listJobs()).some(job => job.name === 'Scripted plate')).toBe(true));
    const job = (await listJobs()).find(candidate => candidate.name === 'Scripted plate')!;
    expect(job).toMatchObject({ origin: { kind: 'designFile', fileName: 'plate.json' }, design: { acceptedRevision: 0 } });
    expect(job.design!.accepted).toBeUndefined();
    cleanup();
    renderIndex();
    expect((await screen.findByText(/Imported design · Native design/)).textContent).toBeTruthy();
  });

  it('says what is wrong with a design file it cannot read, and makes no job', async () => {
    const before = (await listJobs()).length;
    picked.file = new File(['{"version": 9}'], 'broken.json');
    renderIndex();
    fireEvent.click(screen.getByRole('button', { name: /Open model/ }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        expect.stringMatching(/^broken\.json isn’t a camNC design|^broken\.json isn't a camNC design/)
      )
    );
    expect(await listJobs()).toHaveLength(before);
  });

  it('marks a job whose model could not be read, and offers to delete it', async () => {
    const job = await createJob(new File(['x'], `broken-${crypto.randomUUID()}.step`));
    await saveJob({ ...job, readError: 'broken.step could not be read' });
    renderIndex();
    const row = (await screen.findByText(job.name)).closest('li')!;
    expect(within(row).getByText('Could not be read')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: `Delete ${job.name}` }));
    await waitFor(async () => expect(await getJob(job.id)).toBeNull());
  });

  it('labels a job opened from the same file again', async () => {
    const name = `regal-${crypto.randomUUID()}`;
    const first = await createJob(new File(['x'], `${name}.step`));
    const second = await createJob(new File(['x'], `${name}.step`));
    expect([first.name, second.name]).toEqual([name, `${name} (2)`]);
  });
});
