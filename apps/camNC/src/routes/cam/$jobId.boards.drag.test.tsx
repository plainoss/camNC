import { getJob, type CamJobV1 } from '@/cam/jobDb';

import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';

import { describe, expect, it } from 'vitest';
import { drawing, showAll, suggestHolds, partIn, drag, openMenu, clientOf, openKinderregal } from './boardsTestFixture';

describe('CAM boards.drag step', () => {
  it('nests the parts on one board per thickness and regroups them by drag and drop', async () => {
    const job = await openKinderregal();
    showAll();
    const a = drawing('A');
    const b = drawing('B');
    for (const name of ['left', 'right', 'Part 1a', 'Part 1b', 'Part 2']) expect(within(a).getByText(name)).toBeTruthy();
    expect(within(b).getByText('back')).toBeTruthy();
    expect(screen.getByRole('group', { name: /Board A, .* with 5 parts/ })).toBeTruthy();
    expect(screen.getByRole('group', { name: /Board B, .* with 1 parts/ })).toBeTruthy();

    // A new 8 mm board, and the middle shelf dragged onto it.
    fireEvent.click(screen.getByRole('button', { name: /New 8 mm board/ }));
    await screen.findByRole('region', { name: 'Board C drawing' });
    drag(partIn('A', 'Part 2'), 'C');
    await waitFor(() => expect(within(drawing('C')).getByText('Part 2')).toBeTruthy(), { timeout: 10_000 });
    expect(within(drawing('A')).queryByText('Part 2')).toBeNull();

    // The 3 mm back can't go on an 8 mm board.
    drag(partIn('B', 'back'), 'A');
    await screen.findByText(/3 mm thick/);

    // Without dragging: ⋯ › Move to › New board.
    await openMenu('A', 'Part 1b');
    fireEvent.click(await screen.findByRole('menuitem', { name: /New board/ }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Board D drawing' })).getByText('Part 1b')).toBeTruthy());

    // The left side onto board C (pointer events, so touch works too).
    const left = partIn('A', 'left');
    const start = left.getBoundingClientRect();
    fireEvent.pointerDown(left, { clientX: start.x + 5, clientY: start.y + 5, button: 0 });
    fireEvent.pointerMove(window, { clientX: start.x + 15, clientY: start.y + 15 });
    drawing('C').scrollIntoView({ block: 'center' });
    const frame = drawing('C').querySelector('[data-board-frame]')!.closest('svg')!.getBoundingClientRect();
    const to = { clientX: frame.x + frame.width / 2, clientY: frame.y + frame.height / 2 };
    fireEvent.pointerMove(window, to);
    // While dragging, the board under the pointer says where it lands; the 3 mm board doesn't take it.
    expect(within(drawing('C')).getByText(/^(Lands where you drop it|Snaps into the nest)$/)).toBeTruthy();
    expect(within(drawing('B')).getByText('Different thickness')).toBeTruthy();
    fireEvent.pointerUp(window, to);
    // Native pointer release emits a click; the pan handler consumes it before the next board can be opened.
    fireEvent.click(drawing('C'));
    await waitFor(() => expect(within(drawing('C')).getByText('left')).toBeTruthy(), { timeout: 10_000 });

    await waitFor(async () => {
      const saved = (await getJob(job.id))!.boards!;
      expect(saved.map(x => [x.name, x.items.length])).toEqual([
        ['A', 2],
        ['B', 1],
        ['C', 2],
        ['D', 1],
      ]);
    });

    // The click that ends a drag doesn't open a board, for 50 ms: this one comes later.
    await new Promise(resolve => setTimeout(resolve, 60));
    // No fixtures until they are placed: Suggest holds places some, Undo takes them back.
    fireEvent.click(drawing('A'));
    const holdsOnA = () => screen.getByRole('region', { name: 'Board A drawing' }).querySelectorAll('[data-hold]').length;
    expect(holdsOnA()).toBe(0);
    await suggestHolds();
    await waitFor(() => expect(holdsOnA()).toBeGreaterThanOrEqual(3), { timeout: 10_000 });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(holdsOnA()).toBe(0), { timeout: 10_000 });
  }, 90_000);

  it('drags a part’s outline from one board drawing onto another, where it lands exactly at the drop point', async () => {
    const job = await openKinderregal();
    // Board C: a 1220 × 610 sheet, empty.
    showAll();
    fireEvent.click(screen.getByRole('button', { name: /New 8 mm board/ }));
    fireEvent.click(await screen.findByRole('region', { name: 'Board C drawing' }));
    for (const [label, value] of [
      ['Width', '1220'],
      ['Height', '610'],
    ]) {
      // The board's own fields (the stock list has a Width and Height too).
      const field = () => screen.getByLabelText(label, { selector: '[id^="board-"]' }) as HTMLInputElement;
      const input = field();
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);
      await waitFor(() => expect(field().value).toBe(value));
    }
    await waitFor(
      async () => expect((await getJob(job.id))!.boards!.find(b => b.name === 'C')!.size).toEqual({ fit: false, w: 1220, h: 610 }),
      { timeout: 10_000 }
    );

    showAll();
    // Grab the left side (560 × 140) at its lower left corner + (20, 10) mm.
    const left = partIn('A', 'left');
    const box = (left as unknown as SVGGElement).getBBox();
    // getBBox is in the drawing's frame (Y up): lower left corner of the outline.
    fireEvent.pointerDown(left, { ...clientOf('A', box.x + 20, box.y + 10), button: 0 });

    // Over board C at (300, 300) + the grab offset: the outline follows the pointer, C is highlighted and shows
    // where it lands.
    const c = screen.getByRole('region', { name: 'Board C drawing' });
    c.scrollIntoView({ block: 'center' });
    const drop = clientOf('C', 320, 310);
    fireEvent.pointerMove(window, drop);
    expect(document.elementFromPoint(drop.clientX, drop.clientY)?.closest('[data-board-drop]')).toBe(c);
    expect(document.querySelector('[data-drag-ghost]')).toBeTruthy();
    expect(c.querySelector('[data-preview="fits"]')).toBeTruthy();
    expect(within(c).getByText('Lands where you drop it')).toBeTruthy();
    // Near the column's edge the drag scrolls it: let go where that point of board C is now.
    fireEvent.pointerUp(window, clientOf('C', 320, 310));

    await waitFor(
      async () => {
        const boards = (await getJob(job.id))!.boards!;
        const onC = boards.find(b => b.name === 'C')!;
        expect(onC.items).toHaveLength(1);
        expect(onC.pinned).toEqual(onC.items);
        const at = onC.layout!.at[onC.items[0]];
        expect(Math.abs(at.x - 300)).toBeLessThan(5);
        expect(Math.abs(at.y - 300)).toBeLessThan(5);
        expect(at.rotated).toBe(false);
        expect(boards.find(b => b.name === 'A')!.items).not.toContain(onC.items[0]);
        // The save takes longer than the default second on a busy CI machine.
      },
      { timeout: 10_000 }
    );
    expect(within(drawing('C')).getByText('left')).toBeTruthy();
    expect(document.querySelector('[data-drag-ghost]')).toBeNull();

    // Arrow keys move it on its board, 10 mm with Shift.
    const before = (await getJob(job.id))!.boards!.find(b => b.name === 'C')!;
    const id = before.items[0];
    fireEvent.keyDown(partIn('C', 'left'), { key: 'ArrowRight', shiftKey: true });
    await waitFor(
      async () => {
        const at = (await getJob(job.id))!.boards!.find(b => b.name === 'C')!.layout!.at[id];
        expect(at.x).toBeCloseTo(before.layout!.at[id].x + 10, 5);
        expect(at.y).toBeCloseTo(before.layout!.at[id].y, 5);
      },
      { timeout: 10_000 }
    );
  }, 90_000);

  it('drags a tab along its part’s outline: saved in the part’s frame, and placed automatically again on request', async () => {
    const client = new QueryClient();
    const job = await openKinderregal(client);
    // Wait for the actual transactions started by this gesture. A busy worker can outlast a polling assertion's
    // default second; an optimistic render is also too early to assert what IndexedDB has committed.
    const commit = async (label: string, action: () => void) => {
      const cache = client.getMutationCache();
      const previous = new Set(cache.getAll().map(mutation => mutation.mutationId));
      action();
      const writes = cache.getAll().filter(mutation => {
        const variables = mutation.state.variables as { job?: CamJobV1 } | undefined;
        return !previous.has(mutation.mutationId) && variables?.job?.id === job.id;
      });
      expect(writes.length, `${label}: starts a save for this job`).toBeGreaterThan(0);
      await act(async () => {
        await Promise.all(
          writes.map(
            mutation =>
              new Promise<void>((resolve, reject) => {
                let unsubscribe = () => {};
                const changed = () => {
                  if (mutation.state.status === 'success') {
                    unsubscribe();
                    resolve();
                  } else if (mutation.state.status === 'error') {
                    unsubscribe();
                    reject(new Error(`${label}: job save failed`, { cause: mutation.state.error }));
                  }
                };
                unsubscribe = cache.subscribe(changed);
                changed();
              })
          )
        );
      });
    };
    const drawingA = () => drawing('A');
    // The board's program comes back with its tabs.
    const tab = await waitFor(
      () => {
        const t = drawingA().querySelector<SVGCircleElement>('[data-tab]');
        expect(t).toBeTruthy();
        return t!;
      },
      { timeout: 60_000 }
    );
    const part = tab.getAttribute('data-tab')!;
    const [cx, cy] = [+tab.getAttribute('cx')!, +tab.getAttribute('cy')!];
    // 30 mm along the board's x, and a little off the outline: it lands on the outline.
    // By the bar, which on a small board reaches past the ring.
    const bar = tab.parentElement!.querySelector<SVGLineElement>('[data-tab-bar]')!;
    const ends = [...tab.parentElement!.querySelectorAll('[data-tab-bar]')].flatMap(l => [
      Math.hypot(+l.getAttribute('x1')! - cx, +l.getAttribute('y1')! - cy),
      Math.hypot(+l.getAttribute('x2')! - cx, +l.getAttribute('y2')! - cy),
    ]);
    expect(Math.max(...ends)).toBeGreaterThan(2);
    fireEvent.pointerDown(bar, { ...clientOf('A', cx, cy), button: 0, pointerId: 1 });
    fireEvent.pointerMove(bar, { ...clientOf('A', cx + 30, cy + 2), pointerId: 1 });
    await commit('drag tab', () => fireEvent.pointerUp(bar, { ...clientOf('A', cx + 30, cy + 2), pointerId: 1 }));
    const saved = async () => (await getJob(job.id))!.boards!.find(b => b.name === 'A')!;
    await waitFor(async () => {
      const b = await saved();
      const item = b.items.find(id => b.tabsAt?.[id]);
      expect(item).toBeTruthy();
      expect(b.tabsAt![item!].length).toBeGreaterThanOrEqual(2);
    });
    // The next program has a tab where it was dropped.
    await waitFor(
      () => {
        const moved = [...drawingA().querySelectorAll<SVGCircleElement>(`[data-tab="${part}"]`)];
        expect(moved.some(t => Math.abs(+t.getAttribute('cx')! - (cx + 30)) < 4)).toBe(true);
      },
      { timeout: 60_000 }
    );
    // A double-click on the part's edge adds one there; one on a tab removes it.
    const count = async () => {
      const b = await saved();
      return b.tabsAt![b.items.find(id => b.tabsAt?.[id])!].length;
    };
    const before = await count();
    const outline = () => drawingA().querySelector<SVGGElement>(`[data-item][data-part="${part}"]`)!;
    const edgePoint = () => {
      const box = outline().getBBox();
      return clientOf('A', box.x + box.width / 2, box.y + 1);
    };
    await commit('add tab', () => fireEvent.doubleClick(outline(), edgePoint()));
    await waitFor(async () => expect(await count()).toBe(before + 1));
    await waitFor(() => expect(drawingA().querySelectorAll(`[data-tab="${part}"]`).length).toBeGreaterThanOrEqual(before + 1), {
      timeout: 60_000,
    });
    await commit('remove tab', () => fireEvent.doubleClick(drawingA().querySelector(`[data-tab="${part}"]`)!));
    await waitFor(async () => expect(await count()).toBe(before));
    // The tab tool adds one with a click on the outline, previewed first; a click on the tab selects it, with its bar.
    // Once the program has caught up: a new tab goes with the ones it has.
    await waitFor(
      () => {
        const spots = [...drawingA().querySelectorAll(`[data-tab="${part}"]`)].map(t => `${t.getAttribute('cx')},${t.getAttribute('cy')}`);
        expect(new Set(spots).size).toBe(before);
      },
      { timeout: 60_000 }
    );
    const svgA = () => drawingA().querySelector('[data-board-frame]')!.closest('svg')!;
    fireEvent.keyDown(document.body, { key: 't' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tab' }).getAttribute('aria-pressed')).toBe('true'));
    // Clear of the one the double-click left there.
    const elsewhere = () => {
      const box = outline().getBBox();
      return clientOf('A', box.x + box.width / 4, box.y + 1);
    };
    fireEvent.pointerMove(svgA(), elsewhere());
    expect(drawingA().querySelector('[data-tab-preview]')).toBeTruthy();
    await commit('tab tool', () => fireEvent.click(svgA(), elsewhere()));
    await waitFor(async () => expect(await count()).toBe(before + 1));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Select' }).getAttribute('aria-pressed')).toBe('true'));
    await waitFor(() => expect(drawingA().querySelectorAll(`[data-tab="${part}"]`).length).toBeGreaterThanOrEqual(before + 1), {
      timeout: 60_000,
    });
    const group = drawingA().querySelector(`[data-tab="${part}"]`)!.parentElement!;
    fireEvent.pointerDown(group, { ...edgePoint(), button: 0, pointerId: 1 });
    fireEvent.pointerUp(group, { ...edgePoint(), button: 0, pointerId: 1 });
    const tabBar = await screen.findByRole('toolbar', { name: `Tab · ${part}` });
    await commit('delete tab', () => fireEvent.click(within(tabBar).getByRole('button', { name: 'Delete this tab' })));
    await waitFor(async () => expect(await count()).toBe(before));
    // Back to picked tabs: for the part, from its menu.
    await openMenu('A', part);
    const menu = screen.getByRole('menu');
    const resetPart = await screen.findByRole('menuitem', { name: 'Place its tabs automatically again' });
    await commit('part reset', () => fireEvent.click(resetPart));
    expect((await saved()).tabsAt, 'part reset: persisted tabs use automatic placement').toBeUndefined();
    // Radix retains a closed menu, including its accessibility isolation, until its native exit animation ends.
    // Observe that lifecycle rather than assuming compositor events arrive within waitFor's default second.
    if (menu.isConnected) expect(menu.getAttribute('data-state')).toBe('closed');
    await act(async () => {
      await Promise.allSettled(menu.getAnimations().map(animation => animation.finished));
    });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(drawingA(), 'part reset: board is accessible after menu dismissal').toBeTruthy();
    // And for the whole board, from its settings.
    await commit('add tab after part reset', () => fireEvent.doubleClick(outline(), edgePoint()));
    expect((await saved()).tabsAt, 'board reset: starts with a saved manual tab').toBeTruthy();
    fireEvent.click(drawingA());
    const resetBoard = await screen.findByRole('button', { name: 'Place tabs automatically again' });
    await commit('board reset', () => fireEvent.click(resetBoard));
    expect(
      screen.queryByRole('button', { name: 'Place tabs automatically again' }),
      'board reset: manual-tab control disappears'
    ).toBeNull();
    expect((await saved()).tabsAt, 'board reset: persisted tabs use automatic placement').toBeUndefined();
  }, 150_000);
});
