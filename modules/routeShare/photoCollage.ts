import type { TripPhoto } from '../photos/storage';
import { renderPhotoExport } from '../photos/export';
import { photoLayout } from './photoLayout';
export type SharePhotoOptions = { photos: TripPhoto[]; hero?: string };
export async function appendPhotoCollage(
  base: HTMLCanvasElement,
  options: SharePhotoOptions,
  signal: AbortSignal,
) {
  const photos = options.photos.slice(0, 8);
  if (!photos.length) return base;
  const images: ImageBitmap[] = [];
  try {
    for (const photo of photos) {
      signal.throwIfAborted();
      const file = await renderPhotoExport(photo, false);
      images.push(
        await createImageBitmap(file, {
          resizeWidth: 1110,
          resizeQuality: 'high',
        }),
      );
    }
    signal.throwIfAborted();
    const layout = photoLayout(
      images.map((b) => b.width / b.height),
      photos.findIndex((p) => p.id === options.hero),
    );
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = base.height + layout.height;
    const c = canvas.getContext('2d');
    if (!c) throw new Error('无法生成照片混排');
    c.fillStyle = '#112b31';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.drawImage(base, 0, 0);
    c.fillStyle = '#edf7f4';
    c.font = '30px sans-serif';
    c.fillText('沿途照片', 45, base.height + 46);
    for (const tile of layout.tiles) {
      const image = images[tile.index],
        scale = Math.min(tile.width / image.width, tile.height / image.height);
      c.drawImage(
        image,
        tile.x + (tile.width - image.width * scale) / 2,
        base.height + tile.y + (tile.height - image.height * scale) / 2,
        image.width * scale,
        image.height * scale,
      );
      c.font = '22px sans-serif';
      c.fillText(
        photos[tile.index].title || photos[tile.index].name,
        tile.x,
        base.height + tile.y + tile.height + 30,
        tile.width,
      );
    }
    return canvas;
  } finally {
    images.forEach((image) => image.close());
  }
}
