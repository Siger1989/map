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
  positionSource?: 'gps' | 'time' | 'manual';
  photoCoordinates?: Coordinate;
  annotationId?: string;
  timeSource?: 'exif' | 'camera';
  preview: Blob;
} & PhotoDetails;
export type VisiblePhoto = TripPhoto & {
  url: string;
  assetPending?: boolean;
  previewSize?: number;
  detailSize?: number;
  mapIcon?: string;
  mapColor?: string;
};
const MAX_PHOTOS = 200,
  MAX_BYTES = 40 * 1024 * 1024;
let database: Promise<IDBDatabase> | null = null;
function open() {
  if (!database)
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('guanyun-trip-photos', 3);
      r.onupgradeneeded = () => {
        const db = r.result,
          tx = r.transaction!;
        if (!db.objectStoreNames.contains('photos'))
          db.createObjectStore('photos', { keyPath: 'id' });
        const exists = db.objectStoreNames.contains('photo-index');
        const index = exists
          ? tx.objectStore('photo-index')
          : db.createObjectStore('photo-index', { keyPath: 'id' });
        if (!exists) {
          index.createIndex('trackId', 'trackId');
          index.createIndex('time', 'time');
        }
        const previews = db.objectStoreNames.contains('photo-previews')
          ? tx.objectStore('photo-previews')
          : db.createObjectStore('photo-previews', { keyPath: 'id' });
        const cursor = tx.objectStore('photos').openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (c) {
            if (validPhoto(c.value)) {
              index.put(indexRecord(c.value));
              previews.put({ id: c.value.id, preview: c.value.preview });
            }
            c.continue();
          }
        };
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
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
        ['photos', 'photo-index', 'photo-previews'],
        'readwrite',
      ),
      table = tx.objectStore('photos'),
      index = tx.objectStore('photo-index');
    let reason = '照片保存失败，请检查可用存储';
    const all = index.getAll();
    all.onsuccess = () => {
      const sizes = new Map<string, PhotoIndex>(
        (all.result as PhotoIndex[]).map((p) => [p.id, p]),
      );
      if (remove) sizes.delete(remove);
      for (const p of add) sizes.set(p.id, indexRecord(p));
      if (
        sizes.size > MAX_PHOTOS ||
        [...sizes.values()].reduce((n, p) => n + p.previewSize, 0) >
          MAX_BYTES ||
        [...sizes.values()].reduce(
          (n, p) => n + p.previewSize + p.detailSize,
          0,
        ) >
          200 * 1024 * 1024
      ) {
        reason = '照片最多200张，预览40MB / 含清晰副本200MB，请先移除部分照片';
        tx.abort();
        return;
      }
      if (remove) {
        table.delete(remove);
        index.delete(remove);
        tx.objectStore('photo-previews').delete(remove);
      }
      for (const p of add) {
        const get = table.get(p.id);
        get.onsuccess = () => {
          const old = get.result as TripPhoto | undefined;
          const same =
            old &&
            old.time === p.time &&
            old.coordinates.join() === p.coordinates.join();
          const merged = old
            ? {
                ...old,
                ...p,
                ...(old.positionSource === 'manual' && {
                  coordinates: old.coordinates,
                  positionSource: old.positionSource,
                  time: old.time,
                  kind: old.kind,
                }),
                title: old.title,
                note: old.note,
                rotation: old.rotation,
                strokes: old.strokes,
                weather:
                  same || old.positionSource === 'manual'
                    ? old.weather
                    : undefined,
                weatherError:
                  same || old.positionSource === 'manual'
                    ? old.weatherError
                    : undefined,
              }
            : p;
          table.put(merged);
          index.put(indexRecord(merged));
          tx.objectStore('photo-previews').put({
            id: merged.id,
            preview: merged.preview,
          });
        };
      }
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(new Error(reason));
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
    const tx = db.transaction(['photos', 'photo-index'], 'readwrite'),
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
      tx.objectStore('photo-index').put(indexRecord(next));
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(new Error('照片信息保存失败，请检查可用存储'));
  });
}

export type PhotoIndex = Omit<TripPhoto, 'preview' | 'detail'> & {
  previewSize: number;
  detailSize: number;
};
function indexRecord(photo: TripPhoto): PhotoIndex {
  const { preview, detail, ...meta } = photo;
  return { ...meta, previewSize: preview.size, detailSize: detail?.size ?? 0 };
}
export async function readPhotoIndex(trackId?: string): Promise<PhotoIndex[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const table = db.transaction('photo-index').objectStore('photo-index');
    const r =
      trackId === undefined
        ? table.getAll()
        : table.index('trackId').getAll(trackId);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function readPhotoAsset(id: string): Promise<TripPhoto> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = db.transaction('photos').objectStore('photos').get(id);
    r.onsuccess = () =>
      validPhoto(r.result)
        ? resolve(r.result)
        : reject(new Error('照片已删除或副本不可读取'));
    r.onerror = () => reject(r.error);
  });
}
export async function resolvePhotoAssets(
  photos: TripPhoto[],
): Promise<TripPhoto[]> {
  return Promise.all(
    photos.map((p) => (p.preview.size ? p : readPhotoAsset(p.id))),
  );
}

export async function readPhotoPreview(id: string): Promise<Blob> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = db
      .transaction('photo-previews')
      .objectStore('photo-previews')
      .get(id);
    r.onsuccess = () =>
      r.result?.preview instanceof Blob
        ? resolve(r.result.preview)
        : reject(new Error('预览不可用'));
    r.onerror = () => reject(r.error);
  });
}
