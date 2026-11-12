import { buildRasterArtPrompt } from './nativeImage';
import type { CarvingDetail } from './prepare';
import type { CarvingStyle } from './session';

/** What to paste into ChatGPT, Gemini or any image chat: the same art direction the image route sends. */
export function externalImagePrompt(subject: string, style: CarvingStyle, detail: CarvingDetail): string {
  // Imported artwork is described as "Line art from <file>"; that names a file, not a motif.
  const motif = /^line art from /i.test(subject.trim()) ? '' : subject.trim();
  const base = buildRasterArtPrompt(motif || 'a simple motif', detail);
  return `${base} ${style === 'bold' ? 'Bold, broad filled shapes with few interior lines.' : 'Clean line art with filled strokes.'} Square image.`;
}

const kMaxBytes = 2_000_000;
const kMaxSide = 1600;
/** Decoding is bounded before it starts: by file size, and by the pixel count read from the image header. */
export const kMaxInputBytes = 25_000_000;
export const kMaxInputPixels = 40_000_000;

/** Width and height from a PNG, GIF, JPEG or WebP header, without decoding the image. Null when unreadable. */
export function imageHeaderSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
  if (bytes.length >= 24 && ascii(1, 3) === 'PNG') return { width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes.length >= 10 && ascii(0, 3) === 'GIF') return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8X') return { width: 1 + (view.getUint32(24, true) & 0xffffff), height: 1 + (view.getUint32(27, true) & 0xffffff) };
    if (chunk === 'VP8L') {
      const bits = view.getUint32(21, true);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (chunk === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    return null;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    // Walk JPEG segments to the first start-of-frame marker.
    for (let at = 2; at + 9 < bytes.length; ) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1]!;
      const length = view.getUint16(at + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
      at += 2 + length;
    }
  }
  return null;
}

/**
 * Images come back from other chats as PNG, JPEG or WebP and often larger than the tracer's 2 MB limit. Re-encode them
 * here as a PNG no larger than needed, so a dropped or pasted image traces like a generated one.
 */
export async function carvingPngFromImage(file: File): Promise<File> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Drop or paste an image: PNG, JPEG, WebP or GIF.');
  if (file.size > kMaxInputBytes) throw new Error('This image is larger than 25 MB. Save a smaller version and try again.');
  const size = imageHeaderSize(new Uint8Array(await file.arrayBuffer()));
  if (!size || !size.width || !size.height) throw new Error('This file could not be read as an image.');
  if (size.width * size.height > kMaxInputPixels)
    throw new Error('This image has more than 40 megapixels. Save a smaller version and try again.');
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
