import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCarvingJob, type CamJobV1 } from '../jobDb';
import { defaultProvider, rememberAssistantCredentials } from '../../cad/assistant/keyStore';
import { createAssistantUsage } from '../../cad/assistant/runBudget';
import { CarvingAssistant } from './CarvingAssistant';
import { CarvingAssistantBoardLayer } from './BoardLayer';
import { useCarvingAssistant } from './useCarvingAssistant';
import { generateCarvingAsset } from './generation';
import { prepareCarvingArt, type PreparedCarvingArt } from './prepare';
import { generateNativeSvgAsset } from './nativeSvg';
import { generateNativeRasterAsset } from './nativeRaster';
import type { CarvingProposal } from './proposal';

vi.mock('./generation', () => ({ generateCarvingAsset: vi.fn() }));
vi.mock('./nativeSvg', () => ({ generateNativeSvgAsset: vi.fn() }));
vi.mock('./nativeRaster', () => ({ generateNativeRasterAsset: vi.fn() }));
vi.mock('./prepare', async original => ({ ...(await original<typeof import('./prepare')>()), prepareCarvingArt: vi.fn() }));

const asset = {
  id: 'owl-1',
  svg: '<svg viewBox="0 0 40 30"><rect width="40" height="30"/></svg>',
  prompt: 'An owl reading a book',
  summary: 'An owl with an open book.',
  title: 'Reading owl',
};
const rasterPreview = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 20;
  canvas.height = 20;
  return { dataUri: canvas.toDataURL('image/png'), width: 20, height: 20 };
};
const candidate = (): PreparedCarvingArt => ({
  art: { kind: 'svg', svg: asset.svg, fileName: 'owl.svg' },
  outline: [
    [
      { x: -20, y: -15 },
      { x: 20, y: -15 },
      { x: 20, y: 15 },
      { x: -20, y: 15 },
    ],
  ],
  width: 40,
  height: 30,
  envelope: { width: 40, height: 30 },
  operations: [],
  report: {
    ok: true,
    errors: [],
    warnings: [],
    detail: 'balanced',
    minFeatureMm: 0.6,
    removedComponents: 0,
    sourceComponents: 1,
    removedCutAreaMm2: 0,
    narrowLandAreaMm2: 0,
    points: 4,
    camPasses: 1,
  },
});

beforeEach(() => {
  rememberAssistantCredentials({ config: { ...defaultProvider, model: 'recorded' }, key: 'recorded-key' });
  vi.mocked(generateCarvingAsset).mockReset().mockResolvedValue({ asset, usage: createAssistantUsage() });
  vi.mocked(prepareCarvingArt).mockReset().mockResolvedValue(candidate());
  vi.mocked(generateNativeSvgAsset).mockReset().mockResolvedValue({ asset, usage: createAssistantUsage() });
  vi.mocked(generateNativeRasterAsset)
    .mockReset()
    .mockResolvedValue({ asset: { ...asset, rasterPreview: rasterPreview(), warnings: [] }, usage: createAssistantUsage() });
});
afterEach(() => {
  cleanup();
  rememberAssistantCredentials(null);
  vi.restoreAllMocks();
});

/** The two places the route puts the assistant: the box on the board, and its side panel. */
function Harness({
  job,
  selectedId,
  onApply,
}: {
  job: CamJobV1;
  selectedId?: string | null;
  onApply: (proposal: CarvingProposal) => void;
}) {
  const session = useCarvingAssistant({ job, selectedId, onApply });
  const { setOpen } = session;
  useEffect(() => setOpen(true), [setOpen]);
  if (!session.open) return null;
  return (
    <>
      <svg viewBox="0 0 300 140">
        <CarvingAssistantBoardLayer session={session} height={140} />
      </svg>
      <CarvingAssistant job={job} session={session} onClose={() => session.setOpen(false)} />
    </>
  );
}

async function open(options: { job?: CamJobV1; selectedId?: string | null } = {}) {
  const job = options.job ?? (await createCarvingJob(undefined, { lettering: 'Welcome' }));
  const onApply = vi.fn();
  const view = render(<Harness job={job} selectedId={options.selectedId ?? null} onApply={onApply} />);
  await screen.findByRole('complementary', { name: 'AI artwork' });
  return { job, onApply, ...view };
}
const describe = (text = asset.prompt) => fireEvent.change(screen.getByLabelText('What should it show?'), { target: { value: text } });
const variants = (n: number) => fireEvent.change(screen.getByLabelText('Variants'), { target: { value: String(n) } });
const ready = () => screen.findByText(/^Ready ·/, {}, { timeout: 5_000 });
const applyButton = () => screen.getByRole('button', { name: /^(Add to|Replace on) board$/ }) as HTMLButtonElement;

it('generates four different variants, previews the first on the board inside the box, and applies only on request', async () => {
  const { job, onApply } = await open();
  describe();
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  await ready();
  expect(generateCarvingAsset).toHaveBeenCalledTimes(4);
  const briefs = vi.mocked(generateCarvingAsset).mock.calls.map(([options]) => options.prompt);
  expect(new Set(briefs).size).toBe(4);
  expect(briefs[2]).toContain('Variant 3 of 4');
  expect(within(screen.getByRole('listbox', { name: 'Artwork variants' })).getAllByRole('option')).toHaveLength(4);
  // Only the picked variant is prepared, at the box size, with the job's tool context.
  expect(prepareCarvingArt).toHaveBeenCalledTimes(1);
  const width = Number((screen.getByLabelText('Box width') as HTMLInputElement).value);
  expect(prepareCarvingArt).toHaveBeenCalledWith(
    expect.objectContaining({ carving: job.carving, board: job.boards![0], width, detail: 'balanced' })
  );
  expect(screen.getByRole('img', { name: 'Proposed artwork on the board' })).toBeTruthy();
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.click(applyButton());
  expect(onApply).toHaveBeenCalledTimes(1);
  const proposal = onApply.mock.calls[0][0] as CarvingProposal;
  expect(proposal.mode).toBe('add');
  // The saved prompt is the user's words, not the variant brief.
  expect(proposal.item.generated?.prompt).toBe(asset.prompt);
});

it('starts from an idea, sends on Enter, and says when the connection cannot make images', async () => {
  await open();
  // The connected Anthropic-style key has no image model, so the vector route is used and the panel says so.
  expect(screen.getByText(/can.t make images, so artwork is drawn as vectors/)).toBeTruthy();
  fireEvent.click(within(screen.getByLabelText('Ideas')).getByRole('button', { name: 'Owl' }));
  expect(screen.getByLabelText('What should it show?')).toHaveProperty('value', 'An owl reading a book');
  expect(screen.queryByLabelText('Ideas')).toBeNull();
  fireEvent.click(screen.getByRole('radio', { name: 'Bold shapes' }));
  variants(1);
  fireEvent.keyDown(screen.getByLabelText('What should it show?'), { key: 'Enter' });
  await waitFor(() => expect(generateCarvingAsset).toHaveBeenCalledTimes(1));
  expect(vi.mocked(generateCarvingAsset).mock.calls[0][0].prompt).toMatch(/bold/i);
});

it('starts the box clear of existing artwork', async () => {
  const { job } = await open();
  const layer = screen.getByTestId('carving-assistant-layer');
  const box = layer.querySelector('rect[aria-label="Artwork box: drag to move"]')!;
  const x = Number(box.getAttribute('x')),
    y = 140 - Number(box.getAttribute('y')) - Number(box.getAttribute('height'));
  const w = Number(box.getAttribute('width')),
    h = Number(box.getAttribute('height'));
  const text = job.carving!.items[0];
  const xs = text.outline.flat().map(p => p.x + text.x),
    ys = text.outline.flat().map(p => p.y + text.y);
  const clear = x >= Math.max(...xs) || x + w <= Math.min(...xs) || y >= Math.max(...ys) || y + h <= Math.min(...ys);
  expect(clear).toBe(true);
});

it('re-prepares by itself when the size or detail changes, without asking the provider again', async () => {
  await open();
  describe();
  variants(1);
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  await ready();
  const height = screen.getByLabelText('Box height');
  fireEvent.change(height, { target: { value: '40' } });
  fireEvent.blur(height);
  await waitFor(() => expect(prepareCarvingArt).toHaveBeenCalledTimes(2));
  expect(vi.mocked(prepareCarvingArt).mock.calls[1][0]).toMatchObject({ height: 40, art: { svg: asset.svg } });
  fireEvent.click(screen.getByRole('radio', { name: 'Detailed' }));
  await waitFor(() => expect(prepareCarvingArt).toHaveBeenCalledTimes(3));
  expect(vi.mocked(prepareCarvingArt).mock.calls[2][0]).toMatchObject({ detail: 'detailed' });
  expect(generateCarvingAsset).toHaveBeenCalledTimes(1);
  describe('The owl with larger eyes');
  fireEvent.click(screen.getByRole('button', { name: 'Refine picked' }));
  await waitFor(() => expect(generateCarvingAsset).toHaveBeenCalledTimes(2));
  expect(vi.mocked(generateCarvingAsset).mock.calls[1][0]).toMatchObject({ previous: { id: asset.id, svg: asset.svg } });
  expect(vi.mocked(generateCarvingAsset).mock.calls[1][0].prompt).toContain('The owl with larger eyes');
});

it('circles thin spots on the board and blocks Apply only for real problems', async () => {
  vi.mocked(prepareCarvingArt).mockResolvedValueOnce({
    ...candidate(),
    report: { ...candidate().report, warnings: ['Small eye detail needs review.'] },
    problemAreas: [{ x: 2, y: 3, r: 1.5, kind: 'narrow' }],
  });
  await open();
  describe();
  variants(1);
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  expect((await ready()).textContent).toContain('1 thin or lost spot is circled on the board');
  expect(screen.getAllByTestId('carving-problem-area')).toHaveLength(1);
  expect(screen.getByText('Small eye detail needs review.')).toBeTruthy();
  expect(applyButton().disabled).toBe(false);
  vi.mocked(prepareCarvingArt).mockResolvedValueOnce({
    ...candidate(),
    report: { ...candidate().report, ok: false, errors: ['No usable cut remains.'] },
  });
  fireEvent.click(screen.getByRole('radio', { name: 'Simple' }));
  await screen.findByText('No usable cut remains.');
  expect(applyButton().disabled).toBe(true);
});

it('explains an overlap at the box instead of offering an Apply', async () => {
  const { job } = await open();
  describe();
  variants(1);
  // Move the box onto the existing lettering.
  const text = job.carving!.items[0];
  fireEvent.change(screen.getByLabelText('Box width'), { target: { value: '280' } });
  fireEvent.blur(screen.getByLabelText('Box width'));
  fireEvent.change(screen.getByLabelText('Box height'), { target: { value: '130' } });
  fireEvent.blur(screen.getByLabelText('Box height'));
  expect(text).toBeTruthy();
  vi.mocked(prepareCarvingArt).mockResolvedValueOnce({
    ...candidate(),
    outline: [
      [
        { x: -130, y: -60 },
        { x: 130, y: -60 },
        { x: 130, y: 60 },
        { x: -130, y: 60 },
      ],
    ],
    width: 260,
    height: 120,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  await screen.findByText(/overlaps another item/);
  expect(applyButton().disabled).toBe(true);
});

it('ignores a provider response delivered after Stop', async () => {
  let finish!: (value: Awaited<ReturnType<typeof generateCarvingAsset>>) => void;
  vi.mocked(generateCarvingAsset).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      })
  );
  const { onApply } = await open();
  describe();
  variants(1);
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
  await act(async () => finish({ asset, usage: createAssistantUsage() }));
  expect(vi.mocked(generateCarvingAsset).mock.calls[0][0].signal.aborted).toBe(true);
  expect(prepareCarvingArt).not.toHaveBeenCalled();
  expect(onApply).not.toHaveBeenCalled();
  expect(screen.queryByRole('listbox', { name: 'Artwork variants' })).toBeNull();
});

it('prepares again for an edited job and reports an Apply refusal without changing anything', async () => {
  const { job, onApply, rerender } = await open();
  describe();
  variants(1);
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  await ready();
  const changed = { ...job, boards: [{ ...job.boards![0], thickness: 24 }] };
  rerender(<Harness job={changed} selectedId={null} onApply={onApply} />);
  expect(applyButton().disabled).toBe(true);
  await waitFor(() => expect(prepareCarvingArt).toHaveBeenCalledTimes(2));
  expect(vi.mocked(prepareCarvingArt).mock.calls[1][0].board.thickness).toBe(24);
  await waitFor(() => expect(applyButton().disabled).toBe(false));
  onApply.mockImplementationOnce(() => {
    throw new Error('The carving changed.');
  });
  fireEvent.click(applyButton());
  expect((await screen.findByRole('alert')).textContent).toBe('The carving changed.');
});

it('drops a preparation that finishes after the job changed', async () => {
  let finish!: (value: PreparedCarvingArt) => void;
  vi.mocked(prepareCarvingArt).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      })
  );
  vi.mocked(prepareCarvingArt).mockImplementation(() => new Promise(() => {}));
  const { job, onApply, rerender } = await open();
  describe();
  variants(1);
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  await waitFor(() => expect(prepareCarvingArt).toHaveBeenCalledTimes(1));
  rerender(<Harness job={{ ...job, carving: { ...job.carving!, maxDepth: 1 } }} selectedId={null} onApply={onApply} />);
  await act(async () => finish(candidate()));
  expect(screen.queryByText(/^Ready ·/)).toBeNull();
  expect(screen.queryByRole('img', { name: 'Proposed artwork on the board' })).toBeNull();
});

it('does not generate on IME Enter and redacts provider errors', async () => {
  await open();
  describe();
  variants(1);
  fireEvent.keyDown(screen.getByLabelText('What should it show?'), { key: 'Enter', isComposing: true });
  expect(generateCarvingAsset).not.toHaveBeenCalled();
  vi.mocked(generateCarvingAsset).mockRejectedValueOnce(new Error('Provider rejected recorded-key'));
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Provider rejected [key removed]');
});

it('reopens saved artwork at its current size for a local recheck and replaces it in place', async () => {
  const job = await createCarvingJob(undefined, { lettering: 'Welcome' });
  const item = job.carving!.items[0];
  item.height = 15;
  item.generated = {
    assetId: asset.id,
    sourceSvg: asset.svg,
    prompt: asset.prompt,
    summary: asset.summary,
    detail: 'simple',
    width: 40,
    height: 30,
    checkedFor: 'old-settings',
  };
  rememberAssistantCredentials(null);
  const { onApply } = await open({ job, selectedId: item.id });
  expect(screen.getByLabelText('What should it show?')).toHaveProperty('value', asset.prompt);
  expect(screen.getByRole('checkbox', { name: /^Replace/ })).toHaveProperty('checked', true);
  await ready();
  expect(generateCarvingAsset).not.toHaveBeenCalled();
  expect(prepareCarvingArt).toHaveBeenCalledWith(
    expect.objectContaining({
      art: { kind: 'svg', svg: asset.svg, fileName: 'Assistant artwork.svg' },
      detail: 'simple',
      width: 20,
      height: 15,
    })
  );
  fireEvent.click(applyButton());
  expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ mode: 'replace', item: expect.objectContaining({ id: item.id }) }));
});

it('uses a separately configured native image key and endpoint, never the design key', async () => {
  await open();
  describe();
  variants(1);
  fireEvent.click(screen.getByText('Advanced'));
  fireEvent.click(screen.getByRole('radio', { name: 'Image generation' }));
  // An Anthropic connection has no image model, so a separate provider is the way to images.
  expect(screen.getByText(/Your connection has no image model/)).toBeDefined();
  expect(screen.getByRole('button', { name: 'Generate' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Use a different image provider' }));
  expect(screen.getByLabelText('Image generator API key')).toHaveProperty('value', '');
  expect(screen.getByRole('button', { name: 'Generate' })).toHaveProperty('disabled', true);
  fireEvent.change(screen.getByLabelText('Image generator API address'), { target: { value: 'https://native.example/v1' } });
  fireEvent.change(screen.getByLabelText('Image generator model ID'), { target: { value: 'native-svg-model' } });
  fireEvent.change(screen.getByLabelText('Image generator API key'), { target: { value: 'separate-native-secret' } });
  fireEvent.change(screen.getByLabelText('Image output'), { target: { value: 'svg' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'My model and project support this image output.' }));
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  await waitFor(() => expect(generateNativeSvgAsset).toHaveBeenCalledTimes(1));
  const [options, native] = vi.mocked(generateNativeSvgAsset).mock.calls[0];
  expect(options.credentials).toMatchObject({
    key: 'separate-native-secret',
    config: { endpoint: 'https://native.example/v1', model: 'native-svg-model', kind: 'compatible' },
  });
  expect(native).toMatchObject({ endpoint: 'https://native.example/v1', quality: 'low' });
  expect(options.previous).toBeUndefined();
  expect(generateCarvingAsset).not.toHaveBeenCalled();
  expect(Object.values(localStorage).some(value => String(value).includes('separate-native-secret'))).toBe(false);
});

it("generates images with the connection's own key and image model, without a second form", async () => {
  rememberAssistantCredentials({
    key: 'sk-openai-test',
    config: {
      kind: 'compatible',
      protocol: 'responses',
      endpoint: 'https://api.openai.com/v1',
      model: 'gpt-x',
      imageModel: 'gpt-image-x',
      tools: true,
      images: true,
    },
  });
  await open();
  describe();
  variants(1);
  fireEvent.click(screen.getByText('Advanced'));
  expect(screen.getByRole('radio', { name: 'Image model · gpt-image-x' })).toHaveProperty('checked', true);
  expect(screen.queryByLabelText('Image generator API key')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  await waitFor(() => expect(generateNativeRasterAsset).toHaveBeenCalledTimes(1));
  const [options, native] = vi.mocked(generateNativeRasterAsset).mock.calls[0];
  expect(native).toMatchObject({ endpoint: 'https://api.openai.com/v1', model: 'gpt-image-x', key: 'sk-openai-test', format: 'png' });
  expect(options.credentials.key).toBe('sk-openai-test');
  expect(generateCarvingAsset).not.toHaveBeenCalled();
});

it('asks one variant at a time when a spending limit is set', async () => {
  let running = 0,
    most = 0;
  vi.mocked(generateCarvingAsset).mockImplementation(async () => {
    most = Math.max(most, ++running);
    await new Promise(resolve => setTimeout(resolve, 10));
    running--;
    return { asset: { ...asset, id: crypto.randomUUID() }, usage: createAssistantUsage() };
  });
  await open();
  describe();
  variants(2);
  fireEvent.click(screen.getByText('Advanced'));
  fireEvent.click(screen.getByText('Usage and limits'));
  fireEvent.change(screen.getByLabelText('USD limit (optional)'), { target: { value: '0.5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  await waitFor(() => expect(generateCarvingAsset).toHaveBeenCalledTimes(2));
  await ready();
  expect(most).toBe(1);
});

function pngFile() {
  const canvas = document.createElement('canvas');
  canvas.width = 20;
  canvas.height = 20;
  const context = canvas.getContext('2d')!;
  context.fillStyle = 'white';
  context.fillRect(0, 0, 20, 20);
  context.fillStyle = 'black';
  context.fillRect(5, 4, 10, 12);
  context.fillStyle = 'white';
  context.fillRect(7, 6, 2, 2);
  context.fillRect(11, 6, 2, 2);
  const dataUri = canvas.toDataURL('image/png');
  const bytes = Uint8Array.from(atob(dataUri.split(',')[1]), char => char.charCodeAt(0));
  return { file: new File([bytes], 'tiny-owl.png', { type: 'image/png' }), dataUri };
}

it('traces a local PNG without a provider, keeps its original and prepares it at the box', async () => {
  rememberAssistantCredentials(null);
  const { onApply } = await open();
  const { file, dataUri } = pngFile();
  fireEvent.change(screen.getByLabelText('PNG image to trace'), { target: { files: [file] } });
  await ready();
  expect(screen.getByLabelText('What should it show?')).toHaveProperty('value', 'Line art from tiny-owl');
  expect(prepareCarvingArt).toHaveBeenCalledTimes(1);
  expect(vi.mocked(prepareCarvingArt).mock.calls[0][0].sourceOutline).toBeDefined();
  fireEvent.click(applyButton());
  expect(onApply.mock.calls[0][0].item.generated).toMatchObject({
    sourceRaster: { dataUri, width: 20, height: 20 },
    prompt: 'Line art from tiny-owl',
  });
  expect(generateCarvingAsset).not.toHaveBeenCalled();
  expect(generateNativeRasterAsset).not.toHaveBeenCalled();
});

it('rejects an oversized PNG before preparing anything', async () => {
  const { onApply } = await open();
  const file = new File([new Uint8Array(2_000_001)], 'large.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('PNG image to trace'), { target: { files: [file] } });
  expect((await screen.findByRole('alert')).textContent).toMatch(/no larger than 2 MB/);
  expect(prepareCarvingArt).not.toHaveBeenCalled();
  expect(onApply).not.toHaveBeenCalled();
});
