import { photoTime, matchPhoto } from './matching.ts';
import { exifAltitude, type PhotoAltitude } from './details.ts';
import {
  coordinate,
  metresBetween,
  type Coordinate,
} from '../navigation/types.ts';
import type { ManualTrack } from '../tracks/drawing.ts';
export type PhotoMetadata = {
  time: number | null;
  gps?: Coordinate;
  altitude?: PhotoAltitude;
  zone: string;
};
const cache = new WeakMap<File, Promise<PhotoMetadata>>();
/** Blob-aware exifr reader fetches metadata chunks before hashing or decoding the image. */
export function readPhotoMetadata(file: File): Promise<PhotoMetadata> {
  let request = cache.get(file);
  if (!request) {
    request = (async () => {
      const { parse } = await import('exifr');
      const options = {
        chunked: true,
        pick: [
          'DateTimeOriginal',
          'OffsetTimeOriginal',
          'GPSLatitude',
          'GPSLatitudeRef',
          'GPSLongitude',
          'GPSLongitudeRef',
          'GPSAltitude',
          'GPSAltitudeRef',
        ],
        reviveValues: false,
        translateValues: false,
      };
      const meta = await parse(file, options).catch(() => undefined);
      const gps = [meta?.longitude, meta?.latitude];
      return {
        time: photoTime(meta?.DateTimeOriginal, meta?.OffsetTimeOriginal),
        ...(coordinate(gps) && { gps }),
        altitude: exifAltitude(meta),
        zone: meta?.OffsetTimeOriginal
          ? `拍摄时区 ${meta.OffsetTimeOriginal}`
          : '无时区，按本机时区解释',
      };
    })();
    cache.set(file, request);
  }
  return request;
}
export function photoTimeRange(track: ManualTrack) {
  const times = (track.samples ?? [])
    .flat()
    .flatMap((p) =>
      typeof p.time === 'number' && Number.isFinite(p.time) ? [p.time] : [],
    );
  return times.length
    ? { start: Math.min(...times), end: Math.max(...times) }
    : null;
}
export function classifyPhoto(
  track: ManualTrack,
  meta: PhotoMetadata,
  tolerance: number,
) {
  const range = photoTimeRange(track),
    time = meta.time;
  if (time === null)
    return { status: 'pending' as const, reason: '缺少拍摄时间' };
  if (!range || time < range.start || time > range.end)
    return { status: 'skip' as const, reason: '不在本次行程时间内' };
  const match = matchPhoto(track, time);
  if (!match)
    return { status: 'pending' as const, reason: '时间位于断点或缺测区间' };
  if (!meta.gps)
    return {
      status: 'pending' as const,
      reason: '无照片坐标，可确认时间估算位置',
      match,
    };
  if (metresBetween(meta.gps, match.coordinates) > tolerance)
    return {
      status: 'pending' as const,
      reason: '照片位置与当时行程不一致',
      match,
    };
  return {
    status: 'matched' as const,
    reason: '时间、坐标一致',
    match: { ...match, coordinates: meta.gps },
  };
}
export async function photoHash(file: File) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    await file.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}
