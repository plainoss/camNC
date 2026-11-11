import { createCarvingJob, getJob, saveJob } from '@/cam/jobDb';
import { carvingBounds } from '@/cam/carvingView';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { Route } from './$jobId.carve';

const params = vi.hoisted(() => ({ jobId: '' }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useParams: () => params,
  Link: ({ children, to, params }: { children: ReactNode; to: string; params: { jobId: string } }) => (
    <a href={to.replace('$jobId', params.jobId)}>{children}</a>
  ),
}));
vi.mock('@/components/page-header', () => ({ PageHeader: () => null }));
vi.mock('@/cam/CamJobBar', () => ({ CamJobBar: ({ actions }: { actions: ReactNode }) => <header>{actions}</header> }));

const CarveStep = (Route as unknown as { options: { component: ComponentType } }).options.component;

afterEach(cleanup);

async function open(taped = true) {
  const created = await createCarvingJob();
  const job = { ...created, boards: created.boards!.map(b => ({ ...b, taped })) };
  await saveJob(job);
  params.jobId = job.id;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CarveStep />
    </QueryClientProvider>
  );
  await screen.findByTestId('carving-item');
  return job;
}

const saved = async (id: string) => (await getJob(id))?.carving?.cutout;

/** A pointer event at a board point, mm with Y up. */
const at = (x: number, y: number) => {
  const svg = screen.getByRole('img', { name: /^Board/ }) as unknown as SVGSVGElement;
  const p = new DOMPoint(x, 140 - y).matrixTransform(svg.getScreenCTM()!);
  return { clientX: p.x, clientY: p.y, pointerId: 1, button: 0 };
};

it('cuts the carving out along its outline, held by a skin on a taped board, set on the drawing', async () => {
  const job = await open();
  fireEvent.click(screen.getByRole('checkbox', { name: /Cut it out/ }));
  await waitFor(async () => expect(await saved(job.id)).toEqual({ shape: 'outline', margin: 6, hold: 'skin' }));
  // Turned on, the cut line is selected: its bar sets the rest.
  expect(screen.getByTestId('carving-cutout')).toBeTruthy();
  expect((screen.getByRole('radio', { name: 'Onion skin' }) as HTMLElement).getAttribute('aria-checked')).toBe('true');
  fireEvent.change(screen.getByLabelText('Cutout shape'), { target: { value: 'plaque' } });
  await waitFor(async () => expect((await saved(job.id))?.shape).toBe('plaque'));

  // The grip on the right drags the margin out from the artwork, in whole millimetres.
  const art = carvingBounds(job.carving!.region)!;
  const grip = screen.getByRole('slider', { name: 'Drag to change the margin' });
  fireEvent.pointerDown(grip, at(art.x1 + 6, (art.y0 + art.y1) / 2));
  fireEvent.pointerMove(grip, at(art.x1 + 12.3, (art.y0 + art.y1) / 2));
  expect(grip.getAttribute('aria-valuenow')).toBe('12');
  fireEvent.pointerUp(grip, at(art.x1 + 12.3, (art.y0 + art.y1) / 2));
  await waitFor(async () => expect((await saved(job.id))?.margin).toBe(12));

  // Delete turns it off.
  fireEvent.keyDown(window, { key: 'Delete' });
  await waitFor(async () => expect(await saved(job.id)).toBeUndefined());
  expect(screen.queryByTestId('carving-cutout')).toBeNull();
});

it('holds an untaped board’s cutout with tabs, placed and dragged along the line', async () => {
  const job = await open(false);
  fireEvent.click(screen.getByRole('checkbox', { name: /Cut it out/ }));
  await waitFor(async () => expect((await saved(job.id))?.hold).toBe('tabs'));
  fireEvent.change(screen.getByLabelText('Cutout shape'), { target: { value: 'plaque' } });
  await waitFor(async () => expect((await saved(job.id))?.shape).toBe('plaque'));
  const art = carvingBounds(job.carving!.region)!;
  const middle = (art.y0 + art.y1) / 2;
  // A double-click near the line puts a tab on it.
  fireEvent.doubleClick(screen.getByRole('button', { name: 'Cut line' }), at(art.x0 - 7, middle));
  await waitFor(async () => expect((await saved(job.id))?.tabsAt).toHaveLength(1));
  const [tab] = (await saved(job.id))!.tabsAt!;
  expect(tab.x).toBeCloseTo(art.x0 - 6, 0);
  expect(tab.y).toBeCloseTo(middle, 0);
  // Dragged, it stays on the line.
  const dot = await screen.findByRole('button', { name: 'Tab 1' });
  fireEvent.pointerDown(dot, at(tab.x, tab.y));
  fireEvent.pointerMove(dot, at(art.x0 - 20, middle + 4));
  fireEvent.pointerUp(dot, at(art.x0 - 20, middle + 4));
  await waitFor(async () => expect((await saved(job.id))?.tabsAt?.[0].y).toBeCloseTo(middle + 4, 0));
  expect((await saved(job.id))?.tabsAt?.[0].x).toBeCloseTo(art.x0 - 6, 0);
  // A double-click on a tab takes it away; with none placed, Plan picks them again.
  fireEvent.doubleClick(screen.getByRole('button', { name: 'Tab 1' }));
  await waitFor(async () => expect((await saved(job.id))?.tabsAt).toBeUndefined());
});

it('warns while the cut line runs past the board, though the artwork is on it', async () => {
  const job = await open();
  fireEvent.click(screen.getByRole('checkbox', { name: /Cut it out/ }));
  await waitFor(async () => expect((await saved(job.id))?.margin).toBe(6));
  expect(screen.queryByRole('alert')).toBeNull();
  // Dragged until its left edge is 3 mm inside the board: the cut line 6 mm round it runs past the edge.
  const art = carvingBounds(job.carving!.region)!;
  const middle = { x: (art.x0 + art.x1) / 2, y: (art.y0 + art.y1) / 2 };
  const path = screen.getByTestId('carving-item');
  const svg = path.closest('svg')!;
  fireEvent.pointerDown(path, at(middle.x, middle.y));
  fireEvent.pointerMove(svg, at(middle.x - (art.x0 - 3), middle.y));
  fireEvent.pointerUp(svg, at(middle.x - (art.x0 - 3), middle.y));
  await waitFor(async () => expect(carvingBounds((await getJob(job.id))!.carving!.region)!.x0).toBeCloseTo(3, 0));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toMatch(/cut line runs past the board/);
  // A warning, as for artwork past the board: Plan still opens, and says it there.
  expect(screen.getByRole('link', { name: /Next: Plan/ })).toBeTruthy();
});
