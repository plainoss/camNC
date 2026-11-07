import { getJob, saveJob } from '@/cam/jobDb';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { describe, expect, it } from 'vitest';
import { BoardsStep, description, drawing, showAll, openBoard, drag, openMenu, openKinderregal } from './boardsTestFixture';

describe('CAM boards.settings step', () => {
  it('keeps the stick-out with the job’s bit, not the board', async () => {
    const job = await openKinderregal();
    const field = () => document.getElementById('hold-stickout') as HTMLInputElement;
    // With a tool in hand, under its sizes.
    fireEvent.click(screen.getByRole('button', { name: 'Clamp' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Clamp and screw sizes…' }));
    await waitFor(() => expect(field()).toBeTruthy(), { timeout: 10_000 });
    fireEvent.change(field(), { target: { value: '42' } });
    fireEvent.blur(field());
    await waitFor(
      async () => {
        const saved = (await getJob(job.id))!;
        expect(saved.plan?.bit.stickout).toBe(42);
      },
      { timeout: 10_000 }
    );
    // Every board of the job shows it: the open dialog follows the selected board.
    fireEvent.click(screen.getByRole('button', { name: 'Board B', hidden: true }));
    await screen.findByRole('region', { name: 'Board B drawing', hidden: true }, { timeout: 10_000 });
    expect(field().value).toBe('42');
  }, 90_000);

  it('auto-fill optimizes for fewest boards unless the job says least wood', async () => {
    const job = await openKinderregal();
    showAll();
    // Tabs only where they hold: no tab marked red on the drawings once the programs are made.
    const tabs = () => document.querySelectorAll('line[class*="stroke-amber"]').length;
    const floating = () => [...document.querySelectorAll('circle > title')].filter(t => /this tab holds nothing/.test(t.textContent ?? ''));
    await waitFor(() => expect(tabs()).toBeGreaterThan(0), { timeout: 60_000 });
    expect(floating()).toHaveLength(0);
    const group = within(screen.getByRole('group', { name: 'Auto-fill optimizes for' }));
    expect(screen.getByText('Auto-fill prefers:')).toBeTruthy();
    expect(description(group.getByRole('button', { name: 'Fewest boards' }))).toBe(
      'Fewer setups at the machine, may waste a bit more wood.'
    );
    expect(description(group.getByRole('button', { name: 'Least wood' }))).toBe('Least board area, may need more boards.');
    expect(description(screen.getByRole('button', { name: 'More layout actions' }))).toMatch(/re-lay out everything/);
    expect(description(screen.getByRole('button', { name: 'Auto-fill from stock' }))).toMatch(/stock list/);
    expect(screen.getByRole('status', { name: 'Layout result' }).textContent).toMatch(/^2 boards, \d+ % yield$/);
    expect(group.getByRole('button', { name: 'Fewest boards' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(group.getByRole('button', { name: 'Least wood' }));
    await waitFor(async () => expect((await getJob(job.id))!.nestObjective).toBe('wood'), { timeout: 10_000 });
    expect(group.getByRole('button', { name: 'Least wood' }).getAttribute('aria-pressed')).toBe('true');
  }, 90_000);

  it('re-lays out one board or everything after moves by hand, with Undo', async () => {
    const job = await openKinderregal();
    // Part 2 by hand onto a board of its own: pinned.
    await openMenu('A', 'Part 2');
    fireEvent.click(await screen.findByRole('menuitem', { name: /New board/ }));
    await screen.findByRole('region', { name: 'Board C drawing' });
    const pinnedBoards = async () => ((await getJob(job.id))!.boards ?? []).filter(b => b.pinned?.length).map(b => b.name);
    await waitFor(async () => expect(await pinnedBoards()).toEqual(['C']), { timeout: 10_000 });
    const before = (await getJob(job.id))!.boards!;

    // Everything: unpinned (no stock list, so the boards keep their parts and nest afresh).
    showAll();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'More layout actions' }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Re-lay out everything (unpin all)' }));
    await waitFor(async () => expect(await pinnedBoards()).toEqual([]), { timeout: 10_000 });
    await screen.findByText('All boards laid out again.');
    fireEvent.click(screen.getByRole('button', { name: 'Undo that' }));
    await waitFor(async () => expect((await getJob(job.id))!.boards).toStrictEqual(before), { timeout: 10_000 });

    // One board: open C, re-lay it out from its inspector.
    fireEvent.click(await screen.findByRole('region', { name: 'Board C drawing' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Tighten layout' }));
    await waitFor(async () => expect(await pinnedBoards()).toEqual([]), { timeout: 10_000 });
    await screen.findByText('Board C laid out again.');
    // Part 2 is still on board C.
    expect((await getJob(job.id))!.boards!.find(b => b.name === 'C')!.items).toHaveLength(1);
  }, 90_000);

  it('shows parts that don’t fit next to their board at their shape, to drag or move from there', async () => {
    const job = await openKinderregal();
    // Part 2 on a board of its own, then that board made too small for it.
    await openMenu('A', 'Part 2');
    fireEvent.click(await screen.findByRole('menuitem', { name: /New board/ }));
    await screen.findByRole('region', { name: 'Board C drawing' });
    for (const id of ['board-w', 'board-h']) {
      const input = () => document.getElementById(id) as HTMLInputElement;
      await waitFor(() => expect(input()).toBeTruthy());
      fireEvent.change(input(), { target: { value: '50' } });
      fireEvent.blur(input());
    }
    const off = () => document.querySelector('[data-unplaced="Part 2"]');
    await waitFor(() => expect(off()).toBeTruthy(), { timeout: 10_000 });
    expect(off()!.querySelector('path')!.getAttribute('d')).toMatch(/^M/);
    expect(within(drawing('C')).getByText('1 off it')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/^Part 2 is off the boards and won’t be cut\./);

    // Dragged from the table back onto board A.
    drag(off()!, 'A');
    await waitFor(
      async () => {
        const boards = (await getJob(job.id))!.boards!;
        expect(boards.find(b => b.name === 'C')!.items).toHaveLength(0);
        expect(boards.find(b => b.name === 'A')!.items).toHaveLength(5);
      },
      { timeout: 10_000 }
    );
    expect(off()).toBeNull();
  }, 90_000);

  it('chooses the bit before nesting, also one that is in no library', async () => {
    const job = await openKinderregal();
    fireEvent.click(screen.getByRole('button', { name: /^Bit: ⌀3.175 1\/8″ flat\. Change the bit$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Custom bit…' }));
    const form = within(screen.getByRole('group', { name: 'Custom bit' }));
    fireEvent.change(form.getByLabelText('Diameter (mm)'), { target: { value: '6' } });
    fireEvent.change(form.getByLabelText('Name'), { target: { value: '6 mm upcut' } });
    fireEvent.click(form.getByRole('button', { name: 'Add bit' }));
    await waitFor(async () => expect((await getJob(job.id))!.plan?.bit).toMatchObject({ diameter: 6, name: '6 mm upcut' }), {
      timeout: 10_000,
    });
    // Margin and gap follow the bit, with room for a strip that holds the tabs: 6 + 3.5 and 2 × 6 + 3.5. Their labels
    // are on the drawing, at the board's own scale on a screen this small.
    openBoard('A');
    await waitFor(
      () => {
        expect((screen.getByLabelText('Edge margin') as HTMLInputElement).value).toBe('9.5');
        expect((screen.getByLabelText('Gap between parts') as HTMLInputElement).value).toBe('16');
      },
      { timeout: 10_000 }
    );
  }, 90_000);

  it('labels the stock fields, takes comma decimals, says what is wrong, and shows no size for an empty board', async () => {
    const job = await openKinderregal();
    // Fitted boards are whole mm.
    showAll();
    expect(within(drawing('A')).getByText('574 × 750')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /New 8 mm board/ }));
    const c = await screen.findByRole('region', { name: 'Board C drawing' });
    expect(within(c).getByText('–')).toBeTruthy();
    fireEvent.click(c);
    const width = screen.getByLabelText('Width', { selector: '#board-w' }) as HTMLInputElement;
    expect(width.value).toBe('');
    expect(width.placeholder).toBe('–');

    // Out of range: an inline error instead of silently going back, and nothing saved.
    fireEvent.change(width, { target: { value: '5' } });
    fireEvent.blur(width);
    expect(width.getAttribute('aria-invalid')).toBe('true');
    expect(description(width)).toMatch(/^5 is out of range: at least 10 mm\./);
    expect((await getJob(job.id))!.boards!.find(b => b.name === 'C')!.size).toEqual({ fit: true });

    showAll();
    const stockList = within(await screen.findByRole('region', { name: 'Stock list' }));
    for (const label of ['Thickness', 'Width', 'Height', 'Count']) expect(stockList.getByText(label).tagName).toBe('LABEL');
    fireEvent.change(stockList.getByLabelText('Stock thickness'), { target: { value: '8' } });
    fireEvent.change(stockList.getByLabelText('Stock width'), { target: { value: '600,5' } });
    fireEvent.change(stockList.getByLabelText('Stock height'), { target: { value: '30O' } });
    expect(stockList.getByText(/^Height: Enter a number/)).toBeTruthy();
    expect(stockList.getByRole('button', { name: 'Add stock board' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(stockList.getByLabelText('Stock height'), { target: { value: '300' } });
    fireEvent.click(stockList.getByRole('button', { name: 'Add stock board' }));
    await waitFor(async () => expect((await getJob(job.id))!.stock).toMatchObject([{ thickness: 8, w: 600.5, h: 300 }]));
    expect(stockList.getByText('8 mm · 600.5 × 300')).toBeTruthy();
  }, 90_000);

  it('after every part is unticked in the Model step, no board keeps parts', async () => {
    const job = await openKinderregal();
    await waitFor(async () => expect((await getJob(job.id))!.boards?.length).toBeGreaterThan(0), { timeout: 10_000 });
    cleanup();
    const saved = (await getJob(job.id))!;
    await saveJob({ ...saved, parts: saved.parts.map(p => ({ ...p, milled: false })) });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BoardsStep />
      </QueryClientProvider>
    );
    const empty = await screen.findByRole('status', {}, { timeout: 60_000 });
    expect(empty.textContent).toMatch(/^No part to mill/);
    // The way back, and no way on.
    expect(within(empty).getByText('Back to the Model step')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next: Plan' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('region', { name: 'Board A drawing' })).toBeNull();
  }, 90_000);
});
