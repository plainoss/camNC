/* eslint-disable react-refresh/only-export-components -- Shared browser test harness. */

import { createJob } from '@/cam/jobDb';
import { wrapCamWorker } from '@/cam/camQueries';
import { camWorkerCache } from '@/test/camWorkerCache';
import { trackQueryClient } from '@/lib/settled';
import { settled } from '@/test/settled';
// Pointer coordinates and fitted SVG dimensions must use the page's real layout, including the fixed-height status.
import '@/style.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import type { ComponentType } from 'react';
import { afterEach, expect, vi } from 'vitest';
import stepUrl from '../../../../../packages/cam/test/fixtures/kinderregal-eiche.step?url';
import { Route } from './$jobId.boards';

const params = vi.hoisted(() => ({ jobId: '' }));
const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useParams: () => params,
  useSearch: () => ({}),
  useNavigate: () => () => undefined,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/components/page-header', () => ({ PageHeader: () => null }));
vi.mock('@wbcnc/ui/components/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: toastError, success: toastSuccess, warning: vi.fn() }),
}));

// Each test opens the same STEP file as a new job: read it and plan its boards once for the file.
wrapCamWorker(camWorkerCache);

export const BoardsStep = (Route as unknown as { options: { component: ComponentType } }).options.component;

afterEach(cleanup);

/** The accessible description: the text of the elements `aria-describedby` points to. */
export const description = (el: Element) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map(id => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();

/** A board's drawing: its header, the parts on it, the ones that don't fit. */
export const drawing = (board: string) => screen.getByRole('region', { name: `Board ${board} drawing` });

/** Every board, with the job-wide layout tools. */
export const showAll = () => fireEvent.click(screen.getByRole('button', { name: 'All boards' }));
/** An item of the Suggest holds menu in the tools. */
export const holdsMenu = async (name: string) => {
  // The previous menu exits after its selection saves. Let its exit animation end and it restore focus before opening
  // another menu, or that late focus restoration can dismiss the new menu. Settling includes planning the job's boards,
  // which takes as long as the first drawing can (see openKinderregal).
  await settled({ timeout: 60_000 });
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.pointerDown(await screen.findByRole('button', { name: 'Suggest holds' }, { timeout: 10_000 }), { button: 0, ctrlKey: false });
  return (await screen.findByRole('menuitem', { name })) as HTMLElement;
};
export const suggestHolds = async () => fireEvent.click(await holdsMenu('Suggest holds'));

/** A board from the list: what edits it is on its drawing and in the sidebar. */
export const openBoard = (board: string) => fireEvent.click(screen.getByRole('button', { name: `Board ${board}` }));

/** Pointer drag of a part (its outline, or its chip where it doesn't fit) to the middle of another board's drawing. */
export function drag(part: Element, board: string) {
  const start = part.getBoundingClientRect();
  fireEvent.pointerDown(part, { clientX: start.x + 3, clientY: start.y + 3, button: 0 });
  // Once it's moving: its board selected, and the "New board" target showing, things have moved.
  fireEvent.pointerMove(window, { clientX: start.x + 13, clientY: start.y + 13 });
  drawing(board).scrollIntoView({ block: 'center' });
  const frame = drawing(board).querySelector('[data-board-frame]')!.closest('svg')!.getBoundingClientRect();
  const to = { clientX: frame.x + frame.width / 2, clientY: frame.y + frame.height / 2 };
  fireEvent.pointerMove(window, to);
  fireEvent.pointerUp(window, to);
}

/** A part's menu, from the ⋯ that shows on the part last touched. */
export async function openMenu(board: string, name: string) {
  fireEvent.focus(partIn(board, name));
  fireEvent.pointerDown(await within(drawing(board)).findByRole('button', { name: `${name} menu` }), { button: 0, ctrlKey: false });
}

/** A part's outline in a board drawing. */
export const partIn = (board: string, name: string) =>
  within(screen.getByRole('region', { name: `Board ${board} drawing` })).getByRole('button', {
    name: new RegExp(`^${name}: drag, or move`),
  });

/** Client point of a board point (mm, lower left zero) in a board's drawing. */
export function clientOf(board: string, x: number, y: number) {
  const frame = screen.getByRole('region', { name: `Board ${board} drawing` }).querySelector<SVGGraphicsElement>('[data-board-frame]')!;
  const p = new DOMPoint(x, y).matrixTransform(frame.getScreenCTM()!);
  return { clientX: p.x, clientY: p.y };
}

let fixtureBytes: Promise<ArrayBuffer> | undefined;

export async function openKinderregal(client = new QueryClient()) {
  const bytes = await (fixtureBytes ??= fetch(stepUrl).then(response => {
    if (!response.ok) throw new Error(`Cannot load STEP fixture: ${response.status}`);
    return response.arrayBuffer();
  }));
  const job = await createJob(new File([bytes], 'kinderregal-eiche.step'));
  params.jobId = job.id;
  // Its job reads and saves count as pending for `settled()`.
  trackQueryClient(client);
  render(
    <QueryClientProvider client={client}>
      <BoardsStep />
    </QueryClientProvider>
  );
  await screen.findByRole('region', { name: 'Board A drawing' }, { timeout: 60_000 });
  return job;
}
