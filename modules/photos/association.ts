import type { Annotation } from '../annotations/data.ts';
import type { PhotoDraft } from './import.ts';
import type { TripPhoto } from './storage.ts';
import { coordinate, type Coordinate } from '../navigation/types.ts';
import type { PositionFix } from '../position/types.ts';

/** Only a successful camera-input result may use its capture-session time as a fallback. */
export function cameraDraftTime(draft: PhotoDraft, capturedAt?: number): PhotoDraft {
  return draft.time !== null || !Number.isFinite(capturedAt) || !capturedAt
    ? draft
    : { ...draft, time: capturedAt, timeSource: 'camera', timeSourceDetail: 'return-estimate', zone: '相机返回时间（估计）' };
}

export function reliableCaptureLocation(
  fix: PositionFix | null | undefined,
  photoTime: number | null,
  now = Date.now(),
  tolerance = 30000,
): { coordinates: Coordinate; accuracy: number } | null {
  if (
    !fix || photoTime === null || !Number.isFinite(photoTime) ||
    !coordinate(fix.coordinates) || !Number.isFinite(fix.accuracy) ||
    fix.accuracy < 0 || fix.accuracy > 80 || !Number.isFinite(fix.timestamp) ||
    now - fix.timestamp < 0 || now - fix.timestamp >= 30000 ||
    Math.abs(fix.timestamp - photoTime) > tolerance
  ) return null;
  return { coordinates: [...fix.coordinates], accuracy: fix.accuracy };
}

export function cameraLocationFallbackAllowed(
  draft: PhotoDraft,
  shift: number,
  trackId: string,
) {
  return !!(
    draft.cameraCoordinates &&
    draft.cameraTrackId === trackId &&
    shift === 0 &&
    draft.timeSourceDetail !== 'manual'
  );
}

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
export function photoLocationLabel(photo: Pick<TripPhoto, 'kind' | 'locationSource' | 'locationTimeSource'>) {
  return photo.locationSource === 'camera'
    ? photo.locationTimeSource === 'return' ? '返回时定位' : '拍摄时定位'
    : photo.kind === 'annotation'
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
            mapIcon: marker.icon,
            mapColor: marker.color,
          } as T,
        ]
      : [];
  });
}
