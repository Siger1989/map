type CanonicalTile = { z: number; x: number; y: number };
type TileReference = { tileID?: { canonical?: CanonicalTile }; state?: string };
type RecoveryEvent = {
  sourceId?: unknown;
  error?: unknown;
  tile?: TileReference;
  coord?: { canonical?: CanonicalTile };
};
type Bounds = {
  getWest(): number;
  getEast(): number;
  getSouth(): number;
  getNorth(): number;
};
type StyleLayer = {
  source?: string;
  minzoom?: number;
  maxzoom?: number;
  layout?: { visibility?: unknown };
};

/** The small public MapLibre surface used by the recovery controller and its tests. */
export interface TiandituRecoveryMap {
  on(type: string, listener: (event: RecoveryEvent) => void): unknown;
  off(type: string, listener: (event: RecoveryEvent) => void): unknown;
  refreshTiles(sourceId: string, tileIds: CanonicalTile[]): void;
  getBounds(): Bounds;
  getZoom(): number;
  getStyle(): { layers?: StyleLayer[]; terrain?: { source?: string } };
  getSource(sourceId: string): unknown;
}

type LoadFailure = {
  name?: unknown;
  kind?: unknown;
  code?: unknown;
  retryAt?: unknown;
  retryable?: unknown;
};

type FailedTile = {
  sourceId: string;
  tile: CanonicalTile;
  retryAt: number;
  retryable: boolean;
  code: string;
  attempts: number;
  awaitingResponse: boolean;
  lastErrorSignature: string | null;
  touched: number;
};

const MAX_FAILURES = 256;
const MAX_AUTO_RETRIES_PER_VIEW = 3;
const MAX_TIMEOUT_DELAY_MS = 2_147_483_647;
// Serialize retries to keep a shared Tianditu cooldown from becoming a burst.
const MIN_RETRY_SPACING_MS = 750;

/**
 * Recovers only failed Tianditu tiles. It never changes the camera and never asks
 * MapLibre to reload an entire source.
 */
export function installTiandituRecovery(
  map: TiandituRecoveryMap,
  onStatus?: (message: string) => void,
): () => void {
  const failures = new Map<string, FailedTile>();
  let disposed = false;
  let moving = false;
  let online = typeof navigator === 'undefined' || navigator.onLine !== false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastRefreshAt = Number.NEGATIVE_INFINITY;
  let lastStatus = '';
  let teardown: () => void = () => {};

  const report = (message: string) => {
    if (!message || message === lastStatus) return;
    lastStatus = message;
    try { onStatus?.(message); } catch { /* A UI status callback must not disrupt tile recovery. */ }
  };

  const keyFor = (sourceId: string, tile: CanonicalTile) =>
    JSON.stringify([sourceId, tile.z, tile.x, tile.y]);

  const cancelTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const inView = (tile: CanonicalTile): boolean => {
    try {
      const bounds = map.getBounds();
      const n = 2 ** tile.z;
      const westTile = tile.x / n * 360 - 180;
      const eastTile = (tile.x + 1) / n * 360 - 180;
      const tileNorth = mercatorLatitude(tile.y, n);
      const tileSouth = mercatorLatitude(tile.y + 1, n);
      const west = bounds.getWest();
      let east = bounds.getEast();
      if (![west, east, bounds.getSouth(), bounds.getNorth()].every(Number.isFinite)) return false;
      if (east < west) east += 360;
      if (east - west >= 360) return tileNorth >= bounds.getSouth() && tileSouth <= bounds.getNorth();
      if (tileNorth < bounds.getSouth() || tileSouth > bounds.getNorth()) return false;
      const firstWrap = Math.floor((west - eastTile) / 360) - 1;
      const lastWrap = Math.ceil((east - westTile) / 360) + 1;
      for (let wrap = firstWrap; wrap <= lastWrap; wrap++) {
        const tileWest = westTile + wrap * 360;
        const tileEast = eastTile + wrap * 360;
        if (tileEast >= west && tileWest <= east) return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const sourceIsUsedAndVisible = (sourceId: string): boolean => {
    try {
      if (!map.getSource(sourceId)) return false;
      const style = map.getStyle();
      const zoom = map.getZoom();
      const hasVisibleLayer = (style.layers ?? []).some((layer) =>
        layer.source === sourceId &&
        layer.layout?.visibility !== 'none' &&
        (layer.minzoom === undefined || zoom >= layer.minzoom) &&
        (layer.maxzoom === undefined || zoom < layer.maxzoom),
      );
      return hasVisibleLayer || style.terrain?.source === sourceId;
    } catch {
      return false;
    }
  };

  const canRetry = (failure: FailedTile) =>
    !disposed && !moving && online && isDocumentVisible() &&
    failure.retryable && failure.attempts < MAX_AUTO_RETRIES_PER_VIEW &&
    !failure.awaitingResponse && sourceIsUsedAndVisible(failure.sourceId) && inView(failure.tile);

  const schedule = () => {
    cancelTimer();
    if (disposed || moving || !online || !isDocumentVisible()) return;
    let nextAt = Number.POSITIVE_INFINITY;
    for (const failure of failures.values()) {
      if (!canRetry(failure)) continue;
      nextAt = Math.min(
        nextAt,
        Math.max(failure.retryAt, lastRefreshAt + MIN_RETRY_SPACING_MS),
      );
    }
    if (!Number.isFinite(nextAt)) return;
    // Browser/Node timers overflow signed 32-bit delays to an immediate timer.
    // Wake at the largest safe interval and re-evaluate the absolute retryAt.
    const delay = Math.min(MAX_TIMEOUT_DELAY_MS, Math.max(0, nextAt - Date.now()));
    timer = setTimeout(runOneRetry, delay);
  };

  const runOneRetry = () => {
    timer = null;
    if (disposed || moving || !online || !isDocumentVisible()) return;
    const now = Date.now();
    const due = [...failures.values()]
      .filter((failure) => canRetry(failure) && failure.retryAt <= now &&
        lastRefreshAt + MIN_RETRY_SPACING_MS <= now)
      .sort((a, b) => a.retryAt - b.retryAt || a.touched - b.touched)[0];
    if (!due) {
      schedule();
      return;
    }

    due.attempts++;
    due.awaitingResponse = true;
    due.lastErrorSignature = null;
    due.touched = now;
    try {
      // This is MapLibre's public targeted-tile API; omitting tileIds reloads the source.
      map.refreshTiles(due.sourceId, [{ z: due.tile.z, x: due.tile.x, y: due.tile.y }]);
      lastRefreshAt = now;
      if (due.attempts >= MAX_AUTO_RETRIES_PER_VIEW)
        report('部分天地图瓦片仍未加载，已暂停自动重试');
    } catch {
      failures.delete(keyFor(due.sourceId, due.tile));
      report('天地图瓦片暂时无法刷新，请稍后重试');
    }
    schedule();
  };

  const onError = (event: RecoveryEvent) => {
    if (disposed || typeof event.sourceId !== 'string' || !event.sourceId) return;
    const error = event.error as LoadFailure | null | undefined;
    if (!error || (error.name !== 'TiandituLoadError' && error.kind !== 'TiandituLoadError') ||
      typeof error.code !== 'string' || !error.code ||
      typeof error.retryAt !== 'number' || !Number.isFinite(error.retryAt) ||
      typeof error.retryable !== 'boolean') return;
    const tile = canonicalTile(event.tile?.tileID?.canonical ?? event.coord?.canonical);
    if (!tile) return;
    const key = keyFor(event.sourceId, tile);
    const signature = `${error.code}|${error.retryAt}|${error.retryable}`;
    const existing = failures.get(key);
    if (existing && !existing.awaitingResponse && existing.lastErrorSignature === signature) return;
    const failure: FailedTile = existing ?? {
      sourceId: event.sourceId,
      tile,
      retryAt: error.retryAt,
      retryable: error.retryable,
      code: error.code,
      attempts: 0,
      awaitingResponse: false,
      lastErrorSignature: null,
      touched: Date.now(),
    };
    failure.retryAt = error.retryAt;
    failure.retryable = error.retryable;
    failure.code = error.code;
    failure.awaitingResponse = false;
    failure.lastErrorSignature = signature;
    failure.touched = Date.now();
    // Refresh insertion order to implement bounded least-recently-updated eviction.
    failures.delete(key);
    failures.set(key, failure);
    while (failures.size > MAX_FAILURES) failures.delete(failures.keys().next().value!);

    if (!failure.retryable) {
      if (error.code === 'unauthorized') report('天地图图源授权未通过，请检查配置');
      else if (error.code === 'not-found') report('部分天地图瓦片暂不可用');
      else report('天地图瓦片暂不可用');
    } else {
      report('天地图瓦片连接暂时失败，网络恢复后会自动重试');
    }
    schedule();
  };

  const onSourceData = (event: RecoveryEvent) => {
    if (disposed || typeof event.sourceId !== 'string' || event.tile?.state !== 'loaded') return;
    const tile = canonicalTile(event.tile.tileID?.canonical ?? event.coord?.canonical);
    if (!tile) return;
    failures.delete(keyFor(event.sourceId, tile));
    if (failures.size === 0) lastStatus = '';
    schedule();
  };

  const onMoveStart = () => {
    moving = true;
    cancelTimer();
  };

  const onMoveEnd = () => {
    moving = false;
    for (const [key, failure] of failures) {
      if (!sourceIsUsedAndVisible(failure.sourceId) || !inView(failure.tile)) {
        failures.delete(key);
        continue;
      }
      failure.attempts = 0;
      if (!failure.awaitingResponse) failure.lastErrorSignature = null;
    }
    schedule();
  };

  const onOnline = () => {
    online = true;
    schedule();
  };
  const onOffline = () => {
    online = false;
    cancelTimer();
  };
  const onVisibility = () => {
    if (isDocumentVisible()) schedule();
    else cancelTimer();
  };
  const onStyleData = () => schedule();
  const onMapRemove = () => teardown();

  map.on('error', onError);
  map.on('sourcedata', onSourceData);
  map.on('movestart', onMoveStart);
  map.on('moveend', onMoveEnd);
  map.on('styledata', onStyleData);
  map.on('remove', onMapRemove);
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  teardown = () => {
    if (disposed) return;
    disposed = true;
    cancelTimer();
    map.off('error', onError);
    map.off('sourcedata', onSourceData);
    map.off('movestart', onMoveStart);
    map.off('moveend', onMoveEnd);
    map.off('styledata', onStyleData);
    map.off('remove', onMapRemove);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    }
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    failures.clear();
  };
  return teardown;
}

function canonicalTile(value: unknown): CanonicalTile | null {
  if (!value || typeof value !== 'object') return null;
  const tile = value as Partial<CanonicalTile>;
  if (!Number.isInteger(tile.z) || !Number.isInteger(tile.x) || !Number.isInteger(tile.y) ||
    tile.z! < 0 || tile.z! > 30) return null;
  const limit = 2 ** tile.z!;
  if (tile.x! < 0 || tile.x! >= limit || tile.y! < 0 || tile.y! >= limit) return null;
  return { z: tile.z!, x: tile.x!, y: tile.y! };
}

function mercatorLatitude(y: number, n: number): number {
  const value = Math.PI * (1 - 2 * y / n);
  return Math.atan(Math.sinh(value)) * 180 / Math.PI;
}

function isDocumentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}
