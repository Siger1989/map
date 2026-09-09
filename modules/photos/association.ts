import type { Annotation } from '../annotations/data.ts';
import type { PhotoDraft } from './import.ts';
import type { TripPhoto } from './storage.ts';

export function markerPhoto(
  draft: PhotoDraft,
  marker: Annotation,
  captureTime: number,
): TripPhoto {
  if (!Number.isFinite(captureTime) || captureTime <= 0)
    throw new Error('拍照时间无效，请重试');
  return {
    id: `marker:${marker.id}:${draft.hash}`,
    name: draft.name,
    title: marker.name || '标记照片',
    annotationId: marker.id,
    trackId: '',
    trackName: marker.name || '标记点',
    kind: 'annotation',
    time: draft.time ?? captureTime,
    timeSource: draft.time === null ? 'camera' : 'exif',
    coordinates: [...marker.coordinates],
    preview: draft.preview,
    detail: draft.detail,
    ...(draft.altitude && { altitude: draft.altitude }),
  };
}
export function photoLocationLabel(photo: Pick<TripPhoto, 'kind'>) {
  return photo.kind === 'annotation'
    ? '拍照时标记点位置'
    : photo.kind === 'interpolated'
      ? '轨迹时间估算位置'
      : '对应轨迹点';
}
export function photosForMarker<T extends TripPhoto>(
  photos: T[],
  id: string,
): T[] {
  return photos
    .filter((p) => p.kind === 'annotation' && p.annotationId === id)
    .sort((a, b) => b.time - a.time);
}

/** An attached photo has one map identity: its live marker. Original capture metadata is retained. */
export function mapPhotos<T extends TripPhoto>(
  photos: T[],
  markers: Annotation[],
): T[] {
  const byId = new Map(markers.map((a) => [a.id, a]));
  return photos.flatMap((photo) => {
    if (photo.kind !== 'annotation') return [photo];
    const marker = photo.annotationId
      ? byId.get(photo.annotationId)
      : undefined;
    return marker?.visible
      ? [
          {
            ...photo,
            coordinates: [...marker.coordinates],
            trackName: marker.name,
          } as T,
        ]
      : [];
  });
}
