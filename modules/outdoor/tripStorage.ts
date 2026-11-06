import type { TripPackage } from './offline';

const INDEX = 'guanyun.trips.v1';
const DB = 'shantu-trip-manifests';
const hydrated = new Map<string, string[]>();
const hydratedRouteSegments = new Map<string, TripPackage['routeSegments']>();
const INLINE_LIMIT = 1000;
let database: Promise<IDBDatabase> | undefined;
const routeSegmentsKey = (id: string) => `route-segments:${id}`;

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
  return index().map(trip => ({
    ...trip,
    ...(trip.manifest && hydrated.has(trip.id) ? { urls: hydrated.get(trip.id)! } : {}),
    ...(hydratedRouteSegments.has(trip.id) ? { routeSegments: hydratedRouteSegments.get(trip.id)! } : {}),
  }));
}

/** Frequent progress changes only rewrite small metadata, never a large URL list. */
export function putTrip(trip: TripPackage) {
  if (trip.routeSegments) hydratedRouteSegments.set(trip.id, trip.routeSegments);
  const list = index();
  const position = list.findIndex(item => item.id === trip.id);
  const external = trip.manifest || trip.urls.length > INLINE_LIMIT;
  if (external && !hydrated.has(trip.id)) throw new Error('缓存清单尚未保存，请重新准备任务');
  const { routeSegments: _localRouteSegments, ...metadata } = trip;
  const record = external
    ? { ...metadata, manifest: true, urlCount: trip.urlCount ?? trip.urls.length, urls: [] }
    : metadata;
  if (position < 0) list.push(record); else list[position] = record;
  localStorage.setItem(INDEX, JSON.stringify(list));
}

/** Remove only the compact progress record; large URL manifests stay in IndexedDB. */
export function removeTripIndex(id: string): void {
  localStorage.setItem(INDEX, JSON.stringify(index().filter(trip => trip.id !== id)));
}

export async function persistTripManifest(trip: TripPackage): Promise<void> {
  if (trip.routeSegments) {
    await manifestRequest('readwrite', store => store.put(trip.routeSegments, routeSegmentsKey(trip.id)));
    hydratedRouteSegments.set(trip.id, trip.routeSegments);
  }
  if (trip.urls.length > INLINE_LIMIT) {
    await manifestRequest('readwrite', store => store.put(trip.urls, trip.id));
    hydrated.set(trip.id, trip.urls);
    trip.manifest = true;
    trip.urlCount = trip.urls.length;
  }
  putTrip(trip);
}

/** Store retry geometry outside localStorage so frequent progress updates stay small. */
export async function persistTripPlanningTask(trip: TripPackage): Promise<void> {
  if (trip.routeSegments) {
    await manifestRequest('readwrite', store => store.put(trip.routeSegments, routeSegmentsKey(trip.id)));
    hydratedRouteSegments.set(trip.id, trip.routeSegments);
  }
  putTrip(trip);
}

export async function loadTripManifest(trip: TripPackage): Promise<TripPackage> {
  let urls = hydrated.get(trip.id);
  if (trip.manifest && !urls) {
    const saved = await manifestRequest<unknown>('readonly', store => store.get(trip.id));
    if (!Array.isArray(saved) || saved.length !== trip.urlCount || !saved.every(url => typeof url === 'string'))
      throw new Error('缓存任务清单缺失或损坏，请删除该缓存包后重新下载');
    urls = saved;
    hydrated.set(trip.id, urls);
  }
  let routeSegments = hydratedRouteSegments.get(trip.id);
  if (!routeSegments && trip.phase && trip.provider === 'imported') {
    const saved = await manifestRequest<unknown>('readonly', store => store.get(routeSegmentsKey(trip.id)));
    if (Array.isArray(saved)) {
      routeSegments = saved as TripPackage['routeSegments'];
      hydratedRouteSegments.set(trip.id, routeSegments);
    }
  }
  return { ...trip, ...(urls ? { urls } : {}), ...(routeSegments ? { routeSegments } : {}) };
}

export async function hydrateTripPackages(): Promise<TripPackage[]> {
  return Promise.all(tripPackages().map(loadTripManifest));
}

export async function removeTripManifest(id: string): Promise<void> {
  await manifestRequest('readwrite', store => {
    store.delete(id);
    return store.delete(routeSegmentsKey(id));
  });
  hydrated.delete(id);
  hydratedRouteSegments.delete(id);
}

export async function packageUrls(id: string): Promise<string[]> {
  const trip = tripPackages().find(item => item.id === id);
  return trip ? (await loadTripManifest(trip)).urls : [];
}
