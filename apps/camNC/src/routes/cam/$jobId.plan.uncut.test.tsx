import { parseCadDocument, setCadVariable } from '@wbcnc/cad';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import fittedJoints from '../../../../../packages/cad-script/fixtures/designs/fitted-joints.json';
import { acceptDesign, saveDesignDraft } from '@/cam/cadDesign';
import type { PlanResult } from '@/cam/camTypes';
import { createDesignJob, saveJob } from '@/cam/jobDb';
import { newBoard } from '@/cam/boards';
import { kDefaultPlan } from '@/cam/planSettings';
import { usePlanLayout } from '@/cam/plan/planLayoutStore';
import { Route } from './$jobId.plan';

const state = vi.hoisted(() => ({ jobId: '', plans: [] as (PlanResult | undefined)[] }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useParams: () => ({ jobId: state.jobId }),
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/components/page-header', () => ({ PageHeader: () => null }));
vi.mock('@/cam/plan3d/PlanView3D', () => ({ PlanView3D: () => null }));
vi.mock('@/cam/camQueries', async importOriginal => {
  const real = await importOriginal<typeof import('@/cam/camQueries')>();
  return {
    ...real,
    useBoardPlans: (...args: Parameters<typeof real.useBoardPlans>) => {
      const results = real.useBoardPlans(...args);
      state.plans = results.map(result => result.data);
      return results;
    },
  };
});
afterEach(() => {
  cleanup();
  usePlanLayout.setState(usePlanLayout.getInitialState(), true);
});
const Plan = (Route as unknown as { options: { component: ComponentType } }).options.component;

it('fingers narrower than the bit: Plan says the joint won’t be cut, before any "passed"', async () => {
  const empty = await createDesignJob('Narrow fingers');
  const source = parseCadDocument(fittedJoints);
  const changed = setCadVariable(source, {
    id: source.variables!.find(v => v.name === 'fingers')!.id,
    name: 'fingers',
    expression: '60',
  });
  if ('error' in changed) throw new Error(changed.error);
  const document = { ...changed.document, id: empty.design!.draft.id };
  const accepted = await acceptDesign(await saveDesignDraft(empty, document), document);
  const [front, side, legA, legB] = ['Front', 'Side', 'Leg A', 'Leg B'].map(
    name => `${document.parts.find(part => part.name === name)!.id}#0`
  );
  const board = {
    ...newBoard([], 18, 'plywood', [front!, side!]),
    size: { fit: false as const, w: 360, h: 280 },
    margin: 10,
    gap: 10,
    retention: 'skin' as const,
    pinned: [front!, side!],
    layout: { w: 360, h: 280, at: { [front!]: { x: 20, y: 20, rotated: false }, [side!]: { x: 20, y: 150, rotated: false } } },
  };
  const job = await saveJob({ ...accepted, boards: [board], plan: { ...kDefaultPlan, leaveOut: [legA!, legB!] } }, accepted);
  state.jobId = job.id;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Plan />
    </QueryClientProvider>
  );
  await waitFor(() => expect(state.plans[0]?.outlineNotches?.length).toBeGreaterThan(0), { timeout: 60_000 });
  const note = await screen.findByText(
    /Front: \d+ notches about 1\.7 mm wide, .* narrower than the ⌀3\.175 bit and won’t be cut/,
    {},
    {
      timeout: 30_000,
    }
  );
  const safety = await screen.findByText(/The moves pass the safety checks, but not everything drawn gets cut/, {}, { timeout: 30_000 });
  expect(screen.queryByText(/Safety checks passed/)).toBeNull();
  expect(note.parentElement!.textContent).toMatch(/Side: \d+ notches about 1\.7 mm wide/);
  // Said before the line about the moves.
  expect(note.compareDocumentPosition(safety) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}, 120_000);
