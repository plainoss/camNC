import '@/style.css';
import { addRectangle, createCadDocument, createCadPart } from '@wbcnc/cad';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { page } from '@vitest/browser/context';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newBoard, type BoardV1 } from '@/cam/boards';
import { acceptDesign, saveDesignDraft } from '@/cam/cadDesign';
import { createDesignJob, getJob, saveJob } from '@/cam/jobDb';
import { kDefaultPlan } from '@/cam/planSettings';
import { Route } from './$jobId.boards';

const params = vi.hoisted(() => ({ jobId: '' }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useParams: () => params,
  useSearch: () => ({}),
  useNavigate: () => () => undefined,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/components/page-header', () => ({ PageHeader: () => null }));

const BoardsStep = (Route as unknown as { options: { component: ComponentType } }).options.component;

beforeEach(() => page.viewport(1280, 800));
afterEach(cleanup);

const drawing = (board: string) => screen.getByRole('region', { name: `Board ${board} drawing` });

/**
 * A design job with these 12 mm parts (name, width × height mm), on one board laid out by `board` from the parts'
 * instance ids, opened on Boards.
 */
async function open(parts: [string, number, number][], board: (ids: string[]) => Partial<BoardV1>) {
  const empty = await createDesignJob('Boards');
  const document = { ...createCadDocument(), id: empty.design!.draft.id };
  for (const [name, width, height] of parts) {
    const part = createCadPart(name, 12);
    part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width, height, positioned: true, dimensioned: true });
    document.parts.push(part);
  }
  const accepted = await acceptDesign(await saveDesignDraft(empty, document), document);
  const ids = document.parts.filter(p => parts.some(([name]) => name === p.name)).map(p => `${p.id}#0`);
  const saved = { ...newBoard([], 12, 'plywood', ids), margin: 10, gap: 10, ...board(ids) };
  const job = await saveJob({ ...accepted, boards: [saved], plan: { ...kDefaultPlan } }, accepted);
  params.jobId = job.id;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BoardsStep />
    </QueryClientProvider>
  );
  await screen.findByRole('region', { name: 'Board A drawing' }, { timeout: 60_000 });
  return { job, ids };
}

const at = (x: number, y: number) => ({ x, y, rotated: false });

/** Every ancestor that clips its content, up to the drawing's scroller, contains the whole element. */
function unclipped(el: Element) {
  const r = el.getBoundingClientRect();
  for (let a = el.parentElement; a; a = a.parentElement) {
    const style = getComputedStyle(a);
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
      const c = a.getBoundingClientRect();
      if (r.left < c.left - 0.5 || r.right > c.right + 0.5 || r.top < c.top - 0.5 || r.bottom > c.bottom + 0.5) return false;
    }
    if (a.hasAttribute('data-board-scroller')) break;
  }
  return true;
}

describe('CAM boards after design edits', () => {
  it('draws a part a design edit left no room for once, off the board, not also over the part that grew', async () => {
    // Bottom grew to 180 mm, over Shelf's stored spot.
    await open(
      [
        ['Bottom', 200, 180],
        ['Shelf', 200, 100],
      ],
      ([bottom, shelf]) => ({ layout: { w: 220, h: 230, at: { [bottom]: at(10, 10), [shelf]: at(10, 120) } } })
    );
    expect(await screen.findByText(/Shelf is off the boards and won’t be cut/, {}, { timeout: 30_000 })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Shelf: off the board, won’t be cut/ })).toHaveLength(1);
    expect(screen.queryAllByRole('button', { name: /^Shelf: drag, or move/ })).toHaveLength(0);
    expect(within(drawing('A')).getAllByRole('button', { name: /^Bottom: drag, or move/ })).toHaveLength(1);
    expect(within(drawing('A')).getByText('1 off it')).toBeTruthy();
  }, 90_000);

  it('edits the tabs of the part they are on, when another part has the same name', async () => {
    const { job, ids } = await open(
      [
        ['Top', 200, 100],
        ['Top', 200, 100],
      ],
      ([first, second]) => ({ retention: 'tabs', layout: { w: 220, h: 240, at: { [first]: at(10, 10), [second]: at(10, 130) } } })
    );
    const [first, second] = ids;
    // The second Top's tabs: on its outline, above the first one's.
    const secondTabs = () =>
      [...drawing('A').querySelectorAll<SVGCircleElement>('[data-tab="Top"]')].filter(t => +t.getAttribute('cy')! > 120);
    await waitFor(() => expect(secondTabs().length).toBeGreaterThanOrEqual(2), { timeout: 60_000 });
    const before = secondTabs().length;
    // Each handle is its own: no two with the same key make React drop or mix them up.
    const handles = [...drawing('A').querySelectorAll('[data-tab="Top"]')];
    expect(new Set(handles.map(t => `${t.getAttribute('cx')},${t.getAttribute('cy')}`)).size).toBe(handles.length);

    fireEvent.keyDown(secondTabs()[0]!.parentElement!, { key: 'Delete' });
    await waitFor(async () => {
      const saved = (await getJob(job.id))!.boards![0]!;
      expect(saved.tabsAt?.[second]).toHaveLength(before - 1);
      expect(saved.tabsAt?.[first]).toBeUndefined();
    });
  }, 120_000);
});

describe('CAM boards canvas', () => {
  it('shows the selected board’s frame whole when it opens', async () => {
    await open([['Panel', 80, 80]], ([panel]) => ({ layout: { w: 100, h: 100, at: { [panel]: at(10, 10) } } }));
    const scroller = document.querySelector('[data-board-scroller]')!.getBoundingClientRect();
    await waitFor(() => {
      const frame = drawing('A').getBoundingClientRect();
      expect(frame.left).toBeGreaterThanOrEqual(scroller.left);
      expect(frame.top).toBeGreaterThanOrEqual(scroller.top);
      expect(frame.right).toBeLessThanOrEqual(scroller.right);
      expect(frame.bottom).toBeLessThanOrEqual(scroller.bottom);
    });
  }, 90_000);

  it('shows an empty board’s name whole, zoomed out', async () => {
    await open([['Panel', 1200, 600]], ([panel]) => ({ layout: { w: 1220, h: 620, at: { [panel]: at(10, 10) } } }));
    fireEvent.click(screen.getByRole('button', { name: 'All boards' }));
    fireEvent.click(await screen.findByRole('button', { name: /New 12 mm board/ }));
    await screen.findByRole('region', { name: 'Board B drawing' });
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    await waitFor(() => {
      for (const board of ['A', 'B']) {
        const name = within(drawing(board)).getByText(`Board ${board}`);
        expect(unclipped(name), `Board ${board}'s name`).toBe(true);
      }
    });
  }, 90_000);
});
