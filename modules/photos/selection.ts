export const PHOTO_ACCEPT =
  'image/*,.heic,.heif,.avif,.jpg,.jpeg,.png,.webp,.gif,.bmp';
// The Android bridge routes this input to the system directory picker.
export const PHOTO_FOLDER_ACCEPT = 'application/x-guanyun-photo-folder';
export const GPS_PHOTO_ACCEPT = 'application/x-shantu-gps-photo';
export const GPS_PHOTO_PICKER_ACCEPT = `${PHOTO_ACCEPT},${GPS_PHOTO_ACCEPT}`;
export const GPS_PHOTO_FOLDER_ACCEPT = `${PHOTO_FOLDER_ACCEPT},${GPS_PHOTO_ACCEPT}`;
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  gif: 'image/gif',
  bmp: 'image/bmp',
  dib: 'image/bmp',
};
const SUPPORTED_MIME = new Set(Object.values(MIME_BY_EXTENSION));
export function imageMime(file: { name: string; type: string }) {
  const extension = /\.([^.]+)$/.exec(file.name)?.[1].toLowerCase();
  const byExtension = MIME_BY_EXTENSION[extension ?? ''];
  const byType = file.type.trim().toLowerCase().split(';', 1)[0];
  // Folder scans skip explicitly identified documents/scripts even if renamed .jpg.
  if (byType.startsWith('text/') || /^(application\/(?:javascript|ecmascript|json|pdf|zip))$/.test(byType)) return null;
  // Keep a recognized MIME when available, but trust a known photo extension
  // when a provider reports a generic or stale type (common with camera roll).
  if (SUPPORTED_MIME.has(byType)) return byType;
  if (byExtension) return byExtension;
  return null;
}
export function nativeImportOriginalHash(meta: Record<string, unknown> | undefined, mime: string, bytes: ArrayBuffer) {
  const hash = meta?.ImageUniqueID;
  const marker = meta?.UserComment ?? meta?.userComment;
  const header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 3));
  const isJpeg = header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  if (mime !== 'image/jpeg' || !isJpeg) return null;
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/i.test(hash)) return null;
  const comment = typeof marker === 'string' ? marker : ArrayBuffer.isView(marker) && marker.byteLength <= 256
    ? new TextDecoder().decode(Uint8Array.from(new Uint8Array(marker.buffer, marker.byteOffset, marker.byteLength))) : '';
  const markerText = comment.replace(/\0/g, '').trim();
  const markedHash = /^(?:ASCII)?\s*SHANTU_NATIVE_PHOTO_V1:([a-f0-9]{64})$/i.exec(markerText)?.[1];
  if (markedHash?.toLowerCase() !== hash.toLowerCase()) return null;
  return hash.toLowerCase();
}
export function selectPhotoFiles<T extends { name: string; type: string }>(
  files: T[],
  folder: boolean,
) {
  const images = folder ? files.filter((file) => imageMime(file)) : files;
  const limit = folder ? 200 : 30;
  if (!images.length)
    throw new Error('文件夹中没有支持的照片，请选择存放原片的具体目录');
  if (images.length > limit)
    throw new Error(
      folder
        ? '文件夹超过 200 张照片，请选择更小的行程目录或分批选照片'
        : '每次最多选择 30 张，请分批添加',
    );
  return images;
}
