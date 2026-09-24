import { coordinate, type Coordinate } from '../navigation/types.ts';
import { validDetails, type PhotoDetails } from './details.ts';
export type TripPhoto = {
  id: string;
  name: string;
  trackId: string;
  trackName: string;
  time: number;
  coordinates: Coordinate;
  kind: 'point' | 'interpolated' | 'annotation';
  annotationId?: string;
  timeSource?: 'exif' | 'camera';
  timeSourceDetail?: 'return-estimate' | 'manual';
  locationSource?: 'track' | 'camera';
  locationAccuracy?: number;
  locationTimeSource?: 'capture' | 'return';
  preview: Blob;
} & PhotoDetails;
export type VisiblePhoto = TripPhoto & {
  url: string;
  mapIcon?: string;
  mapColor?: string;
};
const MAX_PHOTOS = 200,
  MAX_BYTES = 40 * 1024 * 1024;
let database: Promise<IDBDatabase> | null = null;
function open() {
  if (!database)
    database = new Promise<IDBDatabase>((resolve, reject) => {
      // 0.2.36 upgraded this database to v3 but retained full photos here.
      // Open the existing version when rolling back; never downgrade or erase it.
      const r = indexedDB.open('guanyun-trip-photos');
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains('photos'))
          r.result.createObjectStore('photos', { keyPath: 'id' });
      };
      r.onsuccess = () => {
        r.result.onversionchange = () => {
          r.result.close();
          database = null;
        };
        resolve(r.result);
      };
      r.onerror = () => {
        database = null;
        reject(r.error);
      };
    });
  return database;
}
export function validPhoto(p: TripPhoto) {
  return (
    !!p &&
    typeof p.id === 'string' &&
    p.id.length <= 250 &&
    typeof p.name === 'string' &&
    p.name.length <= 200 &&
    typeof p.trackId === 'string' &&
    typeof p.trackName === 'string' &&
    Number.isFinite(p.time) &&
    coordinate(p.coordinates) &&
    ['point', 'interpolated', 'annotation'].includes(p.kind) &&
    (p.kind !== 'annotation' ||
      (typeof p.annotationId === 'string' &&
        p.annotationId.length > 0 &&
        p.annotationId.length <= 100 &&
        p.trackId === '')) &&
    (p.timeSource === undefined || ['exif', 'camera'].includes(p.timeSource)) &&
    (p.timeSourceDetail === undefined || ['return-estimate', 'manual'].includes(p.timeSourceDetail)) &&
    (p.locationSource === undefined || ['track', 'camera'].includes(p.locationSource)) &&
    (p.locationTimeSource === undefined || ['capture', 'return'].includes(p.locationTimeSource)) &&
    (p.locationAccuracy === undefined || (Number.isFinite(p.locationAccuracy) && p.locationAccuracy >= 0 && p.locationAccuracy <= 100000)) &&
    p.preview instanceof Blob &&
    p.preview.type === 'image/jpeg' &&
    p.preview.size <= 1024 * 1024 &&
    validDetails(p)
  );
}
export async function readPhotos(): Promise<TripPhoto[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = db.transaction('photos').objectStore('photos').getAll();
    r.onsuccess = () =>
      resolve(
        (r.result as TripPhoto[]).filter(validPhoto).slice(0, MAX_PHOTOS),
      );
    r.onerror = () => reject(r.error);
  });
}
export async function writePhotos(add: TripPhoto[], remove?: string) {
  if (add.some((p) => !validPhoto(p))) throw new Error('照片预览数据无效');
  const db = await open();
  return new Promise<TripPhoto[]>((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite'),
      table = tx.objectStore('photos');
    let committed: TripPhoto[] = [];
    let reason = '照片保存失败，请检查可用存储';
    const r = table.getAll();
    r.onsuccess = () => {
      const all = new Map<string, TripPhoto>(
        (r.result as TripPhoto[]).map((p) => [p.id, p]),
      );
      if (remove) all.delete(remove);
      const merged = add.map((p) => {
        const old = all.get(p.id);
        if (!old) return p;
        // Reimport improves image/position data but preserves the user's edits.
        const same =
          old.time === p.time &&
          old.coordinates.join() === p.coordinates.join();
        return {
          ...old,
          ...p,
          title: old.title,
          note: old.note,
          rotation: old.rotation,
          strokes: old.strokes,
          weather: same ? old.weather : undefined,
          weatherError: same ? old.weatherError : undefined,
        };
      });
      for (const p of merged) all.set(p.id, p);
      if (
        all.size > MAX_PHOTOS ||
        [...all.values()].reduce((n, p) => n + p.preview.size, 0) > MAX_BYTES ||
        [...all.values()].reduce(
          (n, p) => n + p.preview.size + (p.detail?.size ?? 0),
          0,
        ) >
          200 * 1024 * 1024
      ) {
        reason = '照片最多200张，预览40MB / 含清晰副本200MB，请先移除部分照片';
        tx.abort();
        return;
      }
      committed = [...all.values()].filter(validPhoto);
      if (remove) table.delete(remove);
      for (const p of merged) table.put(p);
    };
    tx.oncomplete = () => resolve(committed);
    tx.onabort = tx.onerror = () => reject(new Error(reason));
  });
}
/** Keep photos attached when recording deduplication resolves to an existing track ID. */
export async function remapPhotoTrack(from: string, to: string) {
  if (!from || !to || from === to) return;
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite'),
      table = tx.objectStore('photos'),
      request = table.getAll();
    request.onsuccess = () => {
      for (const photo of request.result as TripPhoto[]) {
        if (photo.kind !== 'annotation' && photo.trackId === from)
          table.put({ ...photo, trackId: to });
      }
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(new Error('照片轨迹关联保存失败，记录已保留，请重试'));
  });
}
/** Atomic patch: background weather must never undo edits or resurrect a removed photo. */
export async function patchPhoto(
  id: string,
  patch: Omit<PhotoDetails, 'detail'>,
  expected?: { time: number; coordinates: Coordinate },
) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite'),
      table = tx.objectStore('photos'),
      r = table.get(id);
    r.onsuccess = () => {
      const old = r.result as TripPhoto | undefined;
      if (
        !old ||
        (expected &&
          (old.time !== expected.time ||
            old.coordinates.join() !== expected.coordinates.join()))
      )
        return;
      const next = { ...old, ...patch };
      if (!validPhoto(next)) {
        tx.abort();
        return;
      }
      table.put(next);
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(new Error('照片信息保存失败，请检查可用存储'));
  });
}
