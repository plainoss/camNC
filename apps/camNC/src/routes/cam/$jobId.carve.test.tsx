import { createCarvingJob, getJob } from '@/cam/jobDb';
import { ensureWebFont, loadFontCatalog } from '@/cam/webFonts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const open = async () => {
  const job = await createCarvingJob();
  params.jobId = job.id;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CarveStep />
    </QueryClientProvider>
  );
  await screen.findByTestId('carving-outline');
  return job;
};

describe('the Carve step', () => {
  it('shows the lettering on its board and goes on to Plan', async () => {
    const job = await open();
    expect(screen.getByRole('img', { name: 'Board 300 × 140 mm with the carving' })).toBeTruthy();
    expect(screen.getByTestId('carving-outline').getAttribute('d')).toMatch(/^M/);
    expect(screen.getByRole('link', { name: /Next: Plan/ }).getAttribute('href')).toBe(`/cam/${job.id}/plan`);
    expect((screen.getByLabelText('Text') as HTMLInputElement).value).toBe('Welcome');
  });

  it('opens the SVG picker from the tab and selects the uploaded artwork', async () => {
    const job = await open();
    const input = screen.getByLabelText('Or an SVG file') as HTMLInputElement;
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    const svgTab = screen.getByRole('tab', { name: 'SVG' });
    fireEvent.click(svgTab);
    expect(click).toHaveBeenCalledTimes(1);
    // The tab shows the chooser is opening until it closes.
    expect(svgTab.getAttribute('aria-busy')).toBe('true');
    fireEvent(input, new Event('cancel'));
    expect(svgTab.getAttribute('aria-busy')).toBe('false');
    fireEvent.click(svgTab);
    expect(click).toHaveBeenCalledTimes(2);
    fireEvent.focus(window);
    expect(svgTab.getAttribute('aria-busy')).toBe('false');
    // Opening or cancelling the picker keeps the existing lettering.
    fireEvent.change(input, { target: { files: [] } });
    expect(svgTab.getAttribute('aria-selected')).toBe('false');
    expect((await getJob(job.id))?.carving?.art).toEqual(job.carving!.art);

    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="100" height="100"/></svg>';
    fireEvent.change(input, { target: { files: [new File([svg], 'half.svg', { type: 'image/svg+xml' })] } });
    expect(await screen.findByText('half.svg')).toBeTruthy();
    expect(svgTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText('Another SVG')).toBe(input);
    expect((await getJob(job.id))?.carving?.art).toEqual({ kind: 'svg', svg, fileName: 'half.svg' });
    fireEvent.click(svgTab);
    expect(click).toHaveBeenCalledTimes(2);

    const replacement = svg.replace('200 100', '100 100');
    fireEvent.change(input, { target: { files: [new File([replacement], 'square.svg', { type: 'image/svg+xml' })] } });
    expect(await screen.findByText('square.svg')).toBeTruthy();
    expect((await getJob(job.id))?.carving?.art).toEqual({ kind: 'svg', svg: replacement, fileName: 'square.svg' });
  });

  it('outlines new text once typing pauses, and saves it', async () => {
    const job = await open();
    const before = job.carving!.region;
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hi' } });
    await waitFor(async () => {
      const saved = await getJob(job.id);
      expect(saved?.carving?.art).toMatchObject({ kind: 'text', text: 'Hi' });
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
        expect(screen.getByRole('tab', { name: 'Lettering' }).getAttribute('aria-selected')).toBe('true');
        await waitFor(() => expect(ensureWebFont).toHaveBeenCalledTimes(1));
        fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hi' } });
        // Exercise downloads finishing both before and after the text debounce.
        if (debounceFinished) await waitFor(() => expect(ensureWebFont).toHaveBeenCalledTimes(2));
        expect((await getJob(job.id))?.carving?.art).toEqual(job.carving!.art);
        finishDownload();
        await waitFor(async () => {
          expect((await getJob(job.id))?.carving?.art).toEqual({ kind: 'text', text: 'Hi', font: { family: 'Lobster', weight: 400 } });
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
      expect((await getJob(job.id))?.carving?.art).toEqual({ ...job.carving!.art, text: 'Retry' });
    });
    expect(ensureWebFont).toHaveBeenCalledTimes(2);
  });

  it('moves the artwork where it is dragged, without drawing it again', async () => {
    const job = await open();
    const path = screen.getByTestId('carving-outline');
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
      expect(saved!.carving!.x - job.carving!.x).toBeCloseTo(20, 0);
      expect(saved!.carving!.region[0][0].x - job.carving!.region[0][0].x).toBeCloseTo(20, 0);
    });
  });

  it('warns when the depth is deeper than the V-bit’s cone', async () => {
    await open();
    expect(screen.getByText(/get a flat bottom/).textContent).not.toMatch(/cone is only/);
    fireEvent.change(screen.getByLabelText('Deepest (mm)'), { target: { value: '6' } });
    fireEvent.blur(screen.getByLabelText('Deepest (mm)'));
    expect(await screen.findByText(/cone is only 5\.2 mm deep/)).toBeTruthy();
  });
});
