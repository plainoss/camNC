import type { AssistantImage } from './provider';

const media = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export async function readAssistantImage(file: File): Promise<AssistantImage> {
  if (!media.has(file.type)) throw new Error('Attach a PNG, JPEG, WebP or GIF image.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000)
      throw new Error('Choose an image with at most 40 million pixels.');
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image previews are unavailable in this browser.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const encoded = canvas.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9);
    return {
      name: file.type === 'image/gif' ? `${file.name} (first frame)` : file.name,
      mediaType: file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
      data: encoded.split(',')[1]!,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The provider receives raster views rather than SVG text it cannot inspect as an image. */
export async function rasterizeAssistantView(svg: string, name: string): Promise<AssistantImage> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1000 / Math.max(image.naturalWidth || 1000, image.naturalHeight || 700));
    canvas.width = Math.max(1, Math.round((image.naturalWidth || 1000) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || 700) * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image previews are unavailable in this browser.');
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { name, mediaType: 'image/png', data: canvas.toDataURL('image/png').split(',')[1]! };
  } finally {
    URL.revokeObjectURL(url);
  }
}
