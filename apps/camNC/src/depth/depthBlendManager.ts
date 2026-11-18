import type { RemapStepParams } from '@/depth/remapPipeline';
import type { VideoPipelineWorkerAPI, WorkerSettings } from '@/depth/videoPipeline.worker';
import { createVideoStreamProcessor, registerThreeJsTransferHandlers } from '@wbcnc/video-worker-utils';
import * as Comlink from 'comlink';
import * as THREE from 'three';

registerThreeJsTransferHandlers();

export interface DepthBlendTextures {
  mask: THREE.CanvasTexture | null;
  bg: THREE.CanvasTexture | null;
}

type VideoSource = Parameters<typeof createVideoStreamProcessor>[0];
type VideoStream = Awaited<ReturnType<typeof createVideoStreamProcessor>>;

/** What the worker should be processing. The manager pushes whichever part differs from what the worker has. */
export interface DepthBlendConfig {
  source: VideoSource;
  params: RemapStepParams;
  settings: WorkerSettings;
}

export interface DepthBlendWorkerConnection {
  proxy: VideoPipelineWorkerAPI;
  terminate(): void;
}

export interface DepthBlendDeps {
  connect(): DepthBlendWorkerConnection;
  createStream(source: VideoSource): Promise<VideoStream>;
}

function connectWorker(): DepthBlendWorkerConnection {
  const worker = new Worker(new URL('./videoPipeline.worker.ts', import.meta.url), { type: 'module' });
  return {
    proxy: Comlink.wrap<VideoPipelineWorkerAPI>(worker) as unknown as VideoPipelineWorkerAPI,
    terminate: () => worker.terminate(),
  };
}

function transferStream(stream: VideoStream) {
  return Comlink.transfer(stream, [stream as unknown as Transferable]);
}

type Nullable<T> = { [K in keyof T]: T[K] | null };

/**
 * Owns the depth blend worker and the textures it produces.
 *
 * Callers state what they want (`configure`, `start`, `stop`); a single serialised `sync` brings the worker
 * to that state, so a change made while the worker is still initialising is pushed once it is ready.
 */
export class DepthBlendManager {
  private static instance: DepthBlendManager | null = null;

  private connection: DepthBlendWorkerConnection | null = null;
  private localStream: VideoStream | null = null;

  // Texture management
  private maskTex: THREE.CanvasTexture | null = null;
  // Previous mask, still sampled by the shader for cross-fading.
  private prevMaskTex: THREE.CanvasTexture | null = null;
  private bgTex: THREE.CanvasTexture | null = null;
  private bgCanvas: HTMLCanvasElement | null = null;
  private onTextureUpdate: ((textures: DepthBlendTextures) => void) | null = null;

  // Whether the caller wants processing to run.
  private wanted = false;
  // Counts start()/stop() calls, so a failed start() only withdraws its own request.
  private request = 0;
  private desired: Nullable<DepthBlendConfig> = { source: null, params: null, settings: null };
  // What the worker was last given; null until it is initialised.
  private applied: Nullable<DepthBlendConfig> | null = null;
  // Whether the worker loop was told to run; frames arriving while false are dropped.
  private running = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly deps: DepthBlendDeps = { connect: connectWorker, createStream: createVideoStreamProcessor }) {}

  static getInstance(): DepthBlendManager {
    if (typeof window === 'undefined') return null as unknown as DepthBlendManager;
    if (!DepthBlendManager.instance) {
      DepthBlendManager.instance = new DepthBlendManager();
    }
    return DepthBlendManager.instance;
  }

  // Register a callback for texture updates. Returns an unsubscribe function.
  onTextures(cb: (textures: DepthBlendTextures) => void) {
    this.onTextureUpdate = cb;
    // If textures already exist, send them immediately so the consumer
    // doesn't have to wait for the next frame before seeing something.
    if (this.maskTex && this.bgTex) {
      cb({ mask: this.maskTex, bg: this.bgTex });
    }
    return () => {
      if (this.onTextureUpdate === cb) this.onTextureUpdate = null;
    };
  }

  /** Set the video source, remap parameters and/or runtime settings. Changes are detected by reference. */
  configure(config: Partial<DepthBlendConfig>) {
    Object.assign(this.desired, config);
    this.sync().catch(err => console.error('[DepthBlendManager] Failed to apply configuration:', err));
  }

  /** Start processing. Rejects if initialisation fails (e.g. WebGPU unavailable); a later call tries again. */
  async start() {
    this.wanted = true;
    const request = ++this.request;
    try {
      await this.sync(true);
    } catch (err) {
      // A start() or stop() issued since then states the caller's newer intent: leave that one alone.
      if (this.request === request) this.wanted = false;
      throw err;
    }
  }

  /** Stop processing. Never rejects, so it is safe to call without awaiting. */
  async stop() {
    this.wanted = false;
    this.request++;
    if (!this.running) return;
    // Not queued behind the sync in flight: frames are dropped and the worker stops at once, even while a new
    // video source is still being opened.
    this.running = false;
    await this.connection?.proxy.stop().catch(err => console.error('[DepthBlendManager] Failed to stop:', err));
  }

  private sync(mayInit = false) {
    const run = this.chain.then(() => this.reconcile(mayInit));
    // A failed run must not block the runs queued behind it.
    this.chain = run.catch(() => {});
    return run;
  }

  /** Bring the worker up to the wanted state. Runs one at a time; `wanted` and `desired` can change at every await. */
  private async reconcile(mayInit: boolean) {
    if (!this.wanted) return;
    // Only start() initialises the worker, so a configure() queued behind a failing start does not repeat the
    // attempt and take its error.
    if (!this.applied && !mayInit) return;

    const { source, params } = this.desired;
    if (!source || !params) {
      throw new Error('[DepthBlendManager] Cannot initialise without videoSource and params');
    }

    this.connection ??= this.deps.connect();
    const { proxy } = this.connection;

    if (!this.applied) {
      console.log('initialising depth blend worker');
      this.localStream = await this.deps.createStream(source);
      await proxy.init(transferStream(this.localStream), { mode: 'depth', params });
      this.applied = { source, params, settings: null };
    }
    await this.pushChanges(proxy, this.applied);

    // stop() may have been called while initialising (e.g. during model download).
    if (!this.wanted || this.running) return;
    this.running = true;
    await proxy.start(Comlink.proxy(this.handleFrame.bind(this)));
  }

  /**
   * Send the worker every part of `desired` it does not have yet. A failed push is logged and counts as
   * applied, so it neither fails start() nor repeats on every sync.
   */
  private async pushChanges(proxy: VideoPipelineWorkerAPI, applied: Nullable<DepthBlendConfig>) {
    const { source } = this.desired;
    if (source && source !== applied.source) {
      applied.source = source;
      try {
        if (this.localStream instanceof ReadableStream) {
          this.localStream.cancel().catch(() => {});
        }
        this.localStream = await this.deps.createStream(source);
        await proxy.replaceStream(transferStream(this.localStream));
      } catch (error) {
        console.error('[DepthBlendManager] Failed to replace video source:', error);
      }
    }

    const { params } = this.desired;
    if (params && params !== applied.params) {
      applied.params = params;
      await proxy.updateParams(params).catch(error => console.error('[DepthBlendManager] Failed to update params:', error));
    }

    const { settings } = this.desired;
    if (settings && settings !== applied.settings) {
      applied.settings = settings;
      await proxy.updateSettings(settings).catch(error => console.error('[DepthBlendManager] Failed to update settings:', error));
    }
  }

  /**
   * Handle frame results from worker
   */
  private handleFrame(result: { mask: ImageBitmap; bg: ImageBitmap }) {
    if (!this.running) return;

    // Ensure background canvas/texture exist (created once)
    if (!this.bgCanvas) {
      this.bgCanvas = document.createElement('canvas');
      this.bgCanvas.width = result.bg.width;
      this.bgCanvas.height = result.bg.height;

      this.bgTex = new THREE.CanvasTexture(this.bgCanvas);
      this.bgTex.flipY = false;
      this.bgTex.generateMipmaps = false;
      this.bgTex.minFilter = this.bgTex.magFilter = THREE.LinearFilter;
      this.bgTex.wrapS = this.bgTex.wrapT = THREE.ClampToEdgeWrapping;
    } else if (this.bgCanvas.width !== result.bg.width || this.bgCanvas.height !== result.bg.height) {
      this.bgCanvas.width = result.bg.width;
      this.bgCanvas.height = result.bg.height;
    }

    // Create NEW CanvasTexture for mask every frame (enables shader fade)

    // Create a dedicated canvas that is *not* re-used so the previous
    // Three.js texture retains the old pixels for cross-fading.
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = result.mask.width;
    maskCanvas.height = result.mask.height;
    maskCanvas.getContext('2d')!.drawImage(result.mask, 0, 0);

    const newMaskTex = new THREE.CanvasTexture(maskCanvas);
    newMaskTex.flipY = false;
    newMaskTex.minFilter = newMaskTex.magFilter = THREE.LinearFilter;
    newMaskTex.generateMipmaps = false;
    newMaskTex.wrapS = newMaskTex.wrapT = THREE.ClampToEdgeWrapping;

    // Keep the previous mask texture so the shader can still sample it for cross-fading, and free the GPU
    // memory of older ones. Three.js re-uploads a disposed texture if it happens to be rendered again.
    this.prevMaskTex?.dispose();
    this.prevMaskTex = this.maskTex;
    this.maskTex = newMaskTex;

    const bgCtx = this.bgCanvas!.getContext('2d')!;
    bgCtx.drawImage(result.bg, 0, 0);
    if (this.bgTex) this.bgTex.needsUpdate = true;

    // Close ImageBitmaps (mask was drawn into new canvas already)
    result.mask.close();
    result.bg.close();

    // Notify listeners every frame so React state sees new object
    if (this.onTextureUpdate && this.maskTex && this.bgTex) {
      this.onTextureUpdate({ mask: this.maskTex, bg: this.bgTex });
    }
  }

  /**
   * Destroy the manager and clean up all resources
   */
  destroy() {
    this.wanted = false;
    this.request++;
    this.running = false;

    // Dispose textures
    this.prevMaskTex?.dispose();
    this.prevMaskTex = null;
    this.maskTex?.dispose();
    this.maskTex = null;
    this.bgTex?.dispose();
    this.bgTex = null;
    this.bgCanvas = null;

    this.connection?.terminate();
    this.connection = null;
    this.applied = null;

    if (DepthBlendManager.instance === this) DepthBlendManager.instance = null;
  }
}

export function isDepthBlendSupported() {
  return 'gpu' in navigator && navigator.gpu !== null;
}
