import { expect, it } from 'vitest';
import { readAssistantImage } from './images';

it('bounds reference dimensions while preserving aspect ratio and recognizable image data', async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 2400;
  canvas.height = 1800;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ff0000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)));
  const result = await readAssistantImage(new File([blob], 'reference.png', { type: 'image/png' }));
  const image = new Image();
  image.src = `data:${result.mediaType};base64,${result.data}`;
  await image.decode();
  expect([image.naturalWidth, image.naturalHeight]).toEqual([1600, 1200]);
  context.drawImage(image, 0, 0);
  expect([...context.getImageData(0, 0, 1, 1).data]).toEqual([255, 0, 0, 255]);
});

it('rejects unsupported, oversized and corrupt images', async () => {
  await expect(readAssistantImage(new File(['svg'], 'image.svg', { type: 'image/svg+xml' }))).rejects.toThrow(/PNG/);
  await expect(readAssistantImage(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }))).rejects.toThrow(
    /10 MB/
  );
  await expect(readAssistantImage(new File(['corrupt'], 'bad.png', { type: 'image/png' }))).rejects.toThrow();
});
