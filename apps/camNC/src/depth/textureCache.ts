/// <reference types="@webgpu/types" />

/**
 * Intermediate textures reused between frames, one per tag. A tag keeps its texture for as long as the requested size
 * stays the same; a new size replaces it and destroys the previous one.
 *
 * Acquire each tag at most once per frame: a texture handed out earlier in the frame must stay alive until the frame's
 * commands are submitted.
 */
export class TextureCache {
  private textures = new Map<string, GPUTexture>();

  constructor(private device: GPUDevice) {}

  acquire(tag: string, width: number, height: number, usage: GPUTextureUsageFlags): GPUTexture {
    const existing = this.textures.get(tag);
    if (existing && existing.width === width && existing.height === height) return existing;

    existing?.destroy();

    const tex = this.device.createTexture({
      label: `${tag} (${width}x${height})`,
      size: [width, height],
      format: 'rgba8unorm',
      usage,
    });
    this.textures.set(tag, tex);
    return tex;
  }
}
