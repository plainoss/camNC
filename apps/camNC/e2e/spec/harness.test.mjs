import { describe, expect, it, vi } from 'vitest';
import { keepResourceEntries, openPage } from './harness.mjs';

describe('spec pages', () => {
  it('keep every resource entry, so adapters still find the app modules a long dev-server load fetched last', async () => {
    const scripts = [];
    const page = { setDefaultTimeout: vi.fn(), on: vi.fn() };
    const context = { addInitScript: vi.fn(async script => scripts.push(script)), newPage: vi.fn(async () => page) };
    await openPage({ newContext: vi.fn(async () => context) });
    expect(scripts).toEqual([keepResourceEntries]);
    expect(context.addInitScript.mock.invocationCallOrder[0]).toBeLessThan(context.newPage.mock.invocationCallOrder[0]);
    const setResourceTimingBufferSize = vi.fn();
    vi.stubGlobal('performance', { setResourceTimingBufferSize });
    try {
      keepResourceEntries();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(setResourceTimingBufferSize.mock.calls[0][0]).toBeGreaterThan(250);
  });
});
