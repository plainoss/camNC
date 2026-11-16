import { describe, expect, it } from 'vitest';
import { TextureCache } from './textureCache';

function setup() {
  const created: { label: string; width: number; height: number; usage: number; destroyed: boolean }[] = [];
  const device = {
    createTexture: ({ label, size, usage }: { label: string; size: [number, number]; usage: number }) => {
      const tex = { label, width: size[0], height: size[1], usage, destroyed: false, destroy: () => void (tex.destroyed = true) };
      created.push(tex);
      return tex;
    },
  } as unknown as GPUDevice;
  return { cache: new TextureCache(device), created };
}

describe('TextureCache', () => {
  it('reuses the texture of a tag while the size stays the same', () => {
    const { cache, created } = setup();
    const first = cache.acquire('machine', 8, 4, 1);
    expect(cache.acquire('machine', 8, 4, 1)).toBe(first);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ label: 'machine (8x4)', width: 8, height: 4, usage: 1, destroyed: false });
  });

  it('keeps one texture per tag, each with its own usage', () => {
    const { cache, created } = setup();
    const src = cache.acquire('srcTex', 8, 4, 1);
    const machine = cache.acquire('machine', 8, 4, 2);
    expect(machine).not.toBe(src);
    expect(created.map(t => t.usage)).toEqual([1, 2]);
    expect(created.some(t => t.destroyed)).toBe(false);
  });

  it('replaces and destroys the texture of a tag when the size changes', () => {
    const { cache, created } = setup();
    cache.acquire('machine', 8, 4, 1);
    const other = cache.acquire('camMask', 8, 4, 1);
    const resized = cache.acquire('machine', 16, 4, 1);

    expect(resized).toMatchObject({ width: 16, height: 4 });
    expect(created.map(t => t.destroyed)).toEqual([true, false, false]);
    expect(cache.acquire('machine', 16, 4, 1)).toBe(resized);
    expect(cache.acquire('camMask', 8, 4, 1)).toBe(other);
    expect(created).toHaveLength(3);
  });
});
