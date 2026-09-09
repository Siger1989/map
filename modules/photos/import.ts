import { photoTime } from './matching';
import { imageMime } from './selection';
import { exifAltitude, type PhotoAltitude } from './details';
export type PhotoDraft = {
  hash: string;
  name: string;
  time: number | null;
  preview: Blob;
  detail: Blob;
  altitude?: PhotoAltitude;
  zone: string;
};
export async function readPhoto(
  file: File,
  stage: (message: string) => void = () => {},
): Promise<PhotoDraft> {
  if (file.size > 20 * 1024 * 1024) throw new Error('照片超过 20 MB');
  const mime = imageMime(file);
  if (!mime) throw new Error('请选择 JPEG、PNG、WebP 或设备可解码的 HEIC 照片');
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
            ],
            reviveValues: false,
            translateValues: false,
          }),
        )
        .catch(() => undefined),
      crypto.subtle.digest('SHA-256', buffer),
    ]);
    return { meta: meta as Record<string, unknown> | undefined, digest };
  };
  const images = async () => {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: 'from-image',
    });
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
        bitmap,
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
      const [preview, detail] = await Promise.all([
        encode(previewCanvas, 0.78),
        encode(detailCanvas, 0.86),
      ]);
      if (detail.size > 4 * 1024 * 1024)
        throw new Error('清晰副本超过4MB，请先缩小此照片');
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
  const { meta, digest } = metadataResult.value,
    { preview, detail } = imageResult.value;
  return {
    hash: [...new Uint8Array(digest)]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join(''),
    name: file.name.slice(0, 200),
    time: photoTime(meta?.DateTimeOriginal, meta?.OffsetTimeOriginal),
    preview,
    detail,
    altitude: exifAltitude(meta),
    zone: meta?.OffsetTimeOriginal
      ? `拍摄时区 ${meta.OffsetTimeOriginal}`
      : '无时区信息，按本机时区解释',
  };
}
