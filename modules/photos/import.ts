import { photoTime } from './matching';
import { imageMime, nativeImportOriginalHash } from './selection';
import { exifAltitude, type PhotoAltitude } from './details';
import type { Coordinate } from '../navigation/types.ts';
export type PhotoDraft = {
  hash: string;
  name: string;
  time: number | null;
  preview: Blob;
  detail: Blob;
  altitude?: PhotoAltitude;
  zone: string;
  timeSource?: 'exif' | 'camera';
  timeSourceDetail?: 'return-estimate' | 'manual';
  cameraCoordinates?: Coordinate;
  cameraAccuracy?: number;
  cameraTrackId?: string;
  cameraLocationTimeSource?: 'capture' | 'return';
};
export async function readPhoto(
  file: File,
  stage: (message: string) => void = () => {},
): Promise<PhotoDraft> {
  if (file.size > 20 * 1024 * 1024) throw new Error('照片文件超过 20 MB；请先用手机相册导出较小副本');
  const mime = imageMime(file);
  if (!mime) throw new Error('无法识别照片格式；可尝试 JPEG、PNG、WebP、HEIC 或 AVIF');
  if (file.type !== mime) file = new File([file], file.name, { type: mime });
  stage('正在读取原图…');
  // Start metadata/hash and image work together, observing every rejection.
  const metadata = async () => {
    const buffer = await file.arrayBuffer();
    const [meta, digest] = await Promise.all([
      import('exifr')
        .then(({ parse }) =>
          parse(buffer, {
            pick: [
              'DateTimeOriginal',
              'OffsetTimeOriginal',
              'GPSAltitude',
              'GPSAltitudeRef',
              'ImageUniqueID',
              'UserComment',
            ],
            reviveValues: false,
            translateValues: false,
          }),
        )
        .catch(() => undefined),
      crypto.subtle.digest('SHA-256', buffer),
    ]);
    return { meta: meta as Record<string, unknown> | undefined, digest, buffer };
  };
  const images = async () => {
    const bitmap = await decodePhotoBitmap(file);
    try {
      stage('正在生成照片预览和清晰副本…');
      const detailCanvas = document.createElement('canvas'),
        previewCanvas = document.createElement('canvas');
      const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
      detailCanvas.width = Math.max(1, Math.round(bitmap.width * scale));
      detailCanvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const detailContext = detailCanvas.getContext('2d'),
        previewContext = previewCanvas.getContext('2d');
      if (!detailContext || !previewContext)
        throw new Error('无法生成照片预览');
      detailContext.drawImage(
        bitmap.source,
        0,
        0,
        detailCanvas.width,
        detailCanvas.height,
      );
      const small = Math.min(
        1,
        960 / Math.max(detailCanvas.width, detailCanvas.height),
      );
      previewCanvas.width = Math.max(1, Math.round(detailCanvas.width * small));
      previewCanvas.height = Math.max(
        1,
        Math.round(detailCanvas.height * small),
      );
      // Read the smaller canvas instead of resampling the full camera image twice.
      previewContext.drawImage(
        detailCanvas,
        0,
        0,
        previewCanvas.width,
        previewCanvas.height,
      );
      const encode = (canvas: HTMLCanvasElement, quality: number) =>
        new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('照片副本生成失败'))),
            'image/jpeg',
            quality,
          ),
        );
      const detail = await compressCanvas(detailCanvas, 4 * 1024 * 1024, encode);
      // Derive the preview from the final detail image dimensions. Both outputs
      // stay bounded and encoding retries trade a little quality for size.
      const preview = await compressCanvas(previewCanvas, 1024 * 1024, encode, [0.82, 0.72, 0.60, 0.48]);
      return { preview, detail };
    } finally {
      bitmap.close();
    }
  };
  const [metadataResult, imageResult] = await Promise.allSettled([
    metadata(),
    images(),
  ]);
  if (metadataResult.status === 'rejected') throw metadataResult.reason;
  if (imageResult.status === 'rejected') throw imageResult.reason;
  const { meta, digest, buffer } = metadataResult.value,
    { preview, detail } = imageResult.value;
  const calculatedHash = [...new Uint8Array(digest)]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  const markedOriginalHash = nativeImportOriginalHash(meta, file.type, buffer);
  return {
    hash: markedOriginalHash ?? calculatedHash,
    name: file.name.slice(0, 200),
    time: photoTime(meta?.DateTimeOriginal, meta?.OffsetTimeOriginal),
    ...(photoTime(meta?.DateTimeOriginal, meta?.OffsetTimeOriginal) !== null ? { timeSource: 'exif' as const } : {}),
    preview,
    detail,
    altitude: exifAltitude(meta),
    zone: meta?.OffsetTimeOriginal
      ? `拍摄时区 ${meta.OffsetTimeOriginal}`
      : '无时区信息，按本机时区解释',
  };
}


async function decodePhotoBitmap(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Some Android WebViews can display a format in <img> while their
      // ImageBitmap decoder rejects it. Retry through the browser image path.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => { image.src = ''; } };
  } catch {
    throw new Error('此设备的浏览器解码器不支持该照片；可先在相册另存为 JPEG');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function compressCanvas(
  source: HTMLCanvasElement,
  maxBytes: number,
  encode: (canvas: HTMLCanvasElement, quality: number) => Promise<Blob>,
  qualities = [0.86, 0.76, 0.66, 0.56, 0.46],
) {
  let canvas = source;
  let owned = false;
  try {
    for (let pass = 0; pass < 6; pass++) {
      for (const quality of qualities) {
        const result = await encode(canvas, quality);
        if (result.size <= maxBytes) return result;
      }
      if (Math.max(canvas.width, canvas.height) <= 320) break;
      const reduced = document.createElement('canvas');
      reduced.width = Math.max(1, Math.round(canvas.width * 0.82));
      reduced.height = Math.max(1, Math.round(canvas.height * 0.82));
      const context = reduced.getContext('2d');
      if (!context) throw new Error('无法生成照片副本');
      context.drawImage(canvas, 0, 0, reduced.width, reduced.height);
      if (owned) {
        canvas.width = 0;
        canvas.height = 0;
      }
      canvas = reduced;
      owned = true;
    }
    throw new Error(maxBytes <= 1024 * 1024 ? '照片预览无法压缩至1MB' : '照片清晰副本无法压缩至4MB');
  } finally {
    if (owned) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
