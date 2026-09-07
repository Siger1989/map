import { coordinate, type Coordinate } from '../navigation/types';
export type TripPhoto = {
  id: string;
  name: string;
  trackId: string;
  trackName: string;
  time: number;
  coordinates: Coordinate;
  kind: 'point' | 'interpolated';
  preview: Blob;
};
export type VisiblePhoto = TripPhoto & { url: string };
const MAX_PHOTOS = 200,
  MAX_BYTES = 40 * 1024 * 1024;
let database: Promise<IDBDatabase> | null = null;
function open() {
  if (!database)
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('guanyun-trip-photos', 1);
      r.onupgradeneeded = () =>
        r.result.createObjectStore('photos', { keyPath: 'id' });
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
    ['point', 'interpolated'].includes(p.kind) &&
    p.preview instanceof Blob &&
    p.preview.type === 'image/jpeg' &&
    p.preview.size <= 1024 * 1024
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
    const tx = db.transaction('photos', 'readwrite'),
      table = tx.objectStore('photos');
    let reason = '照片保存失败，请检查可用存储';
    const r = table.getAll();
    r.onsuccess = () => {
      const all = new Map<string, TripPhoto>(
        (r.result as TripPhoto[]).map((p) => [p.id, p]),
      );
      if (remove) all.delete(remove);
      for (const p of add) all.set(p.id, p);
      if (
        all.size > MAX_PHOTOS ||
        [...all.values()].reduce((n, p) => n + p.preview.size, 0) > MAX_BYTES
      ) {
        reason = '照片最多 200 张 / 40 MB，请先移除部分预览';
        tx.abort();
        return;
      }
      if (remove) table.delete(remove);
      for (const p of add) table.put(p);
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(new Error(reason));
  });
}
