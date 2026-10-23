import type { Map as LibreMap, RasterTileSource } from 'maplibre-gl';

/** Switches selected raster sources to one higher detail level without changing the camera. */
export class RasterQuality {
  private originalTileSizes = new Map<RasterTileSource, number>();
  private map: LibreMap;

  constructor(map: LibreMap) {
    this.map = map;
  }

  sync(sourceIds: readonly string[], enabled: boolean) {
    const active = new Set<RasterTileSource>();
    if (enabled) {
      for (const id of sourceIds) {
        const source = this.map.getSource(id) as RasterTileSource | undefined;
        if (source?.type === 'raster') active.add(source);
      }
    }

    for (const [source, originalTileSize] of this.originalTileSizes) {
      if (active.has(source)) continue;
      source.tileSize = originalTileSize;
      this.originalTileSizes.delete(source);
      if (this.map.getSource(source.id) === source) this.map.refreshTiles(source.id);
    }

    if (!enabled) return;
    for (const source of active) {
      // TileJSON can replace the configured tileSize while metadata is loading.
      // Capture the source's effective size only after MapLibre finishes loading it.
      if (!source.loaded() && !this.originalTileSizes.has(source)) continue;
      if (!this.originalTileSizes.has(source))
        this.originalTileSizes.set(source, source.tileSize);

      const detailTileSize = this.originalTileSizes.get(source)! / 2;
      if (source.tileSize === detailTileSize) continue;
      source.tileSize = detailTileSize;
      this.map.refreshTiles(source.id);
    }
  }
}
