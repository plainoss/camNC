/** Browser-side helpers shared by the opt-in live assistant harnesses (see README.md). */
import { commands } from '@vitest/browser/context';
import type { ProviderConfig } from '@/cad/assistant/provider';
import type { AssistantPricing } from '@/cad/assistant/runBudget';
import type { LiveFetchRequest, LiveFetchResponse, LiveSpend } from './commands';
import { livePrice } from './prices';

declare module '@vitest/browser/context' {
  interface BrowserCommands {
    liveProviderFetch(request: LiveFetchRequest): Promise<LiveFetchResponse>;
    liveSave(relative: string, content: string): Promise<void>;
    liveRead(relative: string): Promise<string | null>;
    liveSpent(): Promise<LiveSpend>;
  }
}

declare const __LIVE_ENV__: Record<string, string | undefined> | undefined;
/** The harness's own non-secret settings, inlined by its Vitest config; empty under any other config. */
export const liveEnv: Record<string, string | undefined> = typeof __LIVE_ENV__ === 'undefined' ? {} : __LIVE_ENV__;

/**
 * Keys never enter the page. The app's request code needs a key, so it gets this placeholder; the Node-side
 * liveProviderFetch command ignores the page's headers and adds the real key from the environment.
 */
export const kLivePlaceholderKey = 'injected-server-side';

export function liveProvider(model: string): { config: ProviderConfig; pricing: AssistantPricing } {
  const price = livePrice(model);
  const config: ProviderConfig = model.startsWith('gemini')
    ? {
        kind: 'compatible',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model,
        protocol: 'chat',
        tools: true,
        images: false,
      }
    : { kind: 'compatible', endpoint: 'https://api.openai.com/v1', model, protocol: 'responses', tools: true, images: false };
  return { config, pricing: { inputUsdPerMillion: price.input, outputUsdPerMillion: price.output, cacheReadUsdPerMillion: price.cached } };
}

/** A `fetch` for requestAssistant that sends each provider call through the Node-side command. */
export function liveFetch(options: { tag?: string; extra?: Record<string, unknown>; onCost?: (usd: number) => void } = {}): typeof fetch {
  return async (input, init) => {
    const result = await commands.liveProviderFetch({
      url: String(input),
      body: String(init?.body),
      tag: options.tag,
      extra: options.extra,
    });
    options.onCost?.(result.costUsd);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } });
  };
}
