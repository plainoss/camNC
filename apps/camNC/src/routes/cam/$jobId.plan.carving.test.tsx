import { createCarvingJob, getJob, saveJob } from '@/cam/jobDb';
import { kVBits } from '@/cam/carving';
import { kDefaultPlan } from '@/cam/planSettings';
import type { PlanResult } from '@/cam/camTypes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from './$jobId.plan';

const params = vi.hoisted(() => ({ jobId: '' }));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useParams: () => params,
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  Link: ({ children, to, params, ...rest }: { children: ReactNode; to: string; params?: { jobId: string } }) => (
    <a href={params ? to.replace('$jobId', params.jobId) : to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/page-header', () => ({ PageHeader: () => null }));
// The plan itself is the worker's (`carving.test.ts`); this is about what the bar says the carving is cut with.
vi.mock('@/cam/camQueries', async importOriginal => {
  const plan: PlanResult = {
    gcode: '',
    timeMin: 0,
    warnings: [],
    safety: [],
    ops: [],
    bits: [6],
    programs: [{ tool: 14, diameter: 6, gcode: 'G0 Z13\n', timeMin: 0 }],
    size: [300, 140, 18],
    path: [],
  } as unknown as PlanResult;
  return {
    ...(await importOriginal<typeof import('@/cam/camQueries')>()),
    useBoardPlans: (_job: unknown, boards: unknown[]) => boards.map(() => ({ data: plan, isFetching: false, isPending: false })),
  };
});

const PlanStep = (Route as unknown as { options: { component: ComponentType } }).options.component;

afterEach(cleanup);

describe('the Plan step of a carving', () => {
  it('shows the carving’s V-bit, not the job’s flat bit, and keeps the V-bit chosen on Carve', async () => {
    const created = await createCarvingJob();
    const vBit = kVBits.find(b => b.angle === 90 && b.diameter === 8)!;
    const job = await saveJob({ ...created, carving: { ...created.carving!, vBit } });
    params.jobId = job.id;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PlanStep />
      </QueryClientProvider>
    );
    const chip = await screen.findByRole('link', { name: /^Bits: 90° V-bit ⌀8 and ⌀3.175 flat/ }, { timeout: 30_000 });
    expect(chip.getAttribute('href')).toBe(`/cam/${job.id}/carve`);
    expect(screen.queryByRole('button', { name: new RegExp(`^Bit: ⌀${kDefaultPlan.bit.diameter}`) })).toBeNull();
    // Opening Plan changes nothing about the carving's bit.
    expect((await getJob(job.id))!.carving!.vBit).toEqual(vBit);
  }, 60_000);

  it('leaves the flat bit out when the V-bit clears the bottoms itself', async () => {
    const created = await createCarvingJob();
    const job = await saveJob({ ...created, carving: { ...created.carving!, clearWithFlat: false } });
    params.jobId = job.id;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PlanStep />
      </QueryClientProvider>
    );
    expect(await screen.findByRole('link', { name: /^Bits: 60° V-bit ⌀6\. Change them/ }, { timeout: 30_000 })).toBeTruthy();
  }, 60_000);
});
