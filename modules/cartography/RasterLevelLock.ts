import type { Map as LibreMap, Source } from 'maplibre-gl';

/** Fix the raster source's detail level without replacing map style or trip overlays. */
export class RasterLevelLock {
  private original = new Map<Source, { maxzoom: number; calculate: Source['calculateTileZoom'] }>();
  private applied = new Map<Source, number>();
  private minimum: number | null = null;
  private map: LibreMap;
  constructor(map: LibreMap) { this.map = map; }
  sync(ids: string[], level: number | null) {
    if (level !== null && (!Number.isInteger(level) || level < 0 || level > 22)) level = null;
    const sources = ids.map(id => this.map.getSource(id)).filter((s): s is Source => !!s && s.type === 'raster' && s.loaded());
    const active = new Set(level === null ? [] : sources);
    for (const [source, saved] of this.original) {
      if (active.has(source)) continue;
      source.maxzoom = saved.maxzoom;
      source.calculateTileZoom = saved.calculate;
      this.original.delete(source); this.applied.delete(source);
      if (this.map.getSource(source.id) === source) this.map.refreshTiles(source.id);
    }
    if (level === null || !sources.length) {
      if (this.minimum !== null) { this.map.setMinZoom(this.minimum); this.minimum = null; }
      return;
    }
    let minimum = 0;
    for (const source of sources) {
      if (!this.original.has(source)) this.original.set(source, { maxzoom: source.maxzoom, calculate: source.calculateTileZoom });
      const saved = this.original.get(source)!;
      const fixed = Math.max(source.minzoom, Math.min(saved.maxzoom, Math.round(level)));
      minimum = Math.max(minimum, fixed - Math.log2(512 / source.tileSize));
      if (this.applied.get(source) !== fixed || source.maxzoom !== fixed) {
        source.maxzoom = fixed;
        source.calculateTileZoom = () => fixed;
        this.applied.set(source, fixed);
        this.map.refreshTiles(source.id);
      }
    }
    this.minimum ??= this.map.getMinZoom();
    // Below this scale a fixed high-resolution layer would require unbounded tiles.
    // Keep the selected level rather than silently substituting different imagery.
    const floor = Math.max(this.minimum, minimum);
    if (this.map.getMinZoom() !== floor) this.map.setMinZoom(floor);
  }
}
