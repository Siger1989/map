import type { Map as LibreMap, RasterTileSource } from 'maplibre-gl';
import type { MapSource } from '../mapSources/types';
import { rasterTileUrl } from '../mapSources/RasterCoordinates';
import { cacheRoutePoints, CACHE_ROUTE_CHANGED } from './browseCacheRoute';
import { routeCacheTiles, type TileCoordinate } from './routeCachePolicy';
import { BROWSE_CACHE_CHANGED, BROWSE_CACHE_CLEARED, readBrowseCacheSettings } from './browseCachePreferences';
import { offlineMapOnly } from './tileCache';
import { canDownloadTrip } from './offlineDownloadPolicy';

type FetchTile = (url: string, signal: AbortSignal, tile?: TileCoordinate) => Promise<Response>;
type Connection = Partial<EventTarget> & { saveData?: boolean; effectiveType?: string };
/** Background work yields to visible map requests and never builds a whole-route download. */
export class RouteCacheWarmup {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private disposed = false;
  private blockedUntilMove = false;
  private seen = new Map<string, number>();
  private connection = (navigator as Navigator & { connection?: Connection }).connection;
  constructor(private map: LibreMap, private fetchTile: FetchTile, private selected: () => MapSource | null | undefined) {
    map.on('idle', this.schedule);
    map.on('movestart', this.moving);
    map.on('moveend', this.schedule);
    map.on('styledata', this.cancel);
    this.connection?.addEventListener?.('change', this.changed);
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('offline', this.cancel);
    window.addEventListener('online', this.schedule);
    window.addEventListener(BROWSE_CACHE_CHANGED, this.changed);
    window.addEventListener(CACHE_ROUTE_CHANGED, this.changed);
    window.addEventListener(BROWSE_CACHE_CLEARED, this.cleared);
    window.addEventListener('shantu:offline-map-mode', this.changed);
  }
  private allowed() {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    const source = this.selected();
    // Preserve the existing TianDiTu batch-download pause. Actual viewed tiles can still cache.
    const urls = source?.ovmap?.layers.flatMap(layer => layer.tiles) ?? source?.tiles ?? [];
    return !this.disposed && !this.blockedUntilMove && !document.hidden && navigator.onLine !== false &&
      !connection?.saveData && !['slow-2g', '2g'].includes(connection?.effectiveType ?? '') &&
      readBrowseCacheSettings().enabled && !offlineMapOnly() && cacheRoutePoints().length > 0 &&
      canDownloadTrip({ urls }) && !this.map.isMoving() && this.map.areTilesLoaded();
  }
  private cancel = () => {
    clearTimeout(this.timer); this.timer = undefined;
    this.controller?.abort(); this.controller = undefined;
  };
  private moving = () => { this.blockedUntilMove = false; this.cancel(); };
  private visibility = () => { if (document.hidden) this.cancel(); else this.schedule(); };
  private changed = () => { this.cancel(); this.seen.clear(); this.schedule(); };
  private cleared = () => { this.cancel(); this.seen.clear(); this.blockedUntilMove = true; };
  private schedule = () => {
    if (this.timer || this.controller || !this.allowed()) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.allowed()) return;
      const controller = new AbortController(); this.controller = controller;
      void this.run(controller.signal).catch(() => { /* Visible map requests report provider failures. */ }).finally(() => {
        if (this.controller === controller) this.controller = undefined;
      });
    }, 1500);
  };
  private async run(signal: AbortSignal) {
    const style = this.map.getStyle();
    if (!style) return;
    const currentZoom = this.map.getZoom();
    const sourceIds = new Set<string>();
    for (const layer of style.layers) {
      if (!['raster', 'hillshade'].includes(layer.type) || layer.layout?.visibility === 'none' ||
        currentZoom < (layer.minzoom ?? 0) || currentZoom >= (layer.maxzoom ?? 24)) continue;
      if ('source' in layer && typeof layer.source === 'string') sourceIds.add(layer.source);
    }
    const terrain = this.map.getTerrain();
    if (terrain) sourceIds.add(terrain.source);
    let completed = 0;
    const center = this.map.getCenter();
    for (const id of [...sourceIds].slice(0, 3)) {
      const source = this.map.getSource(id) as RasterTileSource | undefined;
      const templates = source?.tiles;
      if (!source || !templates?.length || !templates.every(t => t.includes('{z}') && t.includes('{x}') && t.includes('{y}')) ||
        !canDownloadTrip({ urls: templates }) || templates.some(t => /(?:^|\.)tile\.openstreetmap\.org\//i.test(t.replace(/^https?:\/\//, '')))) continue;
      const zoom = Math.min(18, source.maxzoom ?? 18, Math.floor(currentZoom));
      if (zoom < (source.minzoom ?? 0) || zoom < 0) continue;
      const tiles = routeCacheTiles(cacheRoutePoints(), [center.lng, center.lat], zoom, readBrowseCacheSettings().bufferKm, 12);
      for (const tile of tiles) {
        signal.throwIfAborted();
        if (!this.allowed() || completed >= 24) return;
        const url = rasterTileUrl(templates, tile.z, tile.x, tile.y, source.scheme === 'tms' ? 'tms' : 'xyz');
        if ((this.seen.get(url) ?? 0) > Date.now()) continue;
        this.seen.set(url, Date.now() + 30000);
        while (this.seen.size > 256) this.seen.delete(this.seen.keys().next().value!);
        try {
          const response = await this.fetchTile(url, AbortSignal.any([signal, AbortSignal.timeout(12000)]), tile);
          if (response.ok) { await response.arrayBuffer(); this.seen.set(url, Date.now() + 300000); }
        } catch { if (signal.aborted) return; }
        completed++;
      }
    }
  }
  dispose() {
    this.disposed = true; this.cancel();
    this.map.off('idle', this.schedule); this.map.off('movestart', this.moving); this.map.off('moveend', this.schedule);
    this.map.off('styledata', this.cancel);
    this.connection?.removeEventListener?.('change', this.changed);
    document.removeEventListener('visibilitychange', this.visibility);
    window.removeEventListener('offline', this.cancel); window.removeEventListener('online', this.schedule);
    window.removeEventListener(BROWSE_CACHE_CHANGED, this.changed);
    window.removeEventListener(CACHE_ROUTE_CHANGED, this.changed);
    window.removeEventListener(BROWSE_CACHE_CLEARED, this.cleared);
    window.removeEventListener('shantu:offline-map-mode', this.changed);
  }
}
