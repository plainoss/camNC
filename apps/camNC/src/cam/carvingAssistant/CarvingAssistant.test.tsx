import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCarvingJob } from '../jobDb';
import { defaultProvider, rememberAssistantCredentials } from '../../cad/assistant/keyStore';
import { createAssistantUsage } from '../../cad/assistant/runBudget';
import { CarvingAssistant } from './CarvingAssistant';
import { generateCarvingAsset } from './generation';
import { prepareCarvingArt, type PreparedCarvingArt } from './prepare';
import { generateNativeSvgAsset } from './nativeSvg';
import { generateNativeRasterAsset } from './nativeRaster';

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

async function open() {
  const job = await createCarvingJob();
  const onApply = vi.fn();
  const view = render(<CarvingAssistant job={job} selectedId={job.carving!.items[0].id} onApply={onApply} />);
  fireEvent.change(screen.getByLabelText('Artwork description'), { target: { value: asset.prompt } });
  return { job, onApply, ...view };
}
async function generate() {
  fireEvent.click(screen.getByRole('button', { name: 'Generate artwork' }));
  await screen.findByRole('img', { name: 'Prepared carving artwork' });
}

it('makes one candidate with the saved tool context and applies only after review', async () => {
  const { job, onApply } = await open();
  await generate();
  expect(generateCarvingAsset).toHaveBeenCalledTimes(1);
  expect(prepareCarvingArt).toHaveBeenCalledWith(
    expect.objectContaining({
      carving: job.carving,
      board: job.boards![0],
      width: 100,
      height: job.carving!.items[0].height,
      detail: 'balanced',
    })
  );
  expect(onApply).not.toHaveBeenCalled();
  expect(screen.getByRole('img', { name: 'Prepared carving artwork' }).querySelector('path')?.getAttribute('d')).toContain('M-20,15');
  fireEvent.click(screen.getByRole('button', { name: 'Apply artwork' }));
  expect(onApply).toHaveBeenCalledTimes(1);
  expect(job.carving!.items).toHaveLength(1);
});

it('invalidates size edits, prepares them locally, and preserves the source for a later refinement', async () => {
  await open();
  await generate();
  fireEvent.change(screen.getByLabelText('Maximum height (mm)'), { target: { value: '60' } });
  expect(screen.getByRole('button', { name: 'Apply artwork' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Update preview locally' }));
  await waitFor(() => expect(prepareCarvingArt).toHaveBeenCalledTimes(2));
  expect(generateCarvingAsset).toHaveBeenCalledTimes(1);
  expect(vi.mocked(prepareCarvingArt).mock.calls[1][0]).toMatchObject({ height: 60, art: { svg: asset.svg } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Apply artwork' })).toHaveProperty('disabled', false));
  fireEvent.change(screen.getByLabelText('Artwork description'), { target: { value: 'The owl with larger eyes' } });
  expect(screen.getByRole('button', { name: 'Update preview locally' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Generate revised artwork' }));
  await waitFor(() => expect(generateCarvingAsset).toHaveBeenCalledTimes(2));
  expect(vi.mocked(generateCarvingAsset).mock.calls[1][0]).toMatchObject({ previous: asset, prompt: 'The owl with larger eyes' });
});

it('requires review of detail warnings and refuses candidates with preparation errors', async () => {
  vi.mocked(prepareCarvingArt).mockResolvedValueOnce({
    ...candidate(),
    report: { ...candidate().report, warnings: ['Small eye detail needs review.'] },
  });
  const { onApply } = await open();
  await generate();
  const apply = screen.getByRole('button', { name: 'Apply artwork' });
  expect(apply).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'I have reviewed these detail warnings.' }));
  expect(apply).toHaveProperty('disabled', false);
  fireEvent.click(screen.getByRole('button', { name: 'Discard preview' }));
  expect(onApply).not.toHaveBeenCalled();
  vi.mocked(prepareCarvingArt).mockResolvedValueOnce({
    ...candidate(),
    report: { ...candidate().report, ok: false, errors: ['No usable cut remains.'] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Generate revised artwork' }));
  await screen.findByText('No usable cut remains.');
  expect(screen.getByRole('button', { name: 'Apply artwork' })).toHaveProperty('disabled', true);
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
  fireEvent.click(screen.getByRole('button', { name: 'Generate artwork' }));
  await screen.findByRole('button', { name: 'Stop' });
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  await act(async () => finish({ asset, usage: createAssistantUsage() }));
  expect(vi.mocked(generateCarvingAsset).mock.calls[0][0].signal.aborted).toBe(true);
  expect(prepareCarvingArt).not.toHaveBeenCalled();
  expect(onApply).not.toHaveBeenCalled();
  expect(screen.queryByRole('img', { name: 'Prepared carving artwork' })).toBeNull();
});

it('invalidates preview when the board changes and presents apply refusal without mutating anything', async () => {
  const { job, onApply, rerender } = await open();
  await generate();
  const changed = { ...job, boards: [{ ...job.boards![0], thickness: 24 }] };
  rerender(<CarvingAssistant job={changed} onApply={onApply} />);
  expect(screen.getByRole('button', { name: 'Apply artwork' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Update preview locally' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Apply artwork' })).toHaveProperty('disabled', false));
  onApply.mockImplementationOnce(() => {
    throw new Error('The carving changed.');
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply artwork' }));
  expect((await screen.findByRole('alert')).textContent).toBe('The carving changed.');
});

it('does not generate on IME Enter and redacts provider errors', async () => {
  await open();
  fireEvent.keyDown(screen.getByLabelText('Artwork description'), { key: 'Enter', isComposing: true });
  expect(generateCarvingAsset).not.toHaveBeenCalled();
  vi.mocked(generateCarvingAsset).mockRejectedValueOnce(new Error('Provider rejected recorded-key'));
  fireEvent.click(screen.getByRole('button', { name: 'Generate artwork' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Provider rejected [key removed]');
});

it('reopens saved original artwork for local rechecking without a provider connection', async () => {
  const job = await createCarvingJob();
  const item = job.carving!.items[0];
  item.height = 30;
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
  const onApply = vi.fn();
  render(<CarvingAssistant job={job} selectedId={item.id} onApply={onApply} />);
  expect(screen.getByLabelText('Artwork description')).toHaveProperty('value', asset.prompt);
  expect(screen.getByLabelText('Placement')).toHaveProperty('value', 'replace');
  fireEvent.click(screen.getByRole('button', { name: 'Update preview locally' }));
  await screen.findByRole('img', { name: 'Prepared carving artwork' });
  expect(generateCarvingAsset).not.toHaveBeenCalled();
  expect(prepareCarvingArt).toHaveBeenCalledWith(
    expect.objectContaining({
      art: { kind: 'svg', svg: asset.svg, fileName: 'Assistant artwork.svg' },
      detail: 'simple',
      width: 40,
      height: 30,
    })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Apply artwork' }));
  expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ mode: 'replace', item: expect.objectContaining({ id: item.id }) }));
});

it('drops a pending local preparation after the job changes', async () => {
  let finish!: (value: PreparedCarvingArt) => void;
  vi.mocked(prepareCarvingArt).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      })
  );
  const { job, onApply, rerender } = await open();
  fireEvent.click(screen.getByRole('button', { name: 'Generate artwork' }));
  await waitFor(() => expect(prepareCarvingArt).toHaveBeenCalledTimes(1));
  rerender(<CarvingAssistant job={{ ...job, carving: { ...job.carving!, maxDepth: 1 } }} onApply={onApply} />);
  await act(async () => finish(candidate()));
  expect(screen.queryByRole('img', { name: 'Prepared carving artwork' })).toBeNull();
  expect(onApply).not.toHaveBeenCalled();
});

it('uses an explicitly configured separate native key and endpoint without a revision source', async () => {
  await open();
  await generate();
  fireEvent.click(screen.getByRole('radio', { name: 'Native image generation' }));
  expect(screen.getByLabelText('Image generator API key')).toHaveProperty('value', '');
  expect(screen.getByRole('button', { name: 'Generate new native artwork' })).toHaveProperty('disabled', true);
  fireEvent.change(screen.getByLabelText('Image generator API address'), { target: { value: 'https://native.example/v1' } });
  fireEvent.change(screen.getByLabelText('Image generator model ID'), { target: { value: 'native-svg-model' } });
  fireEvent.change(screen.getByLabelText('Image generator API key'), { target: { value: 'separate-native-secret' } });
  fireEvent.change(screen.getByLabelText('Image output'), { target: { value: 'svg' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'My model and project support this image output.' }));
  vi.mocked(generateNativeSvgAsset).mockImplementationOnce(async options => {
    const usage = { ...createAssistantUsage(), calls: 1, inputTokens: null, outputTokens: null, costUsd: null };
    options.onUsage?.(usage);
    return { asset, usage };
  });
  fireEvent.click(screen.getByRole('button', { name: 'Generate new native artwork' }));
  await waitFor(() => expect(generateNativeSvgAsset).toHaveBeenCalledTimes(1));
  const [options, native] = vi.mocked(generateNativeSvgAsset).mock.calls[0];
  expect(options.credentials).toMatchObject({
    key: 'separate-native-secret',
    config: { endpoint: 'https://native.example/v1', model: 'native-svg-model', kind: 'compatible' },
  });
  expect(native).toMatchObject({ endpoint: 'https://native.example/v1', quality: 'low' });
  expect(options.previous).toBeUndefined();
  expect(generateCarvingAsset).toHaveBeenCalledTimes(1);
  expect(Object.values(localStorage).some(value => String(value).includes('separate-native-secret'))).toBe(false);
  expect(screen.getByLabelText('Last turn usage').textContent).toContain('cost unknown');
});

it('rechecks manually scaled saved artwork at its current physical size', async () => {
  const job = await createCarvingJob();
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
  render(<CarvingAssistant job={job} selectedId={item.id} onApply={() => {}} />);
  expect(screen.getByLabelText('Maximum width (mm)')).toHaveProperty('value', '20');
  expect(screen.getByLabelText('Maximum height (mm)')).toHaveProperty('value', '15');
  fireEvent.click(screen.getByRole('button', { name: 'Update preview locally' }));
  await screen.findByRole('img', { name: 'Prepared carving artwork' });
  expect(prepareCarvingArt).toHaveBeenCalledWith(expect.objectContaining({ width: 20, height: 15 }));
  expect(generateCarvingAsset).not.toHaveBeenCalled();
});

it('uses the raster generation route and requires review of tracing losses', async () => {
  await open();
  fireEvent.click(screen.getByRole('radio', { name: 'Native image generation' }));
  fireEvent.change(screen.getByLabelText('Image generator model ID'), { target: { value: 'image-model' } });
  fireEvent.change(screen.getByLabelText('Image generator API key'), { target: { value: 'image-key' } });
  expect(screen.getByLabelText('Image output')).toHaveProperty('value', 'png');
  fireEvent.click(screen.getByRole('checkbox', { name: 'My model and project support this image output.' }));
  vi.mocked(generateNativeRasterAsset).mockResolvedValueOnce({
    asset: { ...asset, warnings: ['Tracing discarded grayscale shading.'], rasterPreview: rasterPreview() },
    usage: createAssistantUsage(),
  });
  fireEvent.click(screen.getByRole('button', { name: 'Generate new native artwork' }));
  await screen.findByRole('img', { name: 'Prepared carving artwork' });
  expect(generateNativeSvgAsset).not.toHaveBeenCalled();
  expect(generateNativeRasterAsset).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Tracing discarded grayscale shading.')).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Original generated artwork' }).getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  expect(screen.getByRole('button', { name: 'Apply artwork' })).toHaveProperty('disabled', true);
});

it('clears prior prepared paths if a later artwork fails preparation', async () => {
  await open();
  await generate();
  vi.mocked(prepareCarvingArt).mockRejectedValueOnce(new Error('Artwork is too complex.'));
  fireEvent.change(screen.getByLabelText('Artwork description'), { target: { value: 'A mouse playing ball' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate revised artwork' }));
  await screen.findByText('Artwork is too complex.');
  expect(screen.queryByRole('img', { name: 'Prepared carving artwork' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Apply artwork' })).toBeNull();
  expect(screen.getByRole('img', { name: 'Original generated artwork' })).toBeTruthy();
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

it('loads a real PNG locally, keeps its original source, and waits for explicit preparation and Apply', async () => {
  const { job, onApply } = await open();
  rememberAssistantCredentials(null);
  fireEvent.change(screen.getByLabelText('Artwork description'), { target: { value: '' } });
  const { file, dataUri } = pngFile();
  fireEvent.change(screen.getByLabelText('Generated PNG file'), { target: { files: [file] } });
  await screen.findByText('Image loaded; update preview locally.');
  expect(screen.getByLabelText('Artwork description')).toHaveProperty('value', 'Line art from tiny-owl');
  expect(screen.getByRole('img', { name: 'Original generated artwork' }).getAttribute('src')).toBe(dataUri);
  expect(prepareCarvingArt).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Apply artwork' })).toBeNull();
  expect(job.carving!.items).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Update preview locally' }));
  await screen.findByRole('img', { name: 'Prepared carving artwork' });
  expect(screen.getByRole('button', { name: 'Apply artwork' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'I have reviewed these detail warnings.' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply artwork' }));
  expect(onApply).toHaveBeenCalledTimes(1);
  expect(onApply.mock.calls[0][0].item.generated).toMatchObject({
    sourceRaster: { dataUri, width: 20, height: 20 },
    prompt: 'Line art from tiny-owl',
  });
  expect(generateCarvingAsset).not.toHaveBeenCalled();
  expect(generateNativeSvgAsset).not.toHaveBeenCalled();
  expect(generateNativeRasterAsset).not.toHaveBeenCalled();
});

it('rejects an oversized PNG before preparing or applying artwork', async () => {
  const { onApply } = await open();
  const file = new File([new Uint8Array(2_000_001)], 'large.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('Generated PNG file'), { target: { files: [file] } });
  expect((await screen.findByRole('alert')).textContent).toMatch(/no larger than 2 MB/);
  expect(prepareCarvingArt).not.toHaveBeenCalled();
  expect(onApply).not.toHaveBeenCalled();
  expect(screen.queryByRole('img', { name: 'Original generated artwork' })).toBeNull();
});

it('stops a pending PNG read and ignores its later completion', async () => {
  const { file } = pngFile();
  let finish!: (value: ArrayBuffer) => void;
  const original = await file.arrayBuffer();
  vi.spyOn(file, 'arrayBuffer').mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      })
  );
  const { onApply } = await open();
  fireEvent.change(screen.getByLabelText('Generated PNG file'), { target: { files: [file] } });
  await screen.findByRole('button', { name: 'Stop' });
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  await act(async () => finish(original));
  expect(screen.queryByRole('img', { name: 'Original generated artwork' })).toBeNull();
  expect(prepareCarvingArt).not.toHaveBeenCalled();
  expect(onApply).not.toHaveBeenCalled();
});

it('keeps a typed description when turning a local PNG into a reusable source asset', async () => {
  await open();
  const { file } = pngFile();
  fireEvent.change(screen.getByLabelText('Generated PNG file'), { target: { files: [file] } });
  await screen.findByText('Image loaded; update preview locally.');
  expect(screen.getByLabelText('Artwork description')).toHaveProperty('value', asset.prompt);
  expect(screen.getByRole('button', { name: 'Update preview locally' })).toHaveProperty('disabled', false);
  expect(generateCarvingAsset).not.toHaveBeenCalled();
});
