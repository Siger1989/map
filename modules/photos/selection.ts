export const PHOTO_ACCEPT =
  'image/jpeg,image/png,image/webp,image/heic,image/heif';
// The Android bridge routes this input to the system directory picker.
export const PHOTO_FOLDER_ACCEPT = 'application/x-guanyun-photo-folder';
export function imageMime(file: { name: string; type: string }) {
  if (/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type))
    return file.type.toLowerCase();
  if (file.type && file.type !== 'application/octet-stream') return null;
  const extension = /\.([^.]+)$/.exec(file.name)?.[1].toLowerCase();
  return (
    (
      {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        heic: 'image/heic',
        heif: 'image/heif',
      } as Record<string, string>
    )[extension ?? ''] ?? null
  );
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
