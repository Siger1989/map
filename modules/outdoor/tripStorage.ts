import type { TripPackage } from './offline';

const INDEX = 'guanyun.trips.v1';
const DB = 'shantu-trip-manifests';
const hydrated = new Map<string, string[]>();
const hydratedRouteSegments = new Map<string, TripPackage['routeSegments']>();
const hydratedAreaBoundaries = new Map<string, TripPackage['areaBoundary']>();
const INLINE_LIMIT = 1000;
let database: Promise<IDBDatabase> | undefined;
const routeSegmentsKey = (id: string) => `route-segments:${id}`;
const areaBoundaryKey = (id: string) => `area-boundary:${id}`;

function isRouteSegments(value: unknown): value is NonNullable<TripPackage['routeSegments']> {
  return Array.isArray(value) && value.every(segment => Array.isArray(segment) &&
    segment.length >= 2 && segment.every(point => Array.isArray(point) && point.length >= 2 &&
      Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
      point[0] >= -180 && point[0] <= 180 && point[1] >= -90 && point[1] <= 90));
}

function isAreaBoundary(value: unknown): value is NonNullable<TripPackage['areaBoundary']> {
  return Array.isArray(value) && value.length >= 3 && value.length <= 2000 &&
    value.every(point => Array.isArray(point) && point.length >= 2 &&
      Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
      point[0] >= -180 && point[0] <= 180 && point[1] >= -85 && point[1] <= 85);
}

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
    ...(hydratedAreaBoundaries.has(trip.id) ? { areaBoundary: hydratedAreaBoundaries.get(trip.id)! } : {}),
  }));
}

/** Frequent progress changes only rewrite small metadata, never a large URL list. */
export function putTrip(trip: TripPackage) {
  if (trip.routeSegments) hydratedRouteSegments.set(trip.id, trip.routeSegments);
  if (trip.areaBoundary) hydratedAreaBoundaries.set(trip.id, trip.areaBoundary);
  const list = index();
  const position = list.findIndex(item => item.id === trip.id);
  const external = trip.manifest || trip.urls.length > INLINE_LIMIT;
  if (external && !hydrated.has(trip.id)) throw new Error('缓存清单尚未保存，请重新准备任务');
  const { routeSegments: _localRouteSegments, areaBoundary: _localAreaBoundary, ...metadata } = trip;
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
  if (trip.areaBoundary) {
    await manifestRequest('readwrite', store => store.put(trip.areaBoundary, areaBoundaryKey(trip.id)));
    hydratedAreaBoundaries.set(trip.id, trip.areaBoundary);
  }
  if (trip.urls.length > INLINE_LIMIT) {
    await manifestRequest('readwrite', store => store.put(trip.urls, trip.id));
    hydrated.set(trip.id, trip.urls);
    trip.manifest = true;
    trip.urlCount = trip.urls.length;
  }
  putTrip(trip);
}

/** Store planning geometry outside localStorage so previews and paused tasks can restore it. */
export async function persistTripPlanningTask(trip: TripPackage): Promise<void> {
  if (trip.routeSegments) {
    await manifestRequest('readwrite', store => store.put(trip.routeSegments, routeSegmentsKey(trip.id)));
    hydratedRouteSegments.set(trip.id, trip.routeSegments);
  }
  if (trip.areaBoundary) {
    await manifestRequest('readwrite', store => store.put(trip.areaBoundary, areaBoundaryKey(trip.id)));
    hydratedAreaBoundaries.set(trip.id, trip.areaBoundary);
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
  if (!routeSegments && isRouteSegments(trip.routeSegments)) routeSegments = trip.routeSegments;
  // Completed and legacy imported packages also need their original route geometry.
  // Older indexes may not have a phase field, so phase cannot gate this lookup.
  if (!routeSegments && trip.provider === 'imported') {
    const saved = await manifestRequest<unknown>('readonly', store => store.get(routeSegmentsKey(trip.id)));
    if (isRouteSegments(saved)) {
      routeSegments = saved;
      hydratedRouteSegments.set(trip.id, routeSegments);
    }
  }
  let areaBoundary = hydratedAreaBoundaries.get(trip.id);
  if (!areaBoundary && isAreaBoundary(trip.areaBoundary)) areaBoundary = trip.areaBoundary;
  if (!areaBoundary && trip.provider === 'imported') {
    const saved = await manifestRequest<unknown>('readonly', store => store.get(areaBoundaryKey(trip.id)));
    if (isAreaBoundary(saved)) {
      areaBoundary = saved;
      hydratedAreaBoundaries.set(trip.id, areaBoundary);
    }
  }
  return { ...trip, ...(urls ? { urls } : {}), ...(routeSegments ? { routeSegments } : {}), ...(areaBoundary ? { areaBoundary } : {}) };
}

export async function hydrateTripPackages(): Promise<TripPackage[]> {
  return Promise.all(tripPackages().map(loadTripManifest));
}

export async function removeTripManifest(id: string): Promise<void> {
  await manifestRequest('readwrite', store => {
    store.delete(id);
    store.delete(routeSegmentsKey(id));
    return store.delete(areaBoundaryKey(id));
  });
  hydrated.delete(id);
  hydratedRouteSegments.delete(id);
  hydratedAreaBoundaries.delete(id);
}

export async function packageUrls(id: string): Promise<string[]> {
  const trip = tripPackages().find(item => item.id === id);
  return trip ? (await loadTripManifest(trip)).urls : [];
}
