import { describe, expect, it, vi } from 'vitest';
import type { AssistantMessage, ProviderRequest } from '@/cad/assistant/provider';
import { createAssistantUsage } from '@/cad/assistant/runBudget';
import { generateCarvingAsset, type CarvingGenerationOptions } from './generation';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 10H90V90H10Z"/></svg>';
const response = (): AssistantMessage => ({
  role: 'assistant',
  text: '',
  completion: 'complete',
  calls: [{ id: 'art', name: 'submit_carving_svg', arguments: { svg, title: 'Reading owl', summary: 'An owl holding an open book.' } }],
  usage: { inputTokens: 100, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
});
const options = (extra: Partial<CarvingGenerationOptions> = {}): CarvingGenerationOptions => ({
  prompt: 'An owl reading a book',
  constraints: { widthMm: 100, heightMm: 80, detail: 'balanced', minFeatureMm: 0.8 },
  credentials: {
    config: { kind: 'compatible', endpoint: 'https://example.test', model: 'chosen-model', protocol: 'chat', tools: true, images: false },
    key: 'private-key',
  },
  signal: new AbortController().signal,
  request: vi.fn(async () => response()),
  ...extra,
});

describe('carving artwork generation', () => {
  it('uses one bounded tool request and keeps generated source outside conversation history', async () => {
    const request = vi.fn(async (_request: ProviderRequest) => response());
    const result = await generateCarvingAsset(options({ request, pricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 2 } }));
    expect(request).toHaveBeenCalledTimes(1);
    const input = request.mock.calls[0][0];
    expect(input.messages).toHaveLength(1);
    expect(JSON.parse(input.messages[0].text)).toMatchObject({
      brief: 'An owl reading a book',
      constraints: { widthMm: 100, minFeatureMm: 0.8 },
    });
    expect(input.maxOutputTokens).toBe(8192);
    expect(input.timeoutMs).toBe(90_000);
    expect(input.tools.map(tool => tool.name)).toEqual(['submit_carving_svg']);
    expect(result.asset).toMatchObject({ svg, title: 'Reading owl', prompt: 'An owl reading a book' });
    expect(result.asset.id).toBeTruthy();
    expect(result).not.toHaveProperty('messages');
    expect(result.usage).toMatchObject({ calls: 1, inputTokens: 100, outputTokens: 200, costUsd: 0.0005 });
  });

  it('revises only the explicit previous asset and preserves the requested physical envelope', async () => {
    const request = vi.fn(async (_request: ProviderRequest) => response());
    await generateCarvingAsset(options({ request, previous: { id: 'owl-source', svg, prompt: 'An owl' } }));
    expect(JSON.parse(request.mock.calls[0][0].messages[0].text)).toEqual({
      brief: 'An owl reading a book',
      constraints: { widthMm: 100, heightMm: 80, detail: 'balanced', minFeatureMm: 0.8 },
      previous: { id: 'owl-source', svg, prompt: 'An owl' },
    });
  });

  it('does not serialize raster preview bytes or unrelated asset provenance into a text revision', async () => {
    const request = vi.fn(async (_request: ProviderRequest) => response());
    const previous = {
      id: 'raster-source',
      svg,
      prompt: 'Mouse',
      rasterPreview: { dataUri: 'data:image/png;base64,' + 'a'.repeat(100_000) },
      summary: 'Local display only',
    };
    await generateCarvingAsset(options({ request, previous }));
    const sent = request.mock.calls[0][0].messages[0].text;
    expect(JSON.parse(sent).previous).toEqual({ id: 'raster-source', svg, prompt: 'Mouse' });
    expect(sent).not.toContain('data:image/png');
    expect(sent.length).toBeLessThan(2000);
  });

  it('counts an unusable response before refusing it and does not automatically retry', async () => {
    const usage = createAssistantUsage();
    const onUsage = vi.fn();
    const request = vi.fn(async () => ({ ...response(), completion: 'incomplete' as const }));
    await expect(generateCarvingAsset(options({ usage, onUsage, request }))).rejects.toThrow('truncated');
    expect(usage).toMatchObject({ calls: 1, outputTokens: 200 });
    expect(onUsage).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
  });

  it('stops at the shared budget and refuses unknown billed usage on a capped continuation', async () => {
    const usage = createAssistantUsage();
    const request = vi.fn(async () => response());
    usage.outputTokens = 1000;
    await expect(generateCarvingAsset(options({ request, usage, limits: { maxTotalTokens: 1000 } }))).rejects.toThrow('budget');
    usage.outputTokens = null;
    await expect(generateCarvingAsset(options({ request, usage, limits: { maxTotalTokens: 1000 } }))).rejects.toThrow('unknown');
    expect(request).not.toHaveBeenCalled();
  });

  it('does not publish a late answer after cancellation', async () => {
    const abort = new AbortController();
    const usage = createAssistantUsage();
    const request = vi.fn(async () => {
      abort.abort();
      return response();
    });
    await expect(generateCarvingAsset(options({ request, usage, signal: abort.signal }))).rejects.toMatchObject({ name: 'AbortError' });
    expect(usage.calls).toBe(1);
    request.mockClear();
    await expect(generateCarvingAsset(options({ request, signal: abort.signal }))).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).not.toHaveBeenCalled();
  });

  it('marks failed or stopped request accounting unknown and refuses a dollar-capped retry', async () => {
    const usage = createAssistantUsage();
    const onUsage = vi.fn();
    const pricing = { inputUsdPerMillion: 1, outputUsdPerMillion: 2 };
    const request = vi.fn(async () => {
      throw new DOMException('Stopped', 'AbortError');
    });
    await expect(generateCarvingAsset(options({ usage, pricing, onUsage, request, limits: { maxCostUsd: 1 } }))).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(usage).toMatchObject({ calls: 1, inputTokens: null, outputTokens: null, costUsd: null });
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ calls: 1, costUsd: null }));
    await expect(generateCarvingAsset(options({ usage, pricing, request, limits: { maxCostUsd: 1 } }))).rejects.toThrow('unknown');
    expect(request).toHaveBeenCalledOnce();
  });

  it('never persists a key echoed by a compatible endpoint into artwork metadata', async () => {
    const answer = response();
    answer.calls![0].arguments.summary = 'private-key';
    const usage = createAssistantUsage();
    await expect(generateCarvingAsset(options({ usage, request: vi.fn(async () => answer) }))).rejects.toThrow('credential data');
    expect(usage.calls).toBe(1);
  });

  it.each([
    { calls: [] },
    { calls: [{ id: 'bad', name: 'submit_carving_svg', arguments: { svg: 'x'.repeat(48_001), title: 'Owl', summary: 'Owl' } }] },
    { calls: [{ id: 'bad', name: 'submit_carving_svg', arguments: { svg, title: '', summary: 'Owl' } }] },
    { completion: 'refused' as const },
  ])('refuses unsupported or oversized provider answers', async extra => {
    const request = vi.fn(async () => ({ ...response(), ...extra }));
    await expect(generateCarvingAsset(options({ request }))).rejects.toThrow();
  });

  it('caps model-written SVG at 48,000 characters but lets a local trace use the sanitizer limit', async () => {
    const large = svg.replace('H90V90H10Z', 'H90V90H10Z' + 'L10 10'.repeat(12_000));
    const answer = () => {
      const result = response();
      result.calls![0].arguments.svg = large;
      return result;
    };
    await expect(generateCarvingAsset(options({ request: vi.fn(async () => answer()) }))).rejects.toThrow(
      'The provider returned oversized artwork'
    );
    const traced = await generateCarvingAsset(options({ request: vi.fn(async () => answer()), locallyTraced: true }));
    expect(traced.asset.svg).toBe(large);
    const huge = svg.replace('H90V90H10Z', 'H90V90H10Z' + 'L10 10'.repeat(20_000));
    const tooLarge = response();
    tooLarge.calls![0].arguments.svg = huge;
    await expect(generateCarvingAsset(options({ request: vi.fn(async () => tooLarge), locallyTraced: true }))).rejects.toThrow(
      'traced artwork is too large'
    );
  });

  it('rejects invalid local constraints before any provider call', async () => {
    const request = vi.fn(async () => response());
    await expect(
      generateCarvingAsset(options({ request, constraints: { widthMm: 20, heightMm: 20, detail: 'simple', minFeatureMm: 20 } }))
    ).rejects.toThrow('minimum feature');
    await expect(generateCarvingAsset(options({ request, limits: { maxInputCharacters: 10 } }))).rejects.toThrow('input budget');
    expect(request).not.toHaveBeenCalled();
  });
});
