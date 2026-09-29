import {
  MAX_MAPS,
  MAX_STORAGE_BYTES,
  type MapDraft,
  type StoredMap,
  type MapSource,
} from './types.ts';
import { existingMapIndexes } from './importReview.ts';

let opening: Promise<IDBDatabase> | undefined;
function database() {
  if (!opening)
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('shantu-map-sources', 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('maps'))
          db.createObjectStore('maps', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta'))
          db.createObjectStore('meta', { keyPath: 'key' });
      };
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
const DEFAULTS_KEY = 'default-map-sources-initialized';
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
        reason = `地图库最多 ${MAX_MAPS} 项 / 256 MB，请先移除不需要的地图`;
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

/** Seed built-in maps once. Map rows and the completion marker commit together. */
export async function ensureDefaultMaps(drafts: MapDraft[]): Promise<boolean> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['maps', 'meta'], 'readwrite');
    const maps = tx.objectStore('maps');
    const meta = tx.objectStore('meta');
    let result = false;
    let reason = '默认图源保存失败，可能本机空间不足';
    const marker = meta.get(DEFAULTS_KEY);
    marker.onsuccess = () => {
      if (marker.result?.value === true) return;
      const saved: MapSource[] = [];
      const read = maps.openCursor();
      read.onsuccess = () => {
        const cursor = read.result;
        if (cursor) {
          saved.push(metadata(cursor.value as StoredMap));
          cursor.continue();
          return;
        }
        const duplicates = existingMapIndexes(drafts, saved);
        const accepted = drafts.filter((_draft, index) => !duplicates.has(index));
        const additions: StoredMap[] = accepted.map((draft) => ({
          ...draft,
          id: crypto.randomUUID(),
          bytes: new TextEncoder().encode(JSON.stringify(draft)).byteLength,
        }));
        const count = saved.length + additions.length;
        const bytes = saved.reduce((total, item) => total + item.bytes, 0) + additions.reduce((total, item) => total + item.bytes, 0);
        if (count > MAX_MAPS || bytes > MAX_STORAGE_BYTES) {
          reason = `默认图源超出地图库容量上限（${MAX_MAPS} 项 / 256 MB）`;
          tx.abort();
          return;
        }
        for (const record of additions) maps.add(record);
        meta.put({ key: DEFAULTS_KEY, value: true });
        result = additions.length > 0;
      };
    };
    tx.oncomplete = () => resolve(result);
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
