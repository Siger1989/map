import type { TripPackage } from './offline';

const INDEX = 'guanyun.trips.v1';
const DB = 'shantu-trip-manifests';
const hydrated = new Map<string, string[]>();
const INLINE_LIMIT = 1000;
let database: Promise<IDBDatabase> | undefined;

function openDatabase() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('manifests');
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { database = undefined; reject(new Error('缓存任务清单无法打开，请检查本机存储')); };
  });
}

async function manifestRequest<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction('manifests', mode);
    const request = action(transaction.objectStore('manifests'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = transaction.onerror = () => reject(new Error('缓存任务清单保存或读取失败，请检查本机存储'));
  });
}

function index(): TripPackage[] {
  try { const data = JSON.parse(localStorage.getItem(INDEX) ?? '[]'); return Array.isArray(data) ? data : []; }
  catch { return []; }
}

export function tripPackages(): TripPackage[] {
  return index().map(trip => trip.manifest && hydrated.has(trip.id)
    ? { ...trip, urls: hydrated.get(trip.id)! } : trip);
}

/** Frequent progress changes only rewrite small metadata, never a large URL list. */
export function putTrip(trip: TripPackage) {
  const list = index();
  const position = list.findIndex(item => item.id === trip.id);
  const external = trip.manifest || trip.urls.length > INLINE_LIMIT;
  if (external && !hydrated.has(trip.id)) throw new Error('缓存清单尚未保存，请重新准备任务');
  const record = external
    ? { ...trip, manifest: true, urlCount: trip.urlCount ?? trip.urls.length, urls: [] }
    : trip;
  if (position < 0) list.push(record); else list[position] = record;
  localStorage.setItem(INDEX, JSON.stringify(list));
}

/** Remove only the compact progress record; large URL manifests stay in IndexedDB. */
export function removeTripIndex(id: string): void {
  localStorage.setItem(INDEX, JSON.stringify(index().filter(trip => trip.id !== id)));
}

export async function persistTripManifest(trip: TripPackage): Promise<void> {
  if (trip.urls.length > INLINE_LIMIT) {
    await manifestRequest('readwrite', store => store.put(trip.urls, trip.id));
    hydrated.set(trip.id, trip.urls);
    trip.manifest = true;
    trip.urlCount = trip.urls.length;
  }
  putTrip(trip);
}

export async function loadTripManifest(trip: TripPackage): Promise<TripPackage> {
  if (!trip.manifest) return trip;
  let urls = hydrated.get(trip.id);
  if (!urls) {
    const saved = await manifestRequest<unknown>('readonly', store => store.get(trip.id));
    if (!Array.isArray(saved) || saved.length !== trip.urlCount || !saved.every(url => typeof url === 'string'))
      throw new Error('缓存任务清单缺失或损坏，请删除该缓存包后重新下载');
    urls = saved;
    hydrated.set(trip.id, urls);
  }
  return { ...trip, urls };
}

export async function hydrateTripPackages(): Promise<TripPackage[]> {
  return Promise.all(tripPackages().map(loadTripManifest));
}

export async function removeTripManifest(id: string): Promise<void> {
  await manifestRequest('readwrite', store => store.delete(id));
  hydrated.delete(id);
}

export async function packageUrls(id: string): Promise<string[]> {
  const trip = tripPackages().find(item => item.id === id);
  return trip ? (await loadTripManifest(trip)).urls : [];
}
