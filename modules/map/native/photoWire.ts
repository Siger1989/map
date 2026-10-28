import type { VisiblePhoto } from '../../photos/storage.ts';
import type { NativeMapPhoto } from './types.ts';

/** Builds the native map-only photo DTO without mutating the stored/viewer photo. */
export function serializeNativeMapPhoto(
  photo: VisiblePhoto,
  previewBase64: string,
  groupIds: string[],
): NativeMapPhoto {
  const { preview: _preview, url: _url, detail: _original, ...metadata } = photo;
  return { ...metadata, previewBase64, groupIds: [...groupIds], groupCount: groupIds.length };
}
