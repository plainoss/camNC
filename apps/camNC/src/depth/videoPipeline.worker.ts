import { ensureReadableStream, registerThreeJsTransferHandlers, ReplaceableStreamWorker } from '@wbcnc/video-worker-utils';
import * as Comlink from 'comlink';
import log from 'loglevel';
import { DepthEstimationStep } from './depthPipeline';
import { GaussianBlurStep } from './gaussianBlurStep';
import { MaskBlendStep } from './maskBlendStep';
import { MaskInflationStep } from './maskInflationStep';
import { CamToMachineStep, MachineToCamStep, RemapStepParams, UndistortStep } from './remapPipeline';
import { TextureBlitter } from './textureBlitter';
import { TextureCache } from './textureCache';
log.setDefaultLevel(log.levels.INFO);

export interface DepthFrameResult {
  mask: ImageBitmap;
  bg: ImageBitmap;
}

export interface VideoPipelineWorkerAPI extends ReplaceableStreamWorker {
  init(stream: ReadableStream<VideoFrame> | MediaStreamTrack, params: RemapStepParams): Promise<void>;
  /**
   * Start internal processing loop and stream results to the provided callback on the main thread.
   */
  start(cb: any): Promise<void>;
  /** Stop processing loop */
  stop(): Promise<void>;
  /** Update processing parameters (e.g., calibration/extrinsics) without restarting worker */
  updateParams(params: RemapStepParams): Promise<void>;
  /** Update runtime settings such as FPS limit or mask margins */
  updateSettings(settings: WorkerSettings): Promise<void>;
}

/** Settings that can be adjusted at runtime from the main thread. */
export interface WorkerSettings {
  /** Maximum number of depth estimation frames per second. Values < 1 mean one frame every \(1/value\) seconds */
  frameRateLimit?: number;
  /** Pixel margin used when inflating background update mask. */
  bgMargin?: number;
  /** Pixel margin used when inflating render mask. */
  renderMargin?: number;
  thresholdOffset?: number;
}

/** The steps of the depth pipeline. They hold GPU pipelines, so they are built once with the device; an inflation step is built again when its margin changes. */
interface DepthSteps {
  undistort: UndistortStep;
  camToMachine: CamToMachineStep;
  depth: DepthEstimationStep;
  bgInflate: MaskInflationStep;
  renderInflate: MaskInflationStep;
  machineToCam: MachineToCamStep;
  blur: GaussianBlurStep;
  blend: MaskBlendStep;
}

interface Gpu {
  device: GPUDevice;
  steps: DepthSteps;
  textures: TextureCache;
}

class VideoPipelineWorker implements VideoPipelineWorkerAPI {
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  private gpu: Gpu | null = null;
  private blitter: TextureBlitter | null = null;
  private maskBlitter: { blitter: TextureBlitter; width: number; height: number } | null = null;
  private params: RemapStepParams | null = null;

  // Throttle processing to this frame rate.
  private frameRateLimit = 1 / 2; // 0.5 fps -> one frame every 2 s
  private lastFrameTime = 0;

  // Runtime-configurable mask margins. A MaskInflationStep bakes its margin into its shader.
  private bgUpdateMaskMargin = 50;
  private renderMaskMargin = 10;
  // Relative 0-1 depth offset above the table, matches the store default.
  private thresholdOffset = 0.2;

  private cachedBg: GPUTexture | null = null;

  /** Acquire the reusable intermediate texture of `tag`. Each tag is acquired at most once per frame. */
  private acquireTex(
    tag: string,
    width: number,
    height: number,
    usage: number = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING
  ): GPUTexture {
    return this.ensureGpu().textures.acquire(tag, width, height, usage);
  }

  private ensureGpu(): Gpu {
    if (!this.gpu) throw new Error('GPU device not ready');
    return this.gpu;
  }

  private async runDepth(tex: GPUTexture, params: RemapStepParams): Promise<{ mask: GPUTexture; bg: GPUTexture }> {
    const { device, steps } = this.ensureGpu();
    const { width, height } = tex;
    // Matches size and multiple requirement of
    // https://huggingface.co/depth-anything/Depth-Anything-V2-Small-hf/blob/main/preprocessor_config.json
    const scale = Math.max(width / 518, height / 518);
    const depthSize: [number, number] = [Math.ceil(width / scale / 14) * 14, Math.ceil(height / scale / 14) * 14];
    log.debug('depthSize', depthSize);

    let t0 = performance.now();
    const t00 = performance.now();

    // ---- 1. cam → machine space (fixed depthSize) ----
    const machineDst = this.acquireTex('machine', depthSize[0], depthSize[1]);
    const prepParams: RemapStepParams = {
      ...params,
      outputSize: depthSize,
    };
    const machineTex = await steps.camToMachine.process(tex, prepParams, machineDst);
    log.debug('prepStep', performance.now() - t0);
    t0 = performance.now();
    const depthOutput = await steps.depth.process(machineTex);
    log.debug('depthEstimator', performance.now() - t0);

    const bgMaskTex = await steps.bgInflate.process(depthOutput);
    log.debug('bgMaskInflation', performance.now() - t0);

    const renderMaskTex = await steps.renderInflate.process(depthOutput);
    // log.debug('renderMaskInflation', performance.now() - t0);

    // Warp blurred masks back to camera space
    t0 = performance.now();

    const camMaskDst = this.acquireTex('camMask', depthSize[0], depthSize[1]);
    const camRenderMaskDst = this.acquireTex('camRenderMask', depthSize[0], depthSize[1]);

    const maskWarpParams = {
      params: { ...params, outputSize: depthSize },
      scale: [width / depthSize[0], height / depthSize[1]] as [number, number],
    };
    const camMaskTex = await steps.machineToCam.process(bgMaskTex, maskWarpParams, camMaskDst);
    const camRenderMaskTex = await steps.machineToCam.process(renderMaskTex, maskWarpParams, camRenderMaskDst);
    log.debug('maskWarpStep', performance.now() - t0);

    t0 = performance.now();

    const blurredMaskDst = this.acquireTex('blurMask', depthSize[0], depthSize[1]);
    const blurredRenderMaskDst = this.acquireTex('blurRenderMask', depthSize[0], depthSize[1]);

    const blurredMaskTex = await steps.blur.process(camMaskTex, blurredMaskDst);
    const blurredRenderMaskTex = await steps.blur.process(camRenderMaskTex, blurredRenderMaskDst);
    log.debug('gaussianBlur', performance.now() - t0);

    t0 = performance.now();
    const bgBlendDst = this.acquireTex('bgBlend', width, height);
    const updatedBg = await steps.blend.process(tex, blurredMaskTex, this.cachedBg!, params, bgBlendDst);
    // Do not destroy blurredMaskTex here; keep for reuse.
    log.debug('cachedBgUpdater', performance.now() - t0);
    // Update cached background
    const copyEncoder = device.createCommandEncoder();
    copyEncoder.copyTextureToTexture({ texture: updatedBg }, { texture: this.cachedBg! }, [updatedBg.width, updatedBg.height]);
    device.queue.submit([copyEncoder.finish()]);
    log.debug('cachedBgUpdater', performance.now() - t0);
    log.debug('depth fps', 1000 / (performance.now() - t00));

    return { mask: blurredRenderMaskTex, bg: this.cachedBg! };
  }

  async init(stream: ReadableStream<VideoFrame> | MediaStreamTrack, params: RemapStepParams): Promise<void> {
    if (!navigator.gpu) throw new Error('WebGPU not supported');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter');
    const device = await adapter.requestDevice();
    this.gpu = {
      device,
      steps: {
        undistort: new UndistortStep(device),
        camToMachine: new CamToMachineStep(device),
        depth: new DepthEstimationStep(device, { thresholdOffset: this.thresholdOffset }),
        bgInflate: new MaskInflationStep(device, this.bgUpdateMaskMargin),
        renderInflate: new MaskInflationStep(device, this.renderMaskMargin),
        machineToCam: new MachineToCamStep(device),
        blur: new GaussianBlurStep(device),
        blend: new MaskBlendStep(device),
      },
      textures: new TextureCache(device),
    };
    this.reader = ensureReadableStream(stream).getReader();
    this.params = params;
  }

  async replaceStream(stream: ReadableStream<VideoFrame> | MediaStreamTrack): Promise<void> {
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        /* ignore */
      }
    }
    this.reader = ensureReadableStream(stream).getReader();
  }

  private async _throttleFrameRate() {
    while (performance.now() - this.lastFrameTime < 1000 / this.frameRateLimit) {
      await new Promise(r => requestAnimationFrame(r));
    }
  }

  private running = false;
  private cb: any = null;
  private loopPromise: Promise<void> | null = null;
  private transition: Promise<void> = Promise.resolve();

  async start(cb: any): Promise<void> {
    this.cb = cb;
    this.transition = this.transition
      .then(async () => {
        if (this.running) return;
        if (this.loopPromise) await this.loopPromise;
        this.running = true;
        this.loopPromise = this.loop();
      })
      .catch(console.error);
    await this.transition;
  }

  async stop(): Promise<void> {
    this.transition = this.transition
      .then(async () => {
        if (!this.running) return;
        this.running = false;
        await this.loopPromise;
        this.loopPromise = null;
      })
      .catch(console.error);
    await this.transition;
  }

  private async loop() {
    while (this.running) {
      try {
        const result = await this.processFrame();
        if (this.cb && result) this.cb(result);
      } catch (err) {
        console.error('[VideoPipelineWorker] loop error', err);
        // stop on error
        this.running = false;
      }
    }
  }

  /** internal: processes one frame and returns depth result */
  private async processFrame(): Promise<DepthFrameResult | null> {
    if (!this.reader || !this.gpu || !this.params) throw new Error('Worker not initialized');
    const { device, steps } = this.gpu;
    const params = this.params;

    await this._throttleFrameRate();
    this.lastFrameTime = performance.now();

    const { value: frame, done } = await this.reader.read();
    if (done || !frame) return null;
    const width = frame.displayWidth || frame.codedWidth;
    const height = frame.displayHeight || frame.codedHeight;

    if (!this.blitter) this.blitter = new TextureBlitter(device, width, height);

    const tex = this.acquireTex(
      'srcTex',
      width,
      height,
      GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT
    );
    device.queue.copyExternalImageToTexture({ source: frame }, { texture: tex }, [width, height]);
    frame.close();

    if (!this.cachedBg) {
      this.cachedBg = await steps.undistort.process(tex, params);
    }

    const { mask, bg } = await this.runDepth(tex, params);

    // Convert mask & bg to ImageBitmap via blitter(s)
    const maskBmp = this.getMaskBlitter(device, mask.width, mask.height).blit(mask);
    const bgBmp = this.blitter!.blit(bg);

    // log.info('fps', 1000 / (performance.now() - this.lastFrameTime));
    return Comlink.transfer({ mask: maskBmp, bg: bgBmp }, [maskBmp, bgBmp]);
  }

  /** Reuse the mask blitter (canvas, context and render pipeline) unless the mask size changed. */
  private getMaskBlitter(device: GPUDevice, width: number, height: number): TextureBlitter {
    if (!this.maskBlitter || this.maskBlitter.width !== width || this.maskBlitter.height !== height) {
      this.maskBlitter = { blitter: new TextureBlitter(device, width, height), width, height };
    }
    return this.maskBlitter.blitter;
  }

  async updateParams(params: RemapStepParams): Promise<void> {
    this.params = params;
  }

  /** Apply runtime settings (frame rate limit, mask margins) without restarting. */
  async updateSettings({ frameRateLimit, bgMargin, renderMargin, thresholdOffset }: WorkerSettings): Promise<void> {
    if (frameRateLimit !== undefined && frameRateLimit > 0) {
      this.frameRateLimit = frameRateLimit;
    }

    // Settings may arrive before init(), which then builds the steps from these fields.
    if (bgMargin !== undefined) {
      this.bgUpdateMaskMargin = Math.max(0, bgMargin | 0);
      if (this.gpu && this.gpu.steps.bgInflate.margin !== this.bgUpdateMaskMargin) {
        this.gpu.steps.bgInflate = new MaskInflationStep(this.gpu.device, this.bgUpdateMaskMargin);
      }
    }

    if (renderMargin !== undefined) {
      this.renderMaskMargin = Math.max(0, renderMargin | 0);
      if (this.gpu && this.gpu.steps.renderInflate.margin !== this.renderMaskMargin) {
        this.gpu.steps.renderInflate = new MaskInflationStep(this.gpu.device, this.renderMaskMargin);
      }
    }

    if (thresholdOffset !== undefined) {
      this.thresholdOffset = thresholdOffset;
      this.gpu?.steps.depth.setParams({ thresholdOffset });
    }
  }
}

registerThreeJsTransferHandlers();
const worker = new VideoPipelineWorker();
Comlink.expose(worker);

(self as any).onerror = (e: ErrorEvent) => console.error('[VideoPipelineWorker] uncaught:', e);
