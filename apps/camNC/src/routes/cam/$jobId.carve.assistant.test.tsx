import { createCarvingJob, getJob, saveJob, type CamJobV1 } from '@/cam/jobDb';
import { camKeys } from '@/cam/camQueries';
import { carvingRegion, kVBits } from '@/cam/carving';
import { generateCarvingAsset } from '@/cam/carvingAssistant/generation';
import { createAssistantUsage } from '@/cad/assistant/runBudget';
import { defaultProvider, rememberAssistantCredentials } from '@/cad/assistant/keyStore';
import { loadFontCatalog } from '@/cam/webFonts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps, ComponentType, ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Route } from './$jobId.carve';

const params = vi.hoisted(() => ({ jobId: '' }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useParams: () => params,
  Link: ({
    children,
    to,
    params,
    ...rest
  }: { children: ReactNode; to: string; params: { jobId: string } } & Omit<ComponentProps<'a'>, 'href'>) => (
    <a {...rest} href={to.replace('$jobId', params.jobId)}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/page-header', () => ({ PageHeader: () => null }));
vi.mock('@/cam/CamJobBar', () => ({ CamJobBar: ({ actions }: { actions: ReactNode }) => <header>{actions}</header> }));
vi.mock('@/cam/carvingAssistant/generation', () => ({ generateCarvingAsset: vi.fn() }));
vi.mock('@/cam/webFonts', async original => ({
  ...(await original<typeof import('@/cam/webFonts')>()),
  fontsOnDevice: async () => [],
  previewStylesheetUrl: (family: string) => `data:text/css,/*${encodeURIComponent(family)}*/`,
}));

const CarveStep = (Route as unknown as { options: { component: ComponentType } }).options.component;
// A small owl icon with ear tufts, open eyes and a two-page book. The actual raster/geometry/CAM pipeline remains real.
const owl = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 44">
  <path d="M5 4L13 8L27 8L35 4L34 19L37 32L29 39L11 39L3 32L6 19Z"/>
  <circle cx="13" cy="18" r="6" fill="white"/><circle cx="27" cy="18" r="6" fill="white"/>
  <circle cx="13" cy="18" r="2"/><circle cx="27" cy="18" r="2"/>
  <path d="M17 24L23 24L20 28Z" fill="white"/>
  <path d="M4 29L20 32L36 29L36 40L20 43L4 40Z"/>
  <path d="M7 32L18 34L18 40L7 38ZM22 34L33 32L33 38L22 40Z" fill="white"/>
</svg>`;
const asset = {
  id: 'reading-owl-fixture',
  svg: owl,
  prompt: 'An owl reading a book',
  summary: 'Owl with ear tufts, open eyes and an open book.',
  title: 'Reading owl',
};

beforeAll(() => loadFontCatalog(), 30_000);
beforeEach(() => {
  rememberAssistantCredentials({ config: { ...defaultProvider, model: 'recorded-artwork' }, key: 'recorded-key' });
  vi.mocked(generateCarvingAsset).mockReset().mockResolvedValue({ asset, usage: createAssistantUsage() });
});
afterEach(() => {
  cleanup();
  rememberAssistantCredentials(null);
});

async function open(existing?: CamJobV1) {
  const job = existing ?? (await createCarvingJob());
  params.jobId = job.id;
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <CarveStep />
    </QueryClientProvider>
  );
  await screen.findByTestId('carving-item');
  fireEvent.click(screen.getByRole('button', { name: 'Assistant' }));
  await screen.findByRole('complementary', { name: 'Carving assistant' });
  return { job, client, ...view };
}
async function generate() {
  fireEvent.change(screen.getByLabelText('Artwork description'), { target: { value: asset.prompt } });
  fireEvent.change(screen.getByLabelText('Maximum width (mm)'), { target: { value: '30' } });
  fireEvent.change(screen.getByLabelText('Maximum height (mm)'), { target: { value: '30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate artwork' }));
  await screen.findByRole('img', { name: 'Prepared carving artwork' }, { timeout: 20_000 });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Apply artwork' })).toHaveProperty('disabled', true));
}
function acknowledge() {
  fireEvent.click(screen.getByRole('checkbox', { name: 'I have reviewed these detail warnings.' }));
}

it('ends the generated-source link when the artwork is explicitly replaced by a local SVG', async () => {
  const { job } = await open();
  await generate();
  await apply(job.id);
  const generated = (await getJob(job.id))!.carving!.items[1];
  fireEvent.click(within(screen.getByRole('list', { name: 'Items' })).getByRole('button', { name: 'Assistant artwork.svg' }));
  fireEvent.click(screen.getByRole('button', { name: 'Replace SVG' }));
  const replacement = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"/></svg>';
  fireEvent.change(screen.getByLabelText('SVG file'), {
    target: { files: [new File([replacement], 'manual.svg', { type: 'image/svg+xml' })] },
  });
  await waitFor(async () => {
    const current = (await getJob(job.id))!.carving!.items.find(item => item.id === generated.id)!;
    expect(current.art).toEqual({ kind: 'svg', svg: replacement, fileName: 'manual.svg' });
    expect(current.generated).toBeUndefined();
  });
  expect(screen.getByRole('link', { name: 'Next: Plan' }).getAttribute('aria-disabled')).not.toBe('true');
});
async function apply(jobId: string) {
  acknowledge();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Apply artwork' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: 'Apply artwork' }));
  await waitFor(async () => expect((await getJob(jobId))!.carving!.items).toHaveLength(2));
}

it('prepares real owl geometry and CAM without saving, then applies as one reversible edit and reopens its original source locally', async () => {
  const { job } = await open();
  const before = structuredClone(job.carving!);
  await generate();
  expect((await getJob(job.id))!.carving).toEqual(before);
  expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', true);
  const toolpaths = screen.getByRole('img', { name: 'Checked carving toolpaths' });
  expect(toolpaths.querySelector('path')?.getAttribute('d')).toContain('M');
  expect(screen.getByRole('img', { name: 'Original generated artwork' })).toBeTruthy();
  await apply(job.id);
  const applied = (await getJob(job.id))!.carving!;
  expect(applied.items[0]).toEqual(before.items[0]);
  expect(applied.items[1].generated).toMatchObject({ assetId: asset.id, sourceSvg: owl, prompt: asset.prompt });
  expect(applied.region).toEqual(carvingRegion(applied.items));
  expect(applied.items[1].height).toBeLessThanOrEqual(30.1);
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(async () => expect((await getJob(job.id))!.carving).toEqual(before));
  expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
  await waitFor(async () => expect((await getJob(job.id))!.carving).toEqual(applied));
  const artwork = within(screen.getByRole('list', { name: 'Items' })).getByRole('button', { name: 'Assistant artwork.svg' });
  fireEvent.click(artwork);
  fireEvent.click(screen.getByRole('button', { name: 'Assistant' }));
  rememberAssistantCredentials(null);
  fireEvent.click(screen.getByRole('button', { name: 'Assistant' }));
  expect(screen.getByLabelText('Artwork description')).toHaveProperty('value', asset.prompt);
  expect(screen.getByLabelText('Placement')).toHaveProperty('value', 'replace');
  fireEvent.click(screen.getByRole('button', { name: 'Update preview locally' }));
  await screen.findByRole('img', { name: 'Prepared carving artwork' }, { timeout: 20_000 });
  expect(generateCarvingAsset).toHaveBeenCalledTimes(1);
  expect((await getJob(job.id))!.carving).toEqual(applied);
}, 30_000);

it('invalidates accepted suitability and a pending proposal after tool and board edits, then locally rechecks before Plan', async () => {
  const { job } = await open();
  await generate();
  await apply(job.id);
  fireEvent.click(screen.getByRole('button', { name: 'Update preview locally' }));
  await screen.findByRole('img', { name: 'Prepared carving artwork' }, { timeout: 20_000 });
  acknowledge();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Apply artwork' })).toHaveProperty('disabled', false));
  const changedBit = kVBits.find(bit => bit.angle === 90 && bit.diameter === 4)!;
  fireEvent.change(screen.getByLabelText('V-bit'), { target: { value: String(changedBit.number) } });
  fireEvent.change(screen.getByLabelText('Thick'), { target: { value: '20' } });
  fireEvent.blur(screen.getByLabelText('Thick'));
  await waitFor(async () => {
    const changed = (await getJob(job.id))!;
    expect(changed.carving!.vBit.number).toBe(changedBit.number);
    expect(changed.boards![0].thickness).toBe(20);
  });
  expect(screen.getByRole('button', { name: 'Apply artwork' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('link', { name: /Next: Plan/ }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByText(/Generated artwork changed size, placement or cutting settings/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Update preview locally' }));
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: 'I have reviewed these detail warnings.' })).toHaveProperty('checked', false)
  );
  await waitFor(() => expect(screen.getByText(/Preview ready/)).toBeTruthy(), { timeout: 20_000 });
  acknowledge();
  fireEvent.click(screen.getByRole('button', { name: 'Apply artwork' }));
  await waitFor(() => expect(screen.getByRole('link', { name: /Next: Plan/ }).hasAttribute('disabled')).toBe(false));
  expect((await getJob(job.id))!.carving!.items).toHaveLength(2);
  expect(generateCarvingAsset).toHaveBeenCalledTimes(1);
}, 30_000);

it('refuses Apply against a same-tick newer cache entry without saving or recording Undo', async () => {
  const { job, client } = await open();
  await generate();
  acknowledge();
  const applyButton = screen.getByRole('button', { name: 'Apply artwork' });
  await waitFor(() => expect(applyButton).toHaveProperty('disabled', false));
  const changed = await saveJob({ ...job, carving: { ...job.carving!, maxDepth: 1 } });
  act(() => {
    client.setQueryData(camKeys.job(job.id), changed);
    fireEvent.click(applyButton);
  });
  await screen.findByText('The carving or board changed. Recheck the artwork before applying.');
  expect((await getJob(job.id))!.carving).toEqual(changed.carving);
  expect(client.getQueryData<CamJobV1>(camKeys.job(job.id))!.carving).toEqual(changed.carving);
  expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', true);
}, 30_000);
