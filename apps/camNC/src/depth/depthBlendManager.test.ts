import type { RemapStepParams } from '@/depth/remapPipeline';
import type { DepthFrameResult, VideoPipelineWorkerAPI } from '@/depth/videoPipeline.worker';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DepthBlendManager, type DepthBlendTextures } from './depthBlendManager';

function deferred() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const makeParams = (width = 4) => ({ outputSize: [width, 4] }) as unknown as RemapStepParams;

/** A manager on a fake worker that records every call as `name` or `name:argument`. */
function setup() {
  const calls: string[] = [];
  const streams = new Map<object, string>();
  let frameCallback: ((result: DepthFrameResult) => void) | null = null;
  // Each test may replace this to hold back or fail init.
  const init = { result: (): Promise<void> => Promise.resolve() };
  // Likewise for a settings update.
  const settingsUpdate = { result: (): Promise<void> => Promise.resolve() };
  const proxy: VideoPipelineWorkerAPI = {
    init: async (stream, cfg) => {
      const width = cfg.mode === 'none' ? 0 : cfg.params.outputSize[0];
      calls.push(`init:${streams.get(stream)}:${width}`);
      await init.result();
    },
    start: async cb => {
      calls.push('start');
      frameCallback = cb;
    },
    stop: async () => {
      calls.push('stop');
    },
    updateParams: async params => {
      calls.push(`updateParams:${params.outputSize[0]}`);
    },
    updateSettings: async settings => {
      calls.push(`updateSettings:${settings.frameRateLimit}`);
      await settingsUpdate.result();
    },
    replaceStream: async stream => {
      calls.push(`replaceStream:${streams.get(stream)}`);
    },
  };
  const connect = vi.fn(() => ({ proxy, terminate: () => calls.push('terminate') }));
  const manager = new DepthBlendManager({
    connect,
    createStream: async source => {
      const stream = new ReadableStream<VideoFrame>();
      streams.set(stream, String(source));
      return stream;
    },
  });
  /** A frame result, built ahead so that sending it needs no await. */
  const makeFrame = async (): Promise<DepthFrameResult> => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    canvas.getContext('2d')!.fillRect(0, 0, 2, 2);
    return { mask: await createImageBitmap(canvas), bg: await createImageBitmap(canvas) };
  };
  const sendFrame = (frame: DepthFrameResult) => frameCallback!(frame);
  return { manager, calls, init, settingsUpdate, connect, makeFrame, sendFrame };
}

describe('DepthBlendManager', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates nothing until a start that is still wanted', async () => {
    const { manager, calls, connect } = setup();
    manager.configure({ source: 'cam', params: makeParams(), settings: { frameRateLimit: 2 } });
    await manager.stop();
    // A start withdrawn before the worker was reached creates nothing either.
    await Promise.all([manager.start(), manager.stop()]);
    expect(connect).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('initialises once for concurrent starts', async () => {
    const { manager, calls, connect } = setup();
    manager.configure({ source: 'cam', params: makeParams() });
    await Promise.all([manager.start(), manager.start()]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['init:cam:4', 'start']);
  });

  it('applies settings given before start, between init and start', async () => {
    const { manager, calls } = setup();
    manager.configure({ source: 'cam', params: makeParams(), settings: { frameRateLimit: 2 } });
    await manager.start();
    expect(calls).toEqual(['init:cam:4', 'updateSettings:2', 'start']);
  });

  it('does not start the worker when stopped during init', async () => {
    const { manager, calls, init } = setup();
    const pending = deferred();
    init.result = () => pending.promise;
    manager.configure({ source: 'cam', params: makeParams() });
    const started = manager.start();
    await vi.waitFor(() => expect(calls).toEqual(['init:cam:4']));
    const stopped = manager.stop();
    pending.resolve();
    await Promise.all([started, stopped]);
    expect(calls).toEqual(['init:cam:4']);
  });

  it('pushes a source, parameters and settings that change during init', async () => {
    const { manager, calls, init } = setup();
    const pending = deferred();
    init.result = () => pending.promise;
    manager.configure({ source: 'cam', params: makeParams() });
    const started = manager.start();
    await vi.waitFor(() => expect(calls).toEqual(['init:cam:4']));
    manager.configure({ source: 'other', params: makeParams(8), settings: { frameRateLimit: 3 } });
    pending.resolve();
    await started;
    expect(calls).toEqual(['init:cam:4', 'replaceStream:other', 'updateParams:8', 'updateSettings:3', 'start']);
  });

  it('pushes only the parts whose reference changed', async () => {
    const { manager, calls } = setup();
    const params = makeParams();
    const settings = { frameRateLimit: 2 };
    manager.configure({ source: 'cam', params, settings });
    await manager.start();
    calls.length = 0;

    manager.configure({ source: 'cam', params, settings });
    await manager.start();
    expect(calls).toEqual([]);

    manager.configure({ params: makeParams(8) });
    await manager.start();
    expect(calls).toEqual(['updateParams:8']);
  });

  it('applies a change made while stopped on the next start', async () => {
    const { manager, calls } = setup();
    manager.configure({ source: 'cam', params: makeParams() });
    await manager.start();
    await manager.stop();
    manager.configure({ source: 'other' });
    await manager.stop();
    expect(calls).toEqual(['init:cam:4', 'start', 'stop']);
    await manager.start();
    expect(calls).toEqual(['init:cam:4', 'start', 'stop', 'replaceStream:other', 'start']);
  });

  it('rejects start when init fails and retries on a later start', async () => {
    const { manager, calls, init } = setup();
    init.result = () => Promise.reject(new Error('no WebGPU'));
    manager.configure({ source: 'cam', params: makeParams() });
    await expect(manager.start()).rejects.toThrow('no WebGPU');
    // The failed start withdrew its request: a configuration change does not retry by itself.
    manager.configure({ settings: { frameRateLimit: 2 } });
    await manager.stop();
    expect(calls).toEqual(['init:cam:4']);

    init.result = () => Promise.resolve();
    await manager.start();
    expect(calls).toEqual(['init:cam:4', 'init:cam:4', 'updateSettings:2', 'start']);
  });

  it('tries init once per start, not once per change queued behind it', async () => {
    const { manager, calls, init, connect } = setup();
    const pending = deferred();
    init.result = () => pending.promise;
    manager.configure({ source: 'cam', params: makeParams() });
    const started = manager.start();
    await vi.waitFor(() => expect(calls).toEqual(['init:cam:4']));
    manager.configure({ settings: { frameRateLimit: 2 } });
    manager.configure({ params: makeParams(8) });
    pending.reject(new Error('no WebGPU'));
    await expect(started).rejects.toThrow('no WebGPU');
    await new Promise(resolve => setTimeout(resolve));
    expect(calls).toEqual(['init:cam:4']);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('keeps a start issued after the one that fails', async () => {
    const { manager, calls, init } = setup();
    const pending = deferred();
    init.result = () => pending.promise;
    manager.configure({ source: 'cam', params: makeParams() });
    const first = manager.start();
    first.catch(() => {});
    await vi.waitFor(() => expect(calls).toEqual(['init:cam:4']));
    const stopped = manager.stop();
    const second = manager.start();
    init.result = () => Promise.resolve();
    pending.reject(new Error('no WebGPU'));
    await expect(first).rejects.toThrow('no WebGPU');
    await Promise.all([stopped, second]);
    expect(calls).toEqual(['init:cam:4', 'init:cam:4', 'start']);
  });

  it('rejects start without a source and parameters', async () => {
    const { manager, connect } = setup();
    await expect(manager.start()).rejects.toThrow('Cannot initialise without videoSource and params');
    expect(connect).not.toHaveBeenCalled();
  });

  it('starts the worker again after a stop', async () => {
    const { manager, calls } = setup();
    manager.configure({ source: 'cam', params: makeParams() });
    await manager.start();
    await manager.stop();
    await manager.start();
    expect(calls).toEqual(['init:cam:4', 'start', 'stop', 'start']);
  });

  it('logs a failing stop instead of rejecting', async () => {
    const { manager, connect } = setup();
    manager.configure({ source: 'cam', params: makeParams() });
    await manager.start();
    connect.mock.results[0]!.value.proxy.stop = () => Promise.reject(new Error('worker gone'));
    await expect(manager.stop()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('[DepthBlendManager] Failed to stop:', expect.any(Error));
  });

  it('delivers frames while running and drops them as soon as stop is called', async () => {
    const { manager, calls, settingsUpdate, makeFrame, sendFrame } = setup();
    const received: DepthBlendTextures[] = [];
    manager.onTextures(textures => received.push(textures));
    manager.configure({ source: 'cam', params: makeParams() });
    await manager.start();
    sendFrame(await makeFrame());
    expect(received).toHaveLength(1);
    expect(received[0]!.mask).not.toBeNull();

    // A settings update is still in flight when the store disables depth blending without awaiting.
    const late = await makeFrame();
    const pending = deferred();
    settingsUpdate.result = () => pending.promise;
    manager.configure({ settings: { frameRateLimit: 3 } });
    await vi.waitFor(() => expect(calls).toContain('updateSettings:3'));
    void manager.stop();
    expect(calls.at(-1)).toBe('stop');
    sendFrame(late);
    expect(received).toHaveLength(1);
    pending.resolve();
  });

  it('logs a failing update once without failing start', async () => {
    const { manager, connect } = setup();
    manager.configure({ source: 'cam', params: makeParams() });
    await manager.start();
    const updateParams = vi.fn(() => Promise.reject(new Error('worker busy')));
    connect.mock.results[0]!.value.proxy.updateParams = updateParams;
    manager.configure({ params: makeParams(8) });
    await expect(manager.start()).resolves.toBeUndefined();
    await manager.start();
    expect(updateParams).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith('[DepthBlendManager] Failed to update params:', expect.any(Error));
  });

  it('terminates the worker on destroy and connects a new one on the next start', async () => {
    const { manager, calls, connect, makeFrame, sendFrame } = setup();
    const received: DepthBlendTextures[] = [];
    manager.onTextures(textures => received.push(textures));
    manager.configure({ source: 'cam', params: makeParams() });
    await manager.start();
    manager.destroy();
    sendFrame(await makeFrame());
    expect(received).toEqual([]);
    expect(calls).toEqual(['init:cam:4', 'start', 'terminate']);
    await manager.start();
    expect(connect).toHaveBeenCalledTimes(2);
    expect(calls).toEqual(['init:cam:4', 'start', 'terminate', 'init:cam:4', 'start']);
  });
});
