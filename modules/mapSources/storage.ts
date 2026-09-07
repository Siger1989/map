import {
  MAX_MAPS,
  MAX_STORAGE_BYTES,
  type StoredMap,
  type MapSource,
} from './types.ts';

let opening: Promise<IDBDatabase> | undefined;
function database() {
  if (!opening)
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('shantu-map-sources', 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('maps', { keyPath: 'id' });
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          opening = undefined;
        };
        resolve(request.result);
      };
      request.onerror = () => {
        opening = undefined;
        reject(new Error('无法打开本机地图库'));
      };
    });
  return opening;
}
function metadata(record: StoredMap): MapSource {
  const { blob: _blob, ...map } = record;
  return map;
}
export async function listMaps(): Promise<MapSource[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    // Cursor avoids holding every offline Blob in application state.
    const request = db.transaction('maps').objectStore('maps').openCursor();
    const result: MapSource[] = [];
    request.onsuccess = () => {
      const c = request.result;
      if (!c) return resolve(result);
      result.push(metadata(c.value));
      c.continue();
    };
    request.onerror = () => reject(new Error('读取地图库失败'));
  });
}
export async function readMap(id: string): Promise<StoredMap | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('maps').objectStore('maps').get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('读取离线地图失败'));
  });
}
export async function addMaps(records: StoredMap[]): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('maps', 'readwrite');
    const store = tx.objectStore('maps');
    let count = records.length,
      bytes = records.reduce((n, m) => n + m.bytes, 0),
      reason = '地图保存失败，可能本机空间不足';
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (c) {
        count++;
        bytes += c.value.bytes;
        c.continue();
        return;
      }
      if (count > MAX_MAPS || bytes > MAX_STORAGE_BYTES) {
        reason = '地图库最多 20 项 / 256 MB，请先移除不需要的地图';
        tx.abort();
        return;
      }
      for (const record of records) store.add(record);
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(new Error(reason));
    tx.onerror = () => {};
  });
}
export async function removeMap(id: string): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('maps', 'readwrite');
    tx.objectStore('maps').delete(id);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(new Error('移除地图失败'));
  });
}
