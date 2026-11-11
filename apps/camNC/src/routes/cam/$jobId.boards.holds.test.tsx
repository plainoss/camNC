import { getJob, saveJob } from '@/cam/jobDb';
import { useStore } from '@/store/store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Box2, Vector2 } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { BoardsStep, drawing, holdsMenu, suggestHolds, openBoard, clientOf, openKinderregal } from './boardsTestFixture';
import { settled } from '@/test/settled';

describe('CAM boards.holds step', () => {
  it('places a clamp with the tool: a click on its own preview counts, parts make room, and the status says so', async () => {
    const job = await openKinderregal();
    fireEvent.click(drawing('A'));
    fireEvent.click(screen.getByRole('button', { name: 'Clamp' }));
    const svg = drawing('A').querySelector('[data-board-frame]')!.closest('svg')!;
    // The left edge beside the upper stack: the pointer stays right on the preview under it.
    fireEvent.pointerMove(svg, clientOf('A', 1, 380));
    const preview = await waitFor(() => {
      const g = drawing('A').querySelector('[data-hold-preview="clamp"]');
      expect(g).toBeTruthy();
      return g!;
    });
    // A preview doesn't take the pointer: what's under it gets the click.
    expect(getComputedStyle(preview).pointerEvents).toBe('none');
    expect(screen.getByLabelText('Board A status').textContent).toMatch(
      /Part 1a, Part 1b, Part 2 move \d+ mm right\. Board size unchanged\./
    );
    // Flush the ResizeObserver's React update as well as the animation frames. Otherwise
    // the next synthetic gesture can apply the new fitted scale after clientOf read the old one.
    await act(async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    // Preview the same integer CSS pixels used by the click rather than assuming their inverse is exactly 380 mm
    // at every fitted drawing scale.
    const click = new MouseEvent('click', { ...clientOf('A', 1, 380), bubbles: true, cancelable: true });
    const at = { clientX: click.clientX, clientY: click.clientY };
    fireEvent.pointerMove(svg, at);
    const frame = drawing('A').querySelector<SVGGraphicsElement>('[data-board-frame]')!;
    const toe = [...drawing('A').querySelector('[data-hold-preview="clamp"]')!.querySelectorAll('rect')].at(-1)!;
    const previewAt = +toe.getAttribute('y')! + +toe.getAttribute('height')! / 2;
    // Capture the delivered click in the current frame: ResizeObserver may apply a final fitted-scale update when
    // React flushes the gesture. The position is still required to match both the target and preview within a pixel.
    let placed!: DOMPoint,
      pixelMm = 0;
    svg.addEventListener(
      'click',
      event => {
        const inverse = frame.getScreenCTM()!.inverse();
        placed = new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
        pixelMm = Math.abs(new DOMPoint(0, 1).matrixTransform(inverse).y - new DOMPoint(0, 0).matrixTransform(inverse).y);
      },
      { capture: true, once: true }
    );
    fireEvent(svg, click);
    expect(placed.x).toBeLessThan(10);
    expect(Math.abs(placed.y - 380)).toBeLessThanOrEqual(pixelMm);
    expect(Math.abs(previewAt - Math.round(placed.y))).toBeLessThanOrEqual(pixelMm + 1);
    await waitFor(
      async () => {
        const a = (await getJob(job.id))!.boards!.find(b => b.name === 'A')!;
        expect(a.fixtures).toEqual([{ kind: 'clamp', side: 'left', at: Math.round(placed.y) }]);
        expect(a.layout!.w).toBe(574);
        expect(a.layout!.h).toBe(750);
      },
      { timeout: 10_000 }
    );
    expect(screen.getByLabelText('Board A status').textContent).toMatch(/1 clamp: the board can still turn/);
    // Placed: now a real fixture, with its hand cursor; the tool steps aside over it.
    fireEvent.pointerMove(svg, at);
    expect(drawing('A').querySelector('[data-hold="clamp"]')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Clamp' }).getAttribute('aria-pressed')).toBe('false');
  }, 90_000);

  it('says plainly when holds there don’t surround the work and Suggest can’t fix it', async () => {
    const job = await openKinderregal();
    openBoard('B');
    const boardB = async () => (await getJob(job.id))!.boards!.find(b => b.name === 'B')!;
    await waitFor(async () => expect((await boardB()).layout).toBeTruthy(), { timeout: 10_000 });
    const saved = (await getJob(job.id))!;
    // The back fills its board, and this size is fixed: no edge has room for what's missing.
    const { w, h } = (await boardB()).layout!;
    const hold = { kind: 'clamp' as const, side: 'left' as const, at: h / 2 };
    await saveJob({
      ...saved,
      boards: saved.boards!.map(b => (b.name === 'B' ? { ...b, size: { fit: false as const, w, h }, fixtures: [hold] } : b)),
    });
    cleanup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BoardsStep />
      </QueryClientProvider>
    );
    await screen.findByRole('button', { name: 'Board B' }, { timeout: 60_000 });
    openBoard('B');
    await suggestHolds();
    await waitFor(() => expect(document.body.textContent).toMatch(/These holds don’t surround the work’s middle/), { timeout: 10_000 });
    expect(document.body.textContent).not.toMatch(/already surround/);
  }, 90_000);

  it('Fewer and More change one clamp and leave the others put', async () => {
    const job = await openKinderregal();
    fireEvent.click(drawing('A'));
    const saved = async () => (await getJob(job.id))!.boards!.find(b => b.name === 'A')!;
    const isOff = (item: HTMLElement) => item.hasAttribute('data-disabled');
    const fewer = () => holdsMenu('One clamp fewer');
    const more_ = () => holdsMenu('One clamp more');
    const closeMenu = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    // Saved is shown too once settled: the next menu opens on a drawing with the holds, so the update can't close it.
    const shown = (count: number) => expect(drawing('A').querySelectorAll('[data-hold]')).toHaveLength(count);
    // Nothing to nudge until there are holds.
    expect(isOff(await fewer())).toBe(true);
    expect(isOff(screen.getByRole('menuitem', { name: 'One clamp more' }))).toBe(true);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Suggest holds' }));
    await settled({ timeout: 60_000 });
    expect((await saved()).fixtures?.length).toBeGreaterThanOrEqual(3);
    const before = (await saved()).fixtures!;
    shown(before.length);
    fireEvent.click(await more_());
    await settled({ timeout: 60_000 });
    expect((await saved()).fixtures).toHaveLength(before.length + 1);
    expect((await saved()).fixtures!.slice(0, before.length)).toEqual(before);
    // Fewer takes that one back, or a clamp the rest do without: what stays, stays where it was.
    const more = (await saved()).fixtures!;
    shown(more.length);
    const item = await fewer();
    expect(isOff(item)).toBe(more.length <= 3);
    if (isOff(item)) closeMenu();
    else fireEvent.click(item);
    await settled({ timeout: 60_000 });
    expect((await saved()).fixtures).toHaveLength(more.length - 1);
    for (const f of (await saved()).fixtures!) expect(more).toContainEqual(f);
  }, 90_000);

  it('drags a placed clamp: it stays a fixture all the way, lands where dropped, and parts make room', async () => {
    const job = await openKinderregal();
    fireEvent.click(drawing('A'));
    await suggestHolds();
    const saved = async () => (await getJob(job.id))!.boards!.find(b => b.name === 'A')!;
    await waitFor(async () => expect((await saved()).fixtures?.length).toBeGreaterThanOrEqual(3), { timeout: 10_000 });
    const before = (await saved()).fixtures!;
    const i = before.findIndex(f => f.kind === 'clamp' && f.side === 'right');
    const f = before[i] as { at: number };
    const hold = () => drawing('A').querySelectorAll('[data-hold]')[i];
    fireEvent.pointerDown(hold(), { ...clientOf('A', 574, f.at), button: 0, pointerId: 1 });
    for (const dy of [10, 20, 30]) fireEvent.pointerMove(hold(), { ...clientOf('A', 574, f.at + dy), pointerId: 1 });
    // Mid-drag it's still the real one, not a preview: the pointer stays with it.
    expect(drawing('A').querySelector('[data-hold-preview]')).toBeNull();
    fireEvent.pointerUp(hold(), { ...clientOf('A', 574, f.at + 30), pointerId: 1 });
    await waitFor(async () => expect(((await saved()).fixtures![i] as { at: number }).at).toBeCloseTo(f.at + 30, -1), { timeout: 10_000 });
    expect(((await saved()).fixtures![i] as { at: number }).at).not.toBe(f.at);
    // Delete removes it, and the parts stay.
    fireEvent.keyDown(hold(), { key: 'Delete' });
    await waitFor(async () => expect((await saved()).fixtures).toHaveLength(before.length - 1), { timeout: 10_000 });
  }, 90_000);

  describe('Suggest holds on the back, which fills its fitted board', () => {
    const boardB = async (id: string) => (await getJob(id))!.boards!.find(b => b.name === 'B')!;
    const status = () => screen.getByLabelText('Board B status').textContent;
    const noRoom = /No clamp spot has room on this layout/;

    afterEach(() => useStore.setState({ machineBounds: null }));

    /**
     * Machine bounds for this page only. The store saves them to localStorage, which test files running alongside
     * share and read as they start: there, a small machine would split the boards they open.
     */
    async function withMachine(bounds: Box2, run: () => Promise<void>) {
      const storage = useStore.persist.getOptions().storage;
      useStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
      try {
        useStore.setState({ machineBounds: bounds });
        await run();
      } finally {
        useStore.setState({ machineBounds: null });
        useStore.persist.setOptions({ storage });
      }
    }

    it('grows it and says by how much, moves the holds there with the part, and Undo restores it', async () => {
      const job = await openKinderregal();
      openBoard('B');
      await waitFor(async () => expect((await boardB(job.id)).layout).toBeTruthy(), { timeout: 10_000 });
      // A screw the user put there first: a single clamp would already give the board the room for more.
      cleanup();
      const saved = (await getJob(job.id))!;
      const screw = { kind: 'screw' as const, x: 200, y: 200 };
      await saveJob({ ...saved, boards: saved.boards!.map(b => (b.name === 'B' ? { ...b, fixtures: [screw] } : b)) });
      render(
        <QueryClientProvider client={new QueryClient()}>
          <BoardsStep />
        </QueryClientProvider>
      );
      await screen.findByRole('button', { name: 'Board B' }, { timeout: 60_000 });
      openBoard('B');
      const before = await boardB(job.id);

      await suggestHolds();
      await waitFor(async () => expect((await boardB(job.id)).fixtures!.length).toBeGreaterThanOrEqual(3), { timeout: 10_000 });
      const after = await boardB(job.id);
      const grew = (after.layout!.w - before.layout!.w) / 2;
      expect(grew).toBeGreaterThan(0);
      expect(after.layout!.h - before.layout!.h).toBe(2 * grew);
      const [id] = after.items;
      expect(after.layout!.at[id].x).toBeCloseTo(before.layout!.at[id].x + grew);
      expect(after.layout!.at[id].y).toBeCloseTo(before.layout!.at[id].y + grew);
      expect(after.fixtures![0]).toEqual({ kind: 'screw', x: 200 + grew, y: 200 + grew });
      expect(status()).toContain(`the board grew ${grew} mm on each side, to ${after.layout!.w} × ${after.layout!.h}`);

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      await waitFor(async () => expect(await boardB(job.id)).toStrictEqual(before), { timeout: 10_000 });
    }, 90_000);

    it('leaves a fixed board its size', async () => {
      const job = await openKinderregal();
      openBoard('B');
      await waitFor(async () => expect((await boardB(job.id)).layout).toBeTruthy(), { timeout: 10_000 });
      const { w } = (await boardB(job.id)).layout!;
      const input = screen.getByLabelText('Width', { selector: '[id^="board-"]' }) as HTMLInputElement;
      fireEvent.change(input, { target: { value: String(w + 1) } });
      fireEvent.blur(input);
      await waitFor(async () => expect((await boardB(job.id)).size.fit).toBe(false), { timeout: 10_000 });
      const before = await boardB(job.id);
      await suggestHolds();
      // One mm over the part's fit: clamps on that side only, if any, and no border for the others.
      await waitFor(() => expect(status()).toMatch(/Suggested|No clamp spot/));
      expect(status()).not.toContain('grew');
      const after = await boardB(job.id);
      expect([after.layout!.w, after.layout!.h]).toEqual([before.layout!.w, before.layout!.h]);
    }, 90_000);

    it('grows it no further than the machine', async () => {
      const job = await openKinderregal();
      openBoard('B');
      await waitFor(async () => expect((await boardB(job.id)).layout).toBeTruthy(), { timeout: 10_000 });
      const before = await boardB(job.id);
      await withMachine(new Box2(new Vector2(0, 0), new Vector2(before.layout!.w + 2, before.layout!.h + 2)), async () => {
        // The store's bounds are read as the page renders: selecting the board again brings them in.
        openBoard('A');
        openBoard('B');
        await suggestHolds();
        await waitFor(() => expect(status()).toMatch(noRoom));
        expect(await boardB(job.id)).toStrictEqual(before);
      });
    }, 90_000);
  });
});
