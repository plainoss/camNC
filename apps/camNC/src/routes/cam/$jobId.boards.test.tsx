import { setAsidePart } from '@/cam/boards';
import { useCamMachine } from '@/cam/machine/camMachine';
import { useStore } from '@/store/store';
import { Box2, Vector2 } from 'three';
import { getJob, saveJob } from '@/cam/jobDb';

import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';

import { describe, expect, it } from 'vitest';
import { description, drawing, showAll, partIn, openKinderregal } from './boardsTestFixture';

describe('CAM boards step', () => {
  it('refuses Start over while a machine job is protected', async () => {
    const client = new QueryClient();
    const job = await openKinderregal(client);
    await waitFor(async () => expect((await getJob(job.id))!.boards!.length).toBeGreaterThan(0), { timeout: 20000 });
    const original = (await getJob(job.id))!;
    const board = original.boards![0];
    const cut = await saveJob({
      ...original,
      boards: original.boards!.map(b => (b.id === board.id ? { ...b, cut: { at: 1, keys: ['original'] } } : b)),
    });
    act(() => client.setQueryData(['cam', 'job', job.id], cut));
    const startOver = await screen.findByRole('button', { name: 'Start over' });
    useCamMachine.setState({ preparingRun: true });
    try {
      fireEvent.click(startOver);
      expect(await screen.findByText('Review or dismiss the machine job before starting over.')).toBeTruthy();
    } finally {
      useCamMachine.setState({ preparingRun: false });
    }
    const after = (await getJob(job.id))!.boards!.find(b => b.id === board.id)!;
    expect(after.cut!.keys).toEqual(['original']);
    expect(after.physicalSheetId).toBe(board.physicalSheetId);
  }, 90000);

  it('keeps the refusal message when Start over Undo targets a replacement sheet already used', async () => {
    const client = new QueryClient();
    const job = await openKinderregal(client);
    await waitFor(async () => expect((await getJob(job.id))!.boards!.length).toBeGreaterThan(0), { timeout: 20000 });
    const original = (await getJob(job.id))!;
    const board = original.boards![0];
    const cut = await saveJob({
      ...original,
      boards: original.boards!.map(b => (b.id === board.id ? { ...b, cut: { at: 1, keys: ['original'] } } : b)),
    });
    act(() => client.setQueryData(['cam', 'job', job.id], cut));
    fireEvent.click(await screen.findByRole('button', { name: 'Start over' }));
    await waitFor(async () => expect((await getJob(job.id))!.boards!.find(b => b.id === board.id)!.physicalSheetId).toBeTruthy());
    const replacement = (await getJob(job.id))!;
    const used = await saveJob({
      ...replacement,
      boards: replacement.boards!.map(b => (b.id === board.id ? { ...b, cut: { at: 2, keys: ['new-sheet-cut'] } } : b)),
    });
    act(() => client.setQueryData(['cam', 'job', job.id], used));
    fireEvent.click(await screen.findByRole('button', { name: 'Undo that' }));
    expect(await screen.findByText(/This replacement sheet has changed or been used/)).toBeTruthy();
    expect(screen.queryByText('Undone.')).toBeNull();
    expect((await getJob(job.id))!.boards!.find(b => b.id === board.id)!.cut!.keys).toEqual(['new-sheet-cut']);
  }, 90000);

  it('names set-aside parts brought back by auto-fill', async () => {
    const client = new QueryClient();
    const job = await openKinderregal(client);
    await waitFor(async () => expect((await getJob(job.id))!.boards?.length).toBeGreaterThan(0));
    const original = (await getJob(job.id))!,
      board = original.boards![0],
      id = board.items[0];
    const edited = await saveJob({
      ...original,
      stock: [{ id: 'stock', thickness: board.thickness, w: 1220, h: 610 }],
      boards: original.boards!.map(b => (b.id === board.id ? setAsidePart(b, id, { x: -1000, y: -1000, rotated: false }) : b)),
    });
    act(() => client.setQueryData(['cam', 'job', job.id], edited));
    showAll();
    fireEvent.click(await screen.findByRole('button', { name: 'Auto-fill from stock' }));
    const note = await screen.findByText(/Set-aside parts brought back onto boards:/);
    expect(note.textContent).toContain(original.parts.find(p => p.id === id.split('#')[0])?.name ?? id);
  }, 90000);

  it('does not claim to place a part skipped on an already-cut board', async () => {
    const client = new QueryClient();
    const job = await openKinderregal(client);
    await waitFor(async () => expect((await getJob(job.id))!.boards?.length).toBeGreaterThan(0));
    const original = (await getJob(job.id))!,
      board = original.boards![0],
      id = board.items[0];
    const edited = await saveJob({
      ...original,
      boards: original.boards!.map(b =>
        b.id === board.id ? setAsidePart({ ...b, cut: { at: 1, keys: ['cut'] } }, id, { x: -1000, y: -1000, rotated: false }) : b
      ),
    });
    act(() => client.setQueryData(['cam', 'job', job.id], edited));
    fireEvent.click(await screen.findByRole('button', { name: 'Place on boards' }));
    expect(await screen.findByText(/Not placed: .*already-cut boards/)).toBeTruthy();
    expect(screen.queryByText('Parts off the boards placed.')).toBeNull();
    expect((await getJob(job.id))!.boards!.find(b => b.id === board.id)).toEqual(edited.boards!.find(b => b.id === board.id));
  }, 90000);

  it('makes no board for a part too big for the machine, and says which part and why', async () => {
    // Machine bounds for this test only: the store saves them to localStorage, which other test files read as they start.
    const storage = useStore.persist.getOptions().storage;
    useStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
    useStore.setState({ machineBounds: new Box2(new Vector2(0, 0), new Vector2(600, 300)) });
    try {
      const client = new QueryClient();
      const job = await openKinderregal(client);
      // The back (400 × 380) fits no board on a 600 × 300 machine: it says so, with no button that can't help.
      const big = await screen.findByText(/\(400 × 380 mm\) is too big for the machine: its largest board is 600 × 300 mm/);
      expect(big.textContent).toMatch(/won’t be cut\.$/);
      expect(screen.queryByRole('button', { name: 'Place on boards' })).toBeNull();

      // A part set aside by hand, as well: that one goes back, the back stays, and no board is made for it.
      await waitFor(async () => expect((await getJob(job.id))!.boards!.some(b => b.thickness === 8 && b.layout)).toBe(true));
      const original = (await getJob(job.id))!;
      const board = original.boards!.find(b => b.thickness === 8 && b.layout)!;
      const id = board.items[0];
      const edited = await saveJob({
        ...original,
        boards: original.boards!.map(b => (b.id === board.id ? setAsidePart(b, id, { x: -1000, y: -1000, rotated: false }) : b)),
      });
      act(() => client.setQueryData(['cam', 'job', job.id], edited));
      fireEvent.click(await screen.findByRole('button', { name: 'Place on boards' }));
      const name = original.parts.find(p => p.id === id.split('#')[0])!.name;
      const note = await screen.findByText(/^Placed on boards: /);
      expect(note.textContent).toMatch(new RegExp(`^Placed on boards: ${name}\\. .+ \\(400 × 380 mm\\) is too big for the machine`));
      expect(screen.queryByText('Parts off the boards placed.')).toBeNull();
      await waitFor(async () => expect((await getJob(job.id))!.boards!.find(b => b.id === board.id)!.setAside).toBeUndefined());
      expect((await getJob(job.id))!.boards!.map(b => b.id)).toEqual(original.boards!.map(b => b.id));
      // The back's board is empty: the summary counts it apart, so the boards add up to the tabs.
      const summary = screen.getByRole('status', { name: 'Layout result' }).textContent!;
      const [, used, empty] = summary.match(/^(\d+) boards?, \d+ % yield, (\d+) empty$/)!;
      expect(+used + +empty).toBe(original.boards!.length);
    } finally {
      useStore.setState({ machineBounds: null });
      useStore.persist.setOptions({ storage });
    }
  }, 90000);

  it('auto-fill keeps parts moved by hand, and Undo restores the boards exactly', async () => {
    const job = await openKinderregal();

    // The middle shelf on a board of its own, by hand: pinned there. Enter on a part opens its menu.
    fireEvent.keyDown(partIn('A', 'Part 2'), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: /New board/ }));
    const c = await screen.findByRole('region', { name: 'Board C drawing' });
    expect(within(c).getByText('Part 2')).toBeTruthy();
    expect(description(within(c).getByRole('img', { name: 'Placed by hand' }))).toMatch(/^Pinned:/);

    // One 8 mm stock board size, as many as needed: the stock list is next to Auto-fill.
    showAll();
    const stockList = within(screen.getByRole('region', { name: 'Stock list' }));
    fireEvent.change(stockList.getByLabelText('Stock thickness'), { target: { value: '8' } });
    fireEvent.change(stockList.getByLabelText('Stock width'), { target: { value: '1220' } });
    fireEvent.change(stockList.getByLabelText('Stock height'), { target: { value: '610' } });
    fireEvent.click(stockList.getByRole('button', { name: 'Add stock board' }));
    // Both saves (the new board, the stock list) land before auto-fill reads the job.
    await waitFor(
      async () => {
        const saved = (await getJob(job.id))!;
        expect(saved.stock).toHaveLength(1);
        expect(saved.boards?.map(b => b.name)).toContain('C');
      },
      { timeout: 10_000 }
    );
    const before = (await getJob(job.id))!.boards!;
    expect(before.find(b => b.name === 'C')!.pinned).toEqual([before.find(b => b.name === 'C')!.items[0]]);

    fireEvent.click(screen.getByRole('button', { name: 'Auto-fill from stock' }));
    await screen.findByText('Parts placed on 1 board from stock.');
    let after: typeof before = [];
    await waitFor(async () => {
      after = (await getJob(job.id))!.boards!;
      expect(after).not.toEqual(before);
    });
    // The pinned board is still there with its part; the others are on one stock board.
    const pinned = before.find(b => b.name === 'C')!;
    expect(after.find(b => b.id === pinned.id)).toEqual(pinned);
    const stockBoard = after.find(b => !b.size.fit)!;
    expect(stockBoard.size).toEqual({ fit: false, w: 1220, h: 610 });
    expect(stockBoard.items).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: 'Undo that' }));
    await waitFor(async () => expect((await getJob(job.id))!.boards).toStrictEqual(before));
    expect(drawing('C')).toBeTruthy();
    // Undo leaves the stock list alone.
    expect((await getJob(job.id))!.stock).toHaveLength(1);
  }, 90_000);
});
