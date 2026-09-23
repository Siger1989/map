import type { Map as LibreMap, Source } from 'maplibre-gl';

/** Overview cap only; RasterDetailPatch provides exact-level viewport/centre imagery without constraining the camera. */
export class RasterLevelLock {
  private original = new Map<Source, number>();
  private map: LibreMap;
  constructor(map: LibreMap) {
    this.map = map;
  }
  sync(ids: string[], level: number | null) {
    if (level !== null && (!Number.isInteger(level) || level < 0 || level > 22))
      level = null;
    const sources = ids
      .map((id) => this.map.getSource(id))
      .filter((s): s is Source => !!s && s.type === 'raster');
    const active = new Set(level === null ? [] : sources);
    for (const [source, maxzoom] of this.original) {
      if (active.has(source)) continue;
      source.maxzoom = maxzoom;
      this.original.delete(source);
      if (this.map.getSource(source.id) === source)
        this.map.refreshTiles(source.id);
    }
    if (level === null) return;
    for (const source of sources) {
      // Pending metadata is not a source deselection. Keep an existing cap
      // while a source reloads instead of restoring and refreshing it again.
      if (!source.loaded() && !this.original.has(source)) continue;
      if (!this.original.has(source)) this.original.set(source, source.maxzoom);
      const cap = Math.max(
        source.minzoom,
        Math.min(this.original.get(source)!, level),
      );
      if (source.maxzoom !== cap) {
        source.maxzoom = cap;
        this.map.refreshTiles(source.id);
      }
    }
  }
}
