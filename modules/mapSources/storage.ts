import {
  MAX_MAPS,
  MAX_STORAGE_BYTES,
  type MapDraft,
  type StoredMap,
  type MapSource,
  validateStoredMap,
} from './types.ts';
import { existingMapIndexes, sameOnlineMap } from './importReview.ts';
import type { DefaultSeedBundle } from './defaultSeeds.ts';

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
const DEFAULTS_STATE_VERSION = 1;
const DEFAULTS_FINGERPRINTS = 'processedSeedFingerprintsV1';

async function defaultMapFingerprint(draft: MapDraft): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('无法安全记录默认图源状态');
  // Keep this tuple aligned with sameOnlineMap so imported and seeded maps dedupe identically.
  const value = JSON.stringify([
    draft.tiles,
    draft.scheme ?? 'xyz',
    draft.tileSize,
    draft.minzoom,
    draft.maxzoom,
    draft.datum ?? 'wgs84',
    draft.ovmap?.layers,
  ]);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
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
/** Read full persisted rows verbatim for an exact multi-store rollback snapshot. */
export async function snapshotMapSources(): Promise<StoredMap[]> {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const request=db.transaction('maps').objectStore('maps').getAll();
    request.onsuccess=()=>resolve(request.result as StoredMap[]);
    request.onerror=()=>reject(new Error('读取图源回滚快照失败'));
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

/** Exact-ID sync in one IndexedDB transaction; receiver-only maps remain untouched. */
export async function syncMapSources(incoming: StoredMap[]): Promise<StoredMap[]> {
  const validated = incoming.map(validateStoredMap);
  if (new Set(validated.map((map)=>map.id)).size !== validated.length) throw new Error('图源同步清单含重复编号');
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('maps','readwrite'), store=tx.objectStore('maps');
    let output: StoredMap[]=[], reason='图源同步失败，可能本机空间不足';
    const request=store.getAll();
    request.onsuccess=()=>{
      const merged=new Map<string,StoredMap>((request.result as StoredMap[]).map((map)=>[map.id,map]));
      for(const map of validated) merged.set(map.id,map);
      output=[...merged.values()];
      const bytes=output.reduce((n,map)=>n+map.bytes,0);
      if(output.length>MAX_MAPS||bytes>MAX_STORAGE_BYTES){reason=`地图库最多 ${MAX_MAPS} 项 / 256 MB`;tx.abort();return;}
      for(const map of validated) store.put(map);
    };
    request.onerror=()=>{reason='读取本机地图库失败';tx.abort();};
    tx.oncomplete=()=>resolve(output);
    tx.onabort=tx.onerror=()=>reject(new Error(reason));
  });
}

/** Exact snapshot restoration in one transaction; it intentionally removes later additions. */
export async function replaceMapSources(records: StoredMap[]): Promise<void> {
  const validated=records.map(validateStoredMap);
  if(new Set(validated.map((map)=>map.id)).size!==validated.length) throw new Error('图源恢复清单含重复编号');
  const bytes=validated.reduce((n,map)=>n+map.bytes,0);
  if(validated.length>MAX_MAPS||bytes>MAX_STORAGE_BYTES) throw new Error('图源恢复清单超过100项 / 256MB');
  const db=await database();
  await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction('maps','readwrite'),store=tx.objectStore('maps');
    let reason='图源恢复失败';
    const request=store.clear();
    request.onsuccess=()=>{for(const map of validated) store.put(map);};
    request.onerror=()=>{reason='清空图源恢复目标失败';tx.abort();};
    tx.oncomplete=()=>resolve();
    tx.onabort=tx.onerror=()=>reject(new Error(reason));
  });
}
/** Exact restore for rows read from this database, even if an older row fails current validation. */
export async function restoreMapSourceSnapshot(records: StoredMap[]): Promise<void> {
  const db=await database();
  await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction('maps','readwrite'),store=tx.objectStore('maps');
    let reason='图源回滚恢复失败';
    const request=store.clear();
    request.onsuccess=()=>{for(const record of records)store.put(record);};
    request.onerror=()=>{reason='清理图源回滚目标失败';tx.abort();};
    tx.oncomplete=()=>resolve();
    tx.onabort=tx.onerror=()=>reject(new Error(reason));
  });
}

/** Add each built-in map once without overwriting user maps or reviving deleted defaults. */
export async function ensureDefaultMaps(seed: MapDraft[] | DefaultSeedBundle): Promise<boolean> {
  const drafts = Array.isArray(seed) ? seed : seed.drafts;
  const legacyMapCount = Array.isArray(seed) ? drafts.length : (seed as DefaultSeedBundle).legacyMapCount;
  if (!Number.isInteger(legacyMapCount) || legacyMapCount < 0 || legacyMapCount > drafts.length)
    throw new Error('内置图源旧版数量无效');
  const fingerprints = await Promise.all(drafts.map(defaultMapFingerprint));
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['maps', 'meta'], 'readwrite');
    const maps = tx.objectStore('maps');
    const meta = tx.objectStore('meta');
    let result = false;
    let reason = '默认图源保存失败，可能本机空间不足';
    let finished = false;
    let markerDone = false;
    let mapsDone = false;
    let previousMarker: Record<string, unknown> | undefined;
    const saved: MapSource[] = [];
    const initialize = () => {
      if (!markerDone || !mapsDone || finished) return;
      const stateVersion = previousMarker?.seedStateVersion;
      if (stateVersion !== undefined && stateVersion !== DEFAULTS_STATE_VERSION) {
        reason = '默认图源状态版本不受支持';
        tx.abort();
        return;
      }
      const storedFingerprints = previousMarker?.[DEFAULTS_FINGERPRINTS];
      const hasCurrentState = stateVersion === DEFAULTS_STATE_VERSION;
      if (hasCurrentState && (!Array.isArray(storedFingerprints) || storedFingerprints.some((value) => typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)))) {
        reason = '默认图源处理记录无效';
        tx.abort();
        return;
      }
      const processed = new Set<string>(hasCurrentState ? storedFingerprints as string[] : []);
      // The legacy boolean marker proves the old manifest completed. Its prefix is
      // the only recoverable history; never replay those maps during migration.
      if (previousMarker?.value === true && !hasCurrentState) {
        for (const fingerprint of fingerprints.slice(0, legacyMapCount)) processed.add(fingerprint);
      }
      const accepted: MapDraft[] = [];
      for (let index = 0; index < drafts.length; index++) {
        const fingerprint = fingerprints[index];
        if (processed.has(fingerprint)) continue;
        const duplicate = [...saved, ...accepted].some((map) => sameOnlineMap(drafts[index], map));
        if (!duplicate) accepted.push(drafts[index]);
        processed.add(fingerprint);
      }
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
      meta.put({
        key: DEFAULTS_KEY,
        value: true,
        seedStateVersion: DEFAULTS_STATE_VERSION,
        [DEFAULTS_FINGERPRINTS]: [...processed].sort(),
      });
      result = additions.length > 0;
    };
    const marker = meta.get(DEFAULTS_KEY);
    marker.onsuccess = () => {
      previousMarker = marker.result as Record<string, unknown> | undefined;
      markerDone = true;
      initialize();
    };
    marker.onerror = () => { reason = '读取默认图源状态失败'; tx.abort(); };
    const read = maps.openCursor();
    read.onsuccess = () => {
      const cursor = read.result;
      if (cursor) {
        saved.push(metadata(cursor.value as StoredMap));
        cursor.continue();
        return;
      }
      mapsDone = true;
      initialize();
    };
    read.onerror = () => { reason = '读取本机地图库失败'; tx.abort(); };
    tx.oncomplete = () => { finished = true; resolve(result); };
    tx.onabort = () => { finished = true; reject(new Error(reason)); };
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
