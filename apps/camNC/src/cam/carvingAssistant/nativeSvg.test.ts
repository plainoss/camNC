import { describe, expect, it, vi } from 'vitest';
import { generateNativeSvgAsset } from './nativeSvg';
import type { CarvingGenerationOptions } from './generation';

const svg = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>';
const native = { endpoint: 'https://example.test/v1', model: 'svg-enabled-model', key: 'separate-native-key', quality: 'medium' as const };
const options = (): CarvingGenerationOptions => ({
  prompt: 'Mouse playing with a ball',
  constraints: { widthMm: 80, heightMm: 80, detail: 'simple', minFeatureMm: 1 },
  credentials: {
    key: 'secret-test',
    config: { kind: 'compatible', endpoint: 'https://example.test', model: 'text-model', protocol: 'chat', tools: true, images: false },
  },
  signal: new AbortController().signal,
});

describe('optional native SVG generation', () => {
  it('requests exactly one native SVG and retains unknown combined image/author cost', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: btoa(svg) }] })));
    const result = await generateNativeSvgAsset(options(), native, fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.test/v1/images/generations');
    expect(JSON.parse(request.body as string)).toMatchObject({ model: native.model, output_format: 'svg', n: 1, quality: 'medium' });
    expect(request).toMatchObject({ credentials: 'omit', redirect: 'error' });
    expect(request.headers).toMatchObject({ authorization: 'Bearer separate-native-key' });
    expect(result.asset.svg).toBe(svg);
    expect(result.usage).toMatchObject({ calls: 1, inputTokens: null, outputTokens: null, costUsd: null });
  });

  it('refuses dollar caps rather than applying text-model prices to images', async () => {
    const fetcher = vi.fn();
    await expect(generateNativeSvgAsset({ ...options(), limits: { maxCostUsd: 1 } }, native, fetcher)).rejects.toThrow('unknown combined');
    await expect(generateNativeSvgAsset(options(), { ...native, endpoint: 'https://user:password@example.test' }, fetcher)).rejects.toThrow(
      'credentials'
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('explains that Gemini makes PNG only instead of sending an SVG request', async () => {
    const fetcher = vi.fn();
    await expect(
      generateNativeSvgAsset(options(), { ...native, endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai' }, fetcher)
    ).rejects.toThrow('PNG images only');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports unsupported responses without echoing provider content', async () => {
    const fetcher = vi.fn(async () => new Response('secret-provider-body', { status: 403 }));
    await expect(generateNativeSvgAsset(options(), native, fetcher)).rejects.toThrow('HTTP 403');
    const invalid = vi.fn(async () => new Response('{"data":[{"url":"https://example.test/art.svg"}]}'));
    await expect(generateNativeSvgAsset(options(), native, invalid)).rejects.toThrow('unsupported artwork');
  });

  it('bounds response bytes and the complete operation deadline', async () => {
    const huge = vi.fn(async () => new Response('x'.repeat(100_001)));
    await expect(generateNativeSvgAsset(options(), native, huge)).rejects.toThrow('response limit');
    const stalled = vi.fn(() => new Promise<Response>(() => {}));
    await expect(generateNativeSvgAsset({ ...options(), limits: { maxRequestMs: 10 } }, native, stalled)).rejects.toThrow('too long');
  });

  it('stops a pending native generation immediately', async () => {
    const abort = new AbortController();
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    const pending = generateNativeSvgAsset({ ...options(), signal: abort.signal }, native, fetcher);
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
