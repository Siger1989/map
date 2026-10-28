import { packageUrls, tripPackages } from '../../outdoor/tripStorage.ts';

export type NativeOfflineDisplayProvider = 'tianditu' | 'openfreemap' | 'imported';
export type NativeOfflineDisplayPolicyPayload = {
  version: 1;
  enabled: boolean;
  packageId: string | null;
  sourceId: string | null;
  provider: NativeOfflineDisplayProvider | null;
  vectorTileTemplates: string[];
};

const OFFLINE_ONLY_KEY = 'shantu.offline-map-only.v1';
const SELECTED_PACKAGE_KEY = 'shantu.offline-package.v1';

function openFreeMapTemplates(urls: readonly string[]): string[] {
  const templates = new Set<string>();
  for (const value of urls) {
    if (templates.size >= 4) break;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.hostname !== 'tiles.openfreemap.org' || url.username || url.password || url.search || url.hash) continue;
      const match = url.pathname.match(/^\/planet\/([a-zA-Z0-9._-]+)\/\d+\/\d+\/\d+\.pbf$/);
      if (match) templates.add(`https://tiles.openfreemap.org/planet/${match[1]}/{z}/{x}/{y}.pbf`);
    } catch { /* Ignore malformed manifest entries. */ }
  }
  return [...templates];
}

/** Snapshot the same selected package that the existing React offline-map mode uses. */
export function readNativeOfflineDisplayPolicy(): NativeOfflineDisplayPolicyPayload {
  let enabled = false;
  let packageId: string | null = null;
  try {
    enabled = localStorage.getItem(OFFLINE_ONLY_KEY) === 'true';
    packageId = localStorage.getItem(SELECTED_PACKAGE_KEY) || null;
  } catch { /* A storage failure must not invent a selected package. */ }
  if (!enabled) return { version: 1, enabled: false, packageId: null, sourceId: null, provider: null, vectorTileTemplates: [] };
  const selected = packageId ? tripPackages().find((trip) => trip.id === packageId) : undefined;
  if (!selected) return { version: 1, enabled: true, packageId: null, sourceId: null, provider: null, vectorTileTemplates: [] };
  // Entries created before provider metadata was introduced were Tianditu packages.
  const provider = selected.provider ?? 'tianditu';
  return {
    version: 1,
    enabled: true,
    packageId: selected.id,
    sourceId: selected.sourceId || null,
    provider: provider === 'tianditu' || provider === 'openfreemap' || provider === 'imported' ? provider : null,
    vectorTileTemplates: provider === 'openfreemap' ? openFreeMapTemplates(selected.urls) : [],
  };
}

/** Notify the native render-state publisher whenever the existing mode/package changes. */
export function subscribeNativeOfflineDisplayPolicy(listener: (policy: NativeOfflineDisplayPolicyPayload) => void): () => void {
  let generation = 0;
  const publish = () => {
    const activeGeneration = ++generation;
    const policy = readNativeOfflineDisplayPolicy();
    listener(policy);
    if (!policy.enabled || !policy.packageId || policy.provider !== 'openfreemap' || policy.vectorTileTemplates.length) return;
    void packageUrls(policy.packageId).then((urls) => {
      if (generation !== activeGeneration) return;
      const current = readNativeOfflineDisplayPolicy();
      if (current.enabled && current.packageId === policy.packageId && current.provider === 'openfreemap')
        listener({ ...current, vectorTileTemplates: openFreeMapTemplates(urls) });
    }).catch(() => {});
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === OFFLINE_ONLY_KEY || event.key === SELECTED_PACKAGE_KEY || event.key === 'guanyun.trips.v1') publish();
  };
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('shantu:offline-map-mode', publish);
  window.addEventListener('storage', onStorage);
  publish();
  return () => {
    generation++;
    window.removeEventListener('shantu:offline-map-mode', publish);
    window.removeEventListener('storage', onStorage);
  };
}
