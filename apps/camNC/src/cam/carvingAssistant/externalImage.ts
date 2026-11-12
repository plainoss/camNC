import { buildRasterArtPrompt } from './nativeImage';
import type { CarvingDetail } from './prepare';
import type { CarvingStyle } from './session';

/** What to paste into ChatGPT, Gemini or any image chat: the same art direction the image route sends. */
export function externalImagePrompt(subject: string, style: CarvingStyle, detail: CarvingDetail): string {
  const base = buildRasterArtPrompt(subject.trim() || 'a simple motif', detail);
  return `${base} ${style === 'bold' ? 'Bold, broad filled shapes with few interior lines.' : 'Clean line art with filled strokes.'} Square image.`;
}

const kMaxBytes = 2_000_000;
const kMaxSide = 1600;

/**
 * Images come back from other chats as PNG, JPEG or WebP and often larger than the tracer's 2 MB limit. Re-encode them
 * here as a PNG no larger than needed, so a dropped or pasted image traces like a generated one.
 */
export async function carvingPngFromImage(file: File): Promise<File> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Drop or paste an image: PNG, JPEG, WebP or GIF.');
  if (file.type === 'image/png' && file.size <= kMaxBytes) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('This file could not be read as an image.');
  }
  try {
    for (const side of [kMaxSide, 1200, 900]) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d')!;
      // Transparent areas are retained material, as on a white page.
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      if (blob && blob.size <= kMaxBytes)
        return new File([blob], `${file.name.replace(/\.\w+$/, '') || 'pasted-image'}.png`, { type: 'image/png' });
    }
  } finally {
    bitmap.close();
  }
  throw new Error('This image is too detailed to trace. Ask the chat for simpler black and white line art.');
}

/** The first image in a paste or drop, if any. */
export function imageFromTransfer(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
  }
  return Array.from(data.files ?? []).find(file => file.type.startsWith('image/')) ?? null;
}
