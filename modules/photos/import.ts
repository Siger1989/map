import { photoTime } from './matching';
import { imageMime, nativeImportOriginalHash } from './selection';
import { exifAltitude, type PhotoAltitude } from './details';
import { exifGpsAccuracy, exifGpsCoordinates } from './gps.ts';
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
  /** Original WGS84 coordinates embedded in this image's EXIF; independent of live GPS/track matching. */
  gpsCoordinates?: Coordinate;
  gpsAccuracy?: number;
  cameraTrackId?: string;
  cameraLocationTimeSource?: 'capture' | 'return';
};
type HeaderDimensions = { width: number; height: number; orientation?: number };
const MAX_DECODER_EDGE = 2560;

function tiffOrientation(bytes: Uint8Array, start: number, end: number): number | undefined {
  if (start + 8 > end) return;
  const little = bytes[start] === 0x49 && bytes[start + 1] === 0x49;
  if (!little && !(bytes[start] === 0x4d && bytes[start + 1] === 0x4d)) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, little);
  const u32 = (offset: number) => view.getUint32(offset, little);
  if (u16(start + 2) !== 42) return;
  const ifd = start + u32(start + 4);
  if (ifd + 2 > end) return;
  const count = u16(ifd);
  for (let i = 0, entry = ifd + 2; i < count && entry + 12 <= end; i++, entry += 12) {
    if (u16(entry) === 0x0112 && u16(entry + 2) === 3 && u32(entry + 4) === 1) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : undefined;
    }
  }
}

function jpegDimensions(bytes: Uint8Array): HeaderDimensions | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return;
  let width = 0, height = 0, orientation: number | undefined, sawScan = false;
  for (let offset = 2; offset + 4 < bytes.length;) {
    if (bytes[offset] !== 0xff) { offset++; continue; }
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) break;
    if (marker === 0xda) { sawScan = true; break; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = view.getUint16(offset, false);
    const payload = offset + 2, end = offset + length;
    if (length < 2 || end > bytes.length) break;
    if (marker === 0xe1 && payload + 14 <= end &&
        bytes[payload] === 0x45 && bytes[payload + 1] === 0x78 && bytes[payload + 2] === 0x69 &&
        bytes[payload + 3] === 0x66 && bytes[payload + 4] === 0 && bytes[payload + 5] === 0)
      orientation = tiffOrientation(bytes, payload + 6, end);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && payload + 5 <= end) {
      height = view.getUint16(payload + 1, false);
      width = view.getUint16(payload + 3, false);
    }
    offset = end;
  }
  return width && height && sawScan ? { width, height, orientation: orientation ?? 1 } : undefined;
}

function pngDimensions(bytes: Uint8Array): HeaderDimensions | undefined {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false), height = view.getUint32(20, false);
  let orientation = 1, reachedImageData = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset, false), data = offset + 8, end = data + length;
    if (end + 4 > bytes.length) break;
    if (bytes[offset + 4] === 0x65 && bytes[offset + 5] === 0x58 && bytes[offset + 6] === 0x49 && bytes[offset + 7] === 0x66)
      orientation = tiffOrientation(bytes, data, end) ?? 1;
    if (bytes[offset + 4] === 0x49 && bytes[offset + 5] === 0x44 && bytes[offset + 6] === 0x41 && bytes[offset + 7] === 0x54) { reachedImageData = true; break; }
    offset = end + 4;
  }
  return width && height && reachedImageData ? { width, height, orientation } : undefined;
}

function webpDimensions(bytes: Uint8Array): HeaderDimensions | undefined {
  if (bytes.length < 30 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF' ||
      String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP') return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, orientation: number | undefined, hasExif = false;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const length = view.getUint32(offset + 4, true), data = offset + 8, end = data + length;
    if (kind === 'VP8X' && length >= 10 && data + 10 <= bytes.length) {
      hasExif = (bytes[data] & 0x08) !== 0;
      width = 1 + bytes[data + 4] + (bytes[data + 5] << 8) + (bytes[data + 6] << 16);
      height = 1 + bytes[data + 7] + (bytes[data + 8] << 8) + (bytes[data + 9] << 16);
    } else if (kind === 'VP8 ' && length >= 10 && data + 10 <= bytes.length && bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
      width = view.getUint16(data + 6, true) & 0x3fff;
      height = view.getUint16(data + 8, true) & 0x3fff;
    } else if (kind === 'VP8L' && length >= 5 && data + 5 <= bytes.length && bytes[data] === 0x2f) {
      width = 1 + ((bytes[data + 2] & 0x3f) << 8) + bytes[data + 1];
      height = 1 + ((bytes[data + 4] & 0x0f) << 10) + (bytes[data + 3] << 2) + ((bytes[data + 2] & 0xc0) >> 6);
    } else if (kind === 'EXIF' && end <= bytes.length) {
      const prefix = bytes[data] === 0x45 && bytes[data + 1] === 0x78 && bytes[data + 2] === 0x69 && bytes[data + 3] === 0x66 ? 6 : 0;
      orientation = tiffOrientation(bytes, data + prefix, end);
    }
    if (end > bytes.length) break;
    offset = end + (length & 1);
  }
  if (!width || !height || (hasExif && orientation === undefined)) return;
  return { width, height, orientation: orientation ?? 1 };
}

async function boundedBitmapOptions(file: File): Promise<ImageBitmapOptions> {
  // Header parsing is bounded and avoids decoding unsupported/ambiguous files
  // at a guessed dimension. Rotated EXIF images use their display dimensions.
  const bytes = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  const dimensions = jpegDimensions(bytes) ?? pngDimensions(bytes) ?? webpDimensions(bytes);
  if (!dimensions) return { imageOrientation: 'from-image' };
  const rotated = dimensions.orientation! >= 5;
  const width = rotated ? dimensions.height : dimensions.width;
  const height = rotated ? dimensions.width : dimensions.height;
  if (Math.max(width, height) <= MAX_DECODER_EDGE) return { imageOrientation: 'from-image' };
  const scale = MAX_DECODER_EDGE / Math.max(width, height);
  return {
    imageOrientation: 'from-image',
    resizeWidth: Math.max(1, Math.round(width * scale)),
    resizeHeight: Math.max(1, Math.round(height * scale)),
    // Match the existing canvas default bilinear sampling; a higher-quality
    // extra resampling pass made measured imports slower without more detail.
    resizeQuality: 'low',
  };
}

export async function readPhoto(
  file: File,
  stage: (message: string) => void = () => {},
  onPreview?: (preview: Blob) => void,
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
              'GPSLatitude',
              'GPSLatitudeRef',
              'GPSLongitude',
              'GPSLongitudeRef',
              'GPSHPositioningError',
              'GPSMapDatum',
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
    let detailCanvas = document.createElement('canvas'), previewCanvas = document.createElement('canvas');
    try {
      stage('正在生成照片预览和清晰副本…');
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
      const previewPromise = compressCanvas(previewCanvas, 1024 * 1024, encode, [0.82, 0.72, 0.60, 0.48]).then((preview) => {
        try { onPreview?.(preview); } catch { /* observers cannot fail the import */ }
        return preview;
      });
      const [previewResult, detailResult] = await Promise.allSettled([
        previewPromise,
        compressCanvas(detailCanvas, 4 * 1024 * 1024, encode),
      ]);
      if (previewResult.status === 'rejected') throw previewResult.reason;
      if (detailResult.status === 'rejected') throw detailResult.reason;
      const preview = previewResult.value, detail = detailResult.value;
      // Derive the preview from the final detail image dimensions. Both outputs
      // stay bounded and encoding retries trade a little quality for size.
      return { preview, detail };
    } finally {
      detailCanvas.width = 0; detailCanvas.height = 0;
      previewCanvas.width = 0; previewCanvas.height = 0;
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
  const gpsCoordinates = meta ? exifGpsCoordinates(meta) : undefined;
  const gpsAccuracy = meta ? exifGpsAccuracy(meta) : undefined;
  return {
    hash: markedOriginalHash ?? calculatedHash,
    name: file.name.slice(0, 200),
    time: photoTime(meta?.DateTimeOriginal, meta?.OffsetTimeOriginal),
    ...(photoTime(meta?.DateTimeOriginal, meta?.OffsetTimeOriginal) !== null ? { timeSource: 'exif' as const } : {}),
    preview,
    detail,
    altitude: exifAltitude(meta),
    ...(gpsCoordinates ? { gpsCoordinates } : {}),
    ...(gpsAccuracy !== undefined ? { gpsAccuracy } : {}),
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
      const bitmap = await createImageBitmap(file, await boundedBitmapOptions(file));
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
