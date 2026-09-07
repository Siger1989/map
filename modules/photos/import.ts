import { photoTime } from './matching';
export type PhotoDraft = {
  hash: string;
  name: string;
  time: number | null;
  preview: Blob;
  zone: string;
};
export async function readPhoto(file: File): Promise<PhotoDraft> {
  if (file.size > 20 * 1024 * 1024) throw new Error('照片超过 20 MB');
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type))
    throw new Error('请选择 JPEG、PNG、WebP 或设备可解码的 HEIC 照片');
  const buffer = await file.arrayBuffer();
  const { parse } = await import('exifr');
  let meta: Record<string, unknown> | undefined;
  try {
    meta = await parse(buffer, {
      pick: ['DateTimeOriginal', 'OffsetTimeOriginal'],
      reviveValues: false,
    });
  } catch {
    /* Images without EXIF need a user-entered capture time. */
  }
  const bitmap = await createImageBitmap(file, {
    imageOrientation: 'from-image',
  });
  let preview: Blob;
  try {
    const scale = Math.min(1, 960 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法生成照片预览');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    preview = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('预览生成失败'))),
        'image/jpeg',
        0.78,
      ),
    );
  } finally {
    bitmap.close();
  }
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return {
    hash: [...new Uint8Array(digest)]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join(''),
    name: file.name.slice(0, 200),
    time: photoTime(meta?.DateTimeOriginal, meta?.OffsetTimeOriginal),
    preview,
    zone: meta?.OffsetTimeOriginal
      ? `拍摄时区 ${meta.OffsetTimeOriginal}`
      : '无时区信息，按本机时区解释',
  };
}
