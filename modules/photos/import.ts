import { readPhotoMetadata, photoHash, type PhotoMetadata } from './metadata';
import type { Coordinate } from '../navigation/types';
import { photoTime } from './matching';
import { imageMime } from './selection';
import { exifAltitude, type PhotoAltitude } from './details';
export type PhotoDraft = {
  hash: string;
  gps?: Coordinate;
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
  known?: PhotoMetadata,
  knownHash?: string,
): Promise<PhotoDraft> {
  if (file.size > 20 * 1024 * 1024) throw new Error('照片超过 20 MB');
  const mime = imageMime(file);
  if (!mime) throw new Error('请选择 JPEG、PNG、WebP 或设备可解码的 HEIC 照片');
  if (file.type !== mime) file = new File([file], file.name, { type: mime });
  stage('正在读取原图…');
  const meta = known ?? (await readPhotoMetadata(file));
  const hash = knownHash ?? (await photoHash(file));
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
  const { preview, detail } = await images();
  return { ...meta, hash, name: file.name.slice(0, 200), preview, detail };
}
