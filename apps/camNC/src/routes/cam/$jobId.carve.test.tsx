import { createCarvingJob, getJob, type CamJobV1 } from '@/cam/jobDb';
import { carvingRegion, placeItem } from '@/cam/carving';
import { outlineArt } from '@/cam/carvingOutline';
import { ensureWebFont, loadFontCatalog } from '@/cam/webFonts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
vi.mock('@/cam/carvingOutline', async importOriginal => {
  const original = await importOriginal<typeof import('@/cam/carvingOutline')>();
  return { ...original, outlineArt: vi.fn(original.outlineArt) };
});
vi.mock('@/cam/webFonts', async importOriginal => ({
  ...(await importOriginal<typeof import('@/cam/webFonts')>()),
  ensureWebFont: vi.fn(async () => {}),
  fontsOnDevice: async () => [],
  previewStylesheetUrl: (family: string) => `data:text/css,/*${encodeURIComponent(family)}*/`,
}));

const CarveStep = (Route as unknown as { options: { component: ComponentType } }).options.component;

beforeAll(() => loadFontCatalog(), 30_000);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(ensureWebFont).mockReset();
});

const pickFont = async (family: string) => {
  fireEvent.click(screen.getByRole('combobox', { name: 'Font' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Search fonts' }), { target: { value: family } });
  fireEvent.click(await screen.findByRole('option', { name: family }, { timeout: 10_000 }));
};

const open = async (existing?: Awaited<ReturnType<typeof createCarvingJob>>) => {
  const job = existing ?? (await createCarvingJob(undefined, { lettering: 'Welcome' }));
  params.jobId = job.id;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CarveStep />
    </QueryClientProvider>
  );
  await screen.findByTestId('carving-item');
  return job;
};

describe('the Carve step', () => {
  /** Opens a side panel from the board's toolbar. */
  const openPanel = (name: 'Items' | 'Board and bit') => fireEvent.click(screen.getByRole('button', { name }));

  it('shows the lettering on its board and goes on to Plan', async () => {
    const job = await open();
    expect(screen.getByRole('img', { name: 'Board 300 × 140 mm with the carving' })).toBeTruthy();
    expect(screen.getByTestId('carving-item').getAttribute('d')).toMatch(/^M/);
    expect(screen.getByRole('link', { name: /Next: Plan/ }).getAttribute('href')).toBe(`/cam/${job.id}/plan`);
    expect((screen.getByLabelText('Text') as HTMLInputElement).value).toBe('Welcome');
  });

  it('starts a new carving empty, with the ways to start on the board and one side panel at a time', async () => {
    const job = await createCarvingJob();
    expect(job.carving!.items).toEqual([]);
    params.jobId = job.id;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CarveStep />
      </QueryClientProvider>
    );
    const start = await screen.findByRole('group', { name: 'Start your carving' });
    // No panel takes room from the board until a tool asks for one.
    expect(screen.queryByRole('complementary')).toBeNull();
    const tool = (name: string) => within(screen.getByRole('group', { name: 'Carve tools' })).getByRole('button', { name });
    fireEvent.click(tool('Items'));
    expect(within(screen.getByRole('complementary', { name: 'Items' })).getByText(/Nothing on the board yet/)).toBeTruthy();
    expect(tool('Items').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(tool('Board and bit'));
    expect(screen.queryByText(/Nothing on the board yet/)).toBeNull();
    expect(screen.getByLabelText('V-bit')).toBeTruthy();
    fireEvent.click(tool('AI artwork'));
    expect(screen.queryByLabelText('V-bit')).toBeNull();
    expect(screen.getByRole('complementary', { name: 'AI artwork' })).toBeTruthy();
    // With the assistant open, its box marks the spot, so the start card steps aside.
    expect(screen.queryByRole('group', { name: 'Start your carving' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close AI artwork' }));
    expect(screen.queryByRole('complementary')).toBeNull();
    fireEvent.click(
      within(await screen.findByRole('group', { name: 'Start your carving' })).getByRole('button', { name: 'Add lettering' })
    );
    await waitFor(async () => expect((await getJob(job.id))!.carving!.items).toHaveLength(1));
    expect(start.isConnected).toBe(false);
    expect((screen.getByLabelText('Text') as HTMLInputElement).value).toBe('Text');
  });

  it('adds SVG alongside text, selects it, and replaces just that item', async () => {
    const job = await open();
    const input = screen.getByLabelText('SVG file') as HTMLInputElement;
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    const svgButton = screen.getByRole('button', { name: 'Open SVG' });
    fireEvent.click(svgButton);
    expect(click).toHaveBeenCalledTimes(1);
    // The button shows the chooser is opening until it closes.
    expect(svgButton.getAttribute('aria-busy')).toBe('true');
    fireEvent(input, new Event('cancel'));
    expect(svgButton.getAttribute('aria-busy')).toBe('false');
    fireEvent.click(svgButton);
    fireEvent.focus(window);
    expect(svgButton.getAttribute('aria-busy')).toBe('false');
    fireEvent.change(input, { target: { files: [] } });
    expect((await getJob(job.id))?.carving?.items).toEqual(job.carving!.items);

    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="100" height="100"/></svg>';
    fireEvent.change(input, { target: { files: [new File([svg], 'half.svg', { type: 'image/svg+xml' })] } });
    await screen.findByRole('button', { name: 'Replace SVG' });
    await waitFor(async () => {
      const carving = (await getJob(job.id))!.carving!;
      expect(carving.items).toHaveLength(2);
      expect(carving.items[1].art).toEqual({ kind: 'svg', svg, fileName: 'half.svg' });
      expect(carving.items[1].outline.length).toBeGreaterThan(0);
      expect(carving.region).toEqual(carvingRegion(carving.items));
    });
    expect(screen.getAllByTestId('carving-item')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Replace SVG' }));
    expect(click).toHaveBeenCalledTimes(3);
    const replacement = svg.replace('200 100', '100 100');
    fireEvent.change(input, { target: { files: [new File([replacement], 'square.svg', { type: 'image/svg+xml' })] } });
    await waitFor(async () => {
      const carving = (await getJob(job.id))!.carving!;
      expect(carving.items[0]).toEqual(job.carving!.items[0]);
      expect(carving.items[1].art).toEqual({ kind: 'svg', svg: replacement, fileName: 'square.svg' });
    });
  });

  it('adds nothing for an SVG it cannot read, and still lets the other items be planned', async () => {
    const job = await open();
    const input = screen.getByLabelText('SVG file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['<svg'], 'broken.svg', { type: 'image/svg+xml' })] } });
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be read/);
    expect((await getJob(job.id))!.carving!.items).toEqual(job.carving!.items);
    expect(screen.getAllByTestId('carving-item')).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Next: Plan/ }).hasAttribute('disabled')).toBe(false);
  });

  it('outlines new text once typing pauses, and saves it', async () => {
    const job = await open();
    const before = job.carving!.region;
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hi' } });
    await waitFor(async () => {
      const saved = await getJob(job.id);
      expect(saved?.carving?.items[0].art).toMatchObject({ kind: 'text', text: 'Hi' });
      expect(saved?.carving?.region).not.toEqual(before);
    });
  });

  it.each([false, true])(
    'keeps a selected web font when text changes during its download (debounce finished: %s)',
    async debounceFinished => {
      const job = await open();
      let finishDownload!: () => void;
      const download = new Promise<void>(resolve => {
        finishDownload = resolve;
      });
      vi.mocked(ensureWebFont).mockReturnValue(download);
      try {
        await pickFont('Lobster');
        expect(screen.getByRole('combobox', { name: 'Font' }).textContent).toContain('Lobster');
        expect(screen.queryByRole('tablist')).toBeNull();
        await waitFor(() => expect(ensureWebFont).toHaveBeenCalledTimes(1));
        fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hi' } });
        // Exercise downloads finishing both before and after the text debounce.
        if (debounceFinished) await waitFor(() => expect(ensureWebFont).toHaveBeenCalledTimes(2));
        expect((await getJob(job.id))?.carving?.items[0].art).toEqual(job.carving!.items[0].art);
        finishDownload();
        await waitFor(async () => {
          expect((await getJob(job.id))?.carving?.items[0].art).toEqual({
            kind: 'text',
            text: 'Hi',
            font: { family: 'Lobster', weight: 400 },
          });
        });
        expect(screen.getByRole('combobox', { name: 'Font' }).textContent).toContain('Lobster');
        expect(screen.queryByText('Outlining…')).toBeNull();
      } finally {
        finishDownload();
      }
    }
  );

  it('restores the saved artwork and keeps the error when the pending font fails', async () => {
    const job = await open();
    let failDownload!: (error: Error) => void;
    vi.mocked(ensureWebFont).mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        failDownload = reject;
      })
    );
    await pickFont('Lobster');
    await waitFor(() => expect(ensureWebFont).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hi' } });
    await waitFor(() => expect(ensureWebFont).toHaveBeenCalledTimes(2));
    failDownload(new Error('Font download failed'));
    expect((await screen.findByRole('alert')).textContent).toContain('Font download failed');
    await waitFor(() => {
      expect((screen.getByLabelText('Text') as HTMLInputElement).value).toBe('Welcome');
      expect(screen.getByRole('combobox', { name: 'Font' }).textContent).toContain('Serif, bold');
    });
    // A new edit proves that the failed selection no longer supplies the font.
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Retry' } });
    await waitFor(async () => {
      expect((await getJob(job.id))?.carving?.items[0].art).toEqual({ ...job.carving!.items[0].art, text: 'Retry' });
    });
    expect(ensureWebFont).toHaveBeenCalledTimes(2);
  });

  it('moves the artwork where it is dragged, without drawing it again', async () => {
    const job = await open();
    vi.mocked(outlineArt).mockClear();
    const path = screen.getByTestId('carving-item');
    const svg = path.closest('svg')!;
    // 1 mm on the board in screen pixels.
    const px = svg.getBoundingClientRect().width / (300 * 1.12);
    const r = path.getBoundingClientRect();
    const from = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1 };
    fireEvent.pointerDown(path, from);
    fireEvent.pointerMove(svg, { ...from, clientX: from.clientX + 20 * px });
    fireEvent.pointerUp(svg, from);
    await waitFor(async () => {
      const saved = await getJob(job.id);
      expect(saved!.carving!.items[0].x - job.carving!.items[0].x).toBeCloseTo(20, 0);
      expect(saved!.carving!.items[0].outline).toEqual(job.carving!.items[0].outline);
      expect(saved!.carving!.region).toEqual(carvingRegion(saved!.carving!.items));
      expect(outlineArt).not.toHaveBeenCalled();
    });
  });

  it('keeps text typed just before the selection changes', async () => {
    const job = await open();
    openPanel('Items');
    fireEvent.click(screen.getByRole('button', { name: 'Lettering' }));
    await waitFor(() => expect(screen.getAllByTestId('carving-item')).toHaveLength(2));
    // Within the debounce: picking another item from the list unmounts the editor.
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Second' } });
    fireEvent.click(screen.getByRole('button', { name: '"Welcome"' }));
    // And clicking the empty board.
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'First' } });
    fireEvent.pointerDown(screen.getAllByTestId('carving-item')[0].closest('svg')!, { button: 0 });
    expect(screen.queryByLabelText('Text')).toBeNull();
    await waitFor(async () => {
      const items = (await getJob(job.id))!.carving!.items;
      expect(items.map(item => item.art)).toMatchObject([{ text: 'First' }, { text: 'Second' }]);
      expect(items[0].outline).not.toEqual(job.carving!.items[0].outline);
    });
  });

  it('keeps text typed just before a drag hides the bar', async () => {
    const job = await open();
    const svg = screen.getByTestId('carving-item').closest('svg')!;
    const at = (x: number, y: number) => {
      const p = new DOMPoint(x, 140 - y).matrixTransform(svg.getScreenCTM()!);
      return { clientX: p.x, clientY: p.y, pointerId: 1, button: 0 };
    };
    const text = async () => (await getJob(job.id))!.carving!.items[0].art;
    // Moving the selected item: the selection stays, but the bar unmounts while dragging.
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Moved' } });
    fireEvent.pointerDown(screen.getByTestId('carving-item'), at(150, 70));
    fireEvent.pointerMove(svg, at(160, 70));
    fireEvent.pointerUp(svg, at(160, 70));
    await waitFor(async () => expect(await text()).toMatchObject({ text: 'Moved' }));
    // Sizing it by the corner: the release outlines again, with the text typed before the drag.
    await waitFor(() => expect(screen.queryByText('Outlining…')).toBeNull());
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Sized' } });
    fireEvent.pointerDown(screen.getByLabelText('Drag to resize'), at(190, 55));
    fireEvent.pointerMove(svg, at(220, 40));
    await waitFor(() => expect(screen.queryByText('Outlining…')).toBeNull());
    fireEvent.pointerUp(svg, at(220, 40));
    // The text was outlined during the drag; the release's outline must not bring back the earlier text.
    await waitFor(() => expect(screen.queryByText('Outlining…')).toBeNull());
    expect(await text()).toMatchObject({ text: 'Sized' });
    expect((await getJob(job.id))!.carving!.items[0].height).toBeGreaterThan(30);
    // Sizing the board.
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Board' } });
    fireEvent.pointerDown(svg.querySelector('[data-resize="w"]')!, { clientX: 0, clientY: 0, pointerId: 1, button: 0 });
    fireEvent.pointerUp(svg, { clientX: 0, clientY: 0, pointerId: 1 });
    await waitFor(async () => expect(await text()).toMatchObject({ text: 'Board' }));
  });

  it('undoes and redoes moves and deletes, by button and ⌘Z, but not inside a text field', async () => {
    const job = await open();
    const undo = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
    const redo = screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    const path = screen.getByTestId('carving-item');
    const svg = path.closest('svg')!;
    const px = svg.getBoundingClientRect().width / (300 * 1.12);
    const r = path.getBoundingClientRect();
    const from = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1 };
    fireEvent.pointerDown(path, from);
    fireEvent.pointerMove(svg, { ...from, clientX: from.clientX + 20 * px });
    fireEvent.pointerUp(svg, from);
    const x0 = job.carving!.items[0].x;
    await waitFor(async () => expect((await getJob(job.id))!.carving!.items[0].x - x0).toBeCloseTo(20, 0));
    // ⌘Z in the selected item's text field is the field's own.
    fireEvent.keyDown(screen.getByLabelText('Text'), { key: 'z', metaKey: true });
    expect((await getJob(job.id))!.carving!.items[0].x - x0).toBeCloseTo(20, 0);
    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Delete "Welcome"' }));
    await waitFor(async () => expect((await getJob(job.id))!.carving!.items).toHaveLength(0));
    fireEvent.click(undo);
    await waitFor(async () => {
      const items = (await getJob(job.id))!.carving!.items;
      expect(items).toHaveLength(1);
      expect(items[0].x - x0).toBeCloseTo(20, 0);
    });
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(async () => expect((await getJob(job.id))!.carving!.items).toEqual(job.carving!.items));
    expect(undo.disabled).toBe(true);
    fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true });
    await waitFor(async () => expect((await getJob(job.id))!.carving!.items[0].x - x0).toBeCloseTo(20, 0));
    fireEvent.click(redo);
    await waitFor(async () => expect((await getJob(job.id))!.carving!.items).toHaveLength(0));
    expect(redo.disabled).toBe(true);
    expect(undo.disabled).toBe(false);
  });

  it('undoes by ⌘Z or Ctrl+Z from a panel checkbox, select or number field, but not while a number is typed', async () => {
    const job = await open();
    const carving = async () => (await getJob(job.id))!.carving!;
    fireEvent.click(screen.getByRole('button', { name: 'Board and bit' }));
    const cut = screen.getByRole('checkbox', { name: /Cut it out/ });
    cut.focus();
    fireEvent.click(cut);
    await waitFor(async () => expect((await carving()).cutout).toBeDefined());
    expect(document.activeElement).toBe(cut);
    fireEvent.keyDown(cut, { key: 'z', metaKey: true });
    await waitFor(async () => expect((await carving()).cutout).toBeUndefined());

    const bit = screen.getByLabelText('V-bit') as HTMLSelectElement;
    bit.focus();
    fireEvent.change(bit, { target: { value: '16' } });
    await waitFor(async () => expect((await carving()).vBit.number).toBe(16));
    fireEvent.keyDown(bit, { key: 'z', ctrlKey: true });
    await waitFor(async () => expect((await carving()).vBit.number).toBe(job.carving!.vBit.number));
    expect(bit.value).toBe(String(job.carving!.vBit.number));

    const depth = screen.getByLabelText('Deepest (mm)') as HTMLInputElement;
    const was = job.carving!.maxDepth;
    fireEvent.change(depth, { target: { value: '4' } });
    fireEvent.blur(depth);
    await waitFor(async () => expect((await carving()).maxDepth).toBe(4));
    // Typing not yet taken is the field's own to undo.
    fireEvent.change(depth, { target: { value: '5' } });
    fireEvent.keyDown(depth, { key: 'z', metaKey: true });
    expect(depth.value).toBe('5');
    expect((await carving()).maxDepth).toBe(4);
    // Showing the saved value again, the field's ⌘Z undoes the depth.
    fireEvent.keyDown(depth, { key: 'Escape' });
    expect(Number(depth.value)).toBe(4);
    fireEvent.keyDown(depth, { key: 'z', metaKey: true });
    await waitFor(async () => expect((await carving()).maxDepth).toBe(was));
    expect(Number(depth.value)).toBe(was);
  });

  it('drops a board resize under way when undoing, keeping redo', async () => {
    const job = await open();
    openPanel('Board and bit');
    const redo = screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement;
    const path = screen.getByTestId('carving-item');
    const svg = path.closest('svg')!;
    const px = () => svg.getScreenCTM()!.a;
    const r = path.getBoundingClientRect();
    const from = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1 };
    fireEvent.pointerDown(path, from);
    fireEvent.pointerMove(svg, { ...from, clientX: from.clientX + 20 * px() });
    fireEvent.pointerUp(svg, from);
    const x0 = job.carving!.items[0].x;
    await waitFor(async () => expect((await getJob(job.id))!.carving!.items[0].x - x0).toBeCloseTo(20, 0));

    const width = () => (screen.getByLabelText('Width', { selector: '#carve-board-w' }) as HTMLInputElement).value;
    const edge = svg.querySelector('[data-resize="w"]')!.getBoundingClientRect();
    const grip = { clientX: edge.left + edge.width / 2, clientY: edge.top + edge.height / 2, pointerId: 1 };
    fireEvent.pointerDown(svg.querySelector('[data-resize="w"]')!, grip);
    fireEvent.pointerMove(svg, { ...grip, clientX: grip.clientX + 43 * px() });
    expect(width()).toBe('340');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(async () => expect((await getJob(job.id))!.carving!.items).toEqual(job.carving!.items));
    expect(width()).toBe('300');
    // The release finds no resize left to save.
    fireEvent.pointerMove(svg, { ...grip, clientX: grip.clientX + 60 * px() });
    fireEvent.pointerUp(svg, grip);
    expect(width()).toBe('300');
    expect((await getJob(job.id))!.boards![0].size).toEqual({ fit: false, w: 300, h: 140 });
    expect(redo.disabled).toBe(false);
  });

  it('edits text on the board itself after a double-click, keeping it on Enter and dropping it on Escape', async () => {
    const job = await open();
    const path = screen.getByTestId('carving-item');
    const svg = path.closest('svg')!;
    const press = () => {
      fireEvent.pointerDown(screen.getByTestId('carving-item'), { button: 0, pointerId: 1 });
      fireEvent.pointerUp(svg, { pointerId: 1 });
      fireEvent.doubleClick(svg);
    };
    press();
    const typed = screen.getByRole('textbox', { name: 'Text on the board' }) as HTMLInputElement;
    expect(document.activeElement).toBe(typed);
    expect(typed.value).toBe('Welcome');
    // The ink and the bar make way for the text being typed.
    expect(screen.queryByTestId('carving-item')).toBeNull();
    expect(screen.queryByRole('toolbar')).toBeNull();
    fireEvent.change(typed, { target: { value: 'Oak & Ash' } });
    fireEvent.keyDown(typed, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Text on the board' })).toBeNull();
    // Escape left the item selected, as it was.
    expect((screen.getByLabelText('Text') as HTMLInputElement).value).toBe('Welcome');
    expect((await getJob(job.id))!.carving!.items[0].art).toMatchObject({ text: 'Welcome' });
    press();
    fireEvent.change(screen.getByRole('textbox', { name: 'Text on the board' }), { target: { value: 'Oak & Ash' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Text on the board' }), { key: 'Enter' });
    await waitFor(async () => {
      const item = (await getJob(job.id))!.carving!.items[0];
      expect(item.art).toMatchObject({ text: 'Oak & Ash' });
      expect(item.outline).not.toEqual(job.carving!.items[0].outline);
    });
    expect((screen.getByLabelText('Text') as HTMLInputElement).value).toBe('Oak & Ash');
    // And typed text is kept when the board is clicked away from it.
    press();
    fireEvent.change(screen.getByRole('textbox', { name: 'Text on the board' }), { target: { value: 'Elm' } });
    fireEvent.pointerDown(svg, { button: 0 });
    await waitFor(async () => expect((await getJob(job.id))!.carving!.items[0].art).toMatchObject({ text: 'Elm' }));
  });

  it('selects an item by a click anywhere in its box, not only on its ink', async () => {
    await open();
    const svg = screen.getAllByTestId('carving-item')[0].closest('svg')!;
    fireEvent.pointerDown(svg, { button: 0 });
    expect(screen.queryByRole('toolbar')).toBeNull();
    // The middle of "Welcome"'s box, between its letters' strokes or not.
    const box = screen.getByTestId('carving-item-box').getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + 2, box.top + 2)!;
    expect(hit.getAttribute('data-testid')).toBe('carving-item-box');
    fireEvent.pointerDown(hit, { button: 0, pointerId: 1, clientX: box.left + 2, clientY: box.top + 2 });
    fireEvent.pointerUp(svg, { pointerId: 1 });
    expect(screen.getByRole('toolbar', { name: 'Lettering' })).toBeTruthy();
  });

  it('adds text, selects items from the list and canvas, edits just the selection, and deletes it', async () => {
    const job = await open();
    openPanel('Items');
    fireEvent.click(screen.getByRole('button', { name: 'Lettering' }));
    await waitFor(() => expect(screen.getAllByTestId('carving-item')).toHaveLength(2));
    expect((screen.getByLabelText('Text') as HTMLInputElement).value).toBe('Text');
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Second' } });
    await waitFor(async () => {
      const carving = (await getJob(job.id))!.carving!;
      expect(carving.items[1].art).toMatchObject({ text: 'Second' });
      expect(carving.items[1]).toMatchObject({ height: 20, x: 150, rotation: 0 });
      // Just below "Welcome", which already sits at the centre, clear of it.
      const lowest = (item: (typeof carving.items)[number]) =>
        Math.min(
          ...placeItem(item)
            .flat()
            .map(p => p.y)
        );
      const highest = (item: (typeof carving.items)[number]) =>
        Math.max(
          ...placeItem(item)
            .flat()
            .map(p => p.y)
        );
      expect(highest(carving.items[1])).toBeLessThan(lowest(carving.items[0]));
      expect(lowest(carving.items[0]) - highest(carving.items[1])).toBeLessThan(10);
      expect(carving.items[0]).toEqual(job.carving!.items[0]);
    });
    fireEvent.click(screen.getByRole('button', { name: '"Welcome"' }));
    expect((screen.getByLabelText('Text') as HTMLInputElement).value).toBe('Welcome');
    const svg = screen.getAllByTestId('carving-item')[0].closest('svg')!;
    fireEvent.pointerDown(svg, { button: 0 });
    expect(screen.getByText('Select an item to edit it on the board.')).toBeTruthy();
    expect(screen.queryByRole('toolbar')).toBeNull();
    fireEvent.pointerDown(screen.getAllByTestId('carving-item')[1], { button: 0, pointerId: 1 });
    fireEvent.pointerUp(svg, { pointerId: 1 });
    expect((screen.getByLabelText('Text') as HTMLInputElement).value).toBe('Second');
    // The selected item's own bar floats over the drawing, as on the Boards step.
    const bar = screen.getByRole('toolbar', { name: 'Lettering' });
    expect(within(bar).getByRole('combobox', { name: 'Font' })).toBeTruthy();
    expect(within(bar).getByRole('button', { name: 'Delete "Second"' })).toBeTruthy();
    fireEvent.keyDown(screen.getByLabelText('Text'), { key: 'Backspace' });
    expect(screen.getAllByTestId('carving-item')).toHaveLength(2);
    fireEvent.keyDown(svg, { key: 'Escape' });
    expect(screen.queryByLabelText('Text')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '"Second"' }));
    fireEvent.keyDown(svg, { key: 'Delete' });
    await waitFor(async () => expect((await getJob(job.id))!.carving!.items).toEqual(job.carving!.items));
    fireEvent.click(screen.getByRole('button', { name: 'Delete "Welcome"' }));
    // An empty board offers the ways to start instead of a warning.
    expect(await screen.findByRole('group', { name: 'Start your carving' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('rotates through the field and handle, snapping unless Shift is held, without re-outlining', async () => {
    const job = await open();
    vi.mocked(outlineArt).mockClear();
    const rotation = screen.getByLabelText('Rotation (°)');
    fireEvent.change(rotation, { target: { value: '-270' } });
    fireEvent.blur(rotation);
    await waitFor(async () => expect((await getJob(job.id))!.carving!.items[0].rotation).toBe(90));
    const svg = screen.getByTestId('carving-item').closest('svg')!;
    const rotate = (startAngle: number, endAngle: number, shiftKey = false) => {
      const at = (angle: number) => {
        const p = new DOMPoint(150 + 30 * Math.cos((angle * Math.PI) / 180), 70 - 30 * Math.sin((angle * Math.PI) / 180)).matrixTransform(
          svg.getScreenCTM()!
        );
        return { clientX: p.x, clientY: p.y, pointerId: 1, button: 0, shiftKey };
      };
      fireEvent.pointerDown(screen.getByLabelText('Drag to rotate'), at(startAngle));
      fireEvent.pointerMove(svg, at(endAngle));
      fireEvent.pointerUp(svg, at(endAngle));
    };
    rotate(180, 202);
    await waitFor(async () => expect((await getJob(job.id))!.carving!.items[0].rotation).toBe(105));
    rotate(195, 217, true);
    await waitFor(async () => expect((await getJob(job.id))!.carving!.items[0].rotation).toBeCloseTo(127));
    const saved = (await getJob(job.id))!.carving!;
    expect(saved.items[0].outline).toEqual(job.carving!.items[0].outline);
    expect(saved.region).toEqual(carvingRegion(saved.items));
    expect(outlineArt).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Drag to rotate').parentElement?.getAttribute('transform')).toContain('rotate(-127');
  });

  it('previews a radial resize and outlines only on release', async () => {
    const job = await open();
    vi.mocked(outlineArt).mockClear();
    const svg = screen.getByTestId('carving-item').closest('svg')!;
    const at = (x: number, y: number) => {
      const p = new DOMPoint(x, 140 - y).matrixTransform(svg.getScreenCTM()!);
      return { clientX: p.x, clientY: p.y, pointerId: 1, button: 0 };
    };
    fireEvent.pointerDown(screen.getByLabelText('Drag to resize'), at(180, 55));
    fireEvent.pointerMove(svg, at(210, 40));
    expect(outlineArt).not.toHaveBeenCalled();
    expect((await getJob(job.id))!.carving!.items[0].height).toBe(30);
    fireEvent.pointerUp(svg, at(210, 40));
    await waitFor(async () => expect((await getJob(job.id))!.carving!.items[0].height).toBe(60));
    expect(outlineArt).toHaveBeenCalledTimes(1);
  });

  it('keeps the latest outline per item, other items, and moves made while outlining', async () => {
    const job = await open();
    openPanel('Items');
    type Outline = Awaited<ReturnType<typeof outlineArt>>;
    let finishFirst!: (outline: Outline) => void;
    let finishLatest!: (outline: Outline) => void;
    vi.mocked(outlineArt)
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finishFirst = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finishLatest = resolve;
          })
      );
    const height = screen.getByLabelText('Height (mm)');
    fireEvent.change(height, { target: { value: '25' } });
    fireEvent.blur(height);
    fireEvent.change(height, { target: { value: '35' } });
    fireEvent.blur(height);
    fireEvent.click(screen.getByRole('button', { name: 'Lettering' }));
    await waitFor(async () => expect((await getJob(job.id))!.carving!.items[1].outline.length).toBeGreaterThan(0));
    // This item's completion must not clear the first item's pending work.
    expect(screen.getByText('Outlining…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '"Welcome"' }));
    fireEvent.change(screen.getByLabelText('Rotation (°)'), { target: { value: '45' } });
    fireEvent.blur(screen.getByLabelText('Rotation (°)'));
    const outline: Outline = { region: job.carving!.items[0].outline, width: 100, height: 35 };
    await act(async () => finishLatest(outline));
    await waitFor(async () => {
      const carving = (await getJob(job.id))!.carving!;
      expect(carving.items).toHaveLength(2);
      expect(carving.items[0]).toMatchObject({ height: 35, rotation: 45 });
      expect(carving.region).toEqual(carvingRegion(carving.items));
    });
    await act(async () => finishFirst({ ...outline, region: [], height: 25 }));
    expect((await getJob(job.id))!.carving!.items[0]).toMatchObject({ height: 35, rotation: 45, outline: outline.region });
    expect(screen.queryByText('Outlining…')).toBeNull();

    let finishDeleted!: (outline: Outline) => void;
    vi.mocked(outlineArt).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishDeleted = resolve;
        })
    );
    fireEvent.change(screen.getByLabelText('Height (mm)'), { target: { value: '40' } });
    fireEvent.blur(screen.getByLabelText('Height (mm)'));
    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Delete "Welcome"' }));
    await act(async () => finishDeleted(outline));
    await waitFor(async () => {
      const carving = (await getJob(job.id))!.carving!;
      expect(carving.items).toHaveLength(1);
      expect(carving.items[0].art).toMatchObject({ text: 'Text' });
    });
    expect(screen.queryByText('Outlining…')).toBeNull();
  });

  it('sizes the board by dragging its edges, in 10 mm steps, with the fields following', async () => {
    const job = await open();
    openPanel('Board and bit');
    const svg = screen.getByTestId('carving-item').closest('svg')!;
    const field = (label: string) =>
      screen.getByLabelText(label, { selector: '#carve-board-' + label[0].toLowerCase() }) as HTMLInputElement;
    const drag = (grip: string, dx: number, dy: number, shiftKey = false) => {
      // 1 mm on the board in screen pixels, as the view is now.
      const px = svg.getScreenCTM()!.a;
      const handle = svg.querySelector(`[data-resize="${grip}"]`)!;
      const r = handle.getBoundingClientRect();
      const from = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1 };
      fireEvent.pointerDown(handle, from);
      fireEvent.pointerMove(svg, { ...from, clientX: from.clientX + dx * px, clientY: from.clientY + dy * px, shiftKey });
      return () => fireEvent.pointerUp(svg, from);
    };

    // The right edge: the width, shown in its field while dragging, saved when dropped.
    const drop = drag('w', 43, 0);
    expect(field('Width').value).toBe('340');
    expect(field('Height').value).toBe('140');
    drop();
    await waitFor(async () => expect((await getJob(job.id))?.boards?.[0].size).toEqual({ fit: false, w: 340, h: 140 }));
    expect(screen.getByRole('img', { name: /^Board 340 × 140 mm/ })).toBeTruthy();

    // The bottom edge grows the board downwards, as on the Boards step; Shift takes single millimetres. The items keep
    // their place below the top edge, so they move up from XY zero by as much.
    const y = (await getJob(job.id))!.carving!.items[0].y;
    drag('h', 0, 23, true)();
    await waitFor(async () => expect((await getJob(job.id))?.boards?.[0].size).toEqual({ fit: false, w: 340, h: 163 }));
    expect((await getJob(job.id))!.carving!.items[0].y).toBe(y + 23);

    // The corner takes both, and stops at the fields' least size.
    drag('wh', -1000, -1000)();
    await waitFor(async () => expect((await getJob(job.id))?.boards?.[0].size).toEqual({ fit: false, w: 20, h: 20 }));

    // Typed sizes move the edges.
    fireEvent.change(field('Width'), { target: { value: '250' } });
    fireEvent.blur(field('Width'));
    await waitFor(() => expect(screen.getByRole('img', { name: /^Board 250 × 20 mm/ })).toBeTruthy());
    const right = svg.querySelector('[data-resize="w"]')!.getBoundingClientRect();
    const board = svg.querySelector('rect')!.getBoundingClientRect();
    expect(right.left + right.width / 2).toBeCloseTo(board.right, 0);
  });

  it('moves the artwork on a narrow board instead of sizing the board', async () => {
    const job = await open();
    openPanel('Board and bit');
    const field = (id: string) => document.getElementById(id) as HTMLInputElement;
    const type = async (id: string, value: string, saved: (job: CamJobV1 | null) => unknown) => {
      fireEvent.change(field(id), { target: { value } });
      fireEvent.blur(field(id));
      await waitFor(async () => expect(saved(await getJob(job.id))).toBe(Number(value)));
    };
    // Each saved before the next, as a slower outline would save over a board size typed meanwhile.
    await type('carve-height', '10', j => j?.carving?.items[0].height);
    const board = (j: CamJobV1 | null) => {
      const size = j?.boards?.[0].size;
      return size?.fit === false ? size : null;
    };
    await type('carve-board-w', '1000', j => board(j)?.w);
    await type('carve-board-h', '20', j => board(j)?.h);
    const path = screen.getByTestId('carving-item');
    const grip = (g: string) => path.closest('svg')!.querySelector(`[data-resize="${g}"]`)!;
    const attr = (el: Element, name: string) => Number(el.getAttribute(name));
    // The edges' grips reach a quarter of the board inwards at most: the bottom one starts 5 mm above the bottom edge.
    expect(attr(grip('h'), 'y')).toBeCloseTo(20 - 5);
    expect(attr(grip('w'), 'x')).toBeCloseTo(1000 - 25);
    // And lie under the artwork, which takes the drag where they meet.
    for (const g of ['w', 'h']) expect(path.compareDocumentPosition(grip(g)) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('warns when the depth is deeper than the V-bit’s cone', async () => {
    await open();
    openPanel('Board and bit');
    expect(screen.getByText(/get a flat bottom/).textContent).not.toMatch(/cone is only/);
    fireEvent.change(screen.getByLabelText('Deepest (mm)'), { target: { value: '6' } });
    fireEvent.blur(screen.getByLabelText('Deepest (mm)'));
    expect(await screen.findByText(/cone is only 5\.2 mm deep/)).toBeTruthy();
  });
});
