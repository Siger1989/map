/**
 * QA adapter for MapLibre 6.7 raster coverage while ideal tiles are loading.
 * This intentionally wraps private TileManager methods and must remain opt-in.
 */

interface TileId {
  key: string;
  overscaledZ: number;
  canonical?: { z: number };
  scaledTo(zoom: number): TileId;
}

interface TileLike {
  hasData(): boolean;
}

interface TileManagerLike {
  _source?: { minzoom?: number; type?: string };
  _updateRetainedTiles?: (idealTileIDs: TileId[], zoom: number) => Record<string, TileId>;
  _addTile?: (tileID: TileId) => TileLike;
  getTile?: (tileID: TileId) => TileLike | undefined;
}

interface MapLike {
  style?: { tileManagers?: Record<string, TileManagerLike> };
  getPitch?: () => number;
  getZoom?: () => number;
}

interface WrappedManager {
  manager: TileManagerLike;
  original: NonNullable<TileManagerLike['_updateRetainedTiles']>;
  wrapper: NonNullable<TileManagerLike['_updateRetainedTiles']>;
}

const MAX_PARENT_TILES = 8;

/**
 * Installs coverage fallback for the explicitly supplied online raster source
 * IDs. Call sync again when those IDs or the style's TileManager instances
 * change. dispose() restores every wrapped original method.
 */
export function installRasterCoverage(map: MapLike, sourceIds: readonly string[]) {
  const wrapped = new Map<string, WrappedManager>();
  let disposed = false;

  const restore = (sourceId: string) => {
    const entry = wrapped.get(sourceId);
    if (!entry) return;
    // Do not overwrite a later patch installed by another QA helper.
    if (entry.manager._updateRetainedTiles === entry.wrapper) {
      entry.manager._updateRetainedTiles = entry.original;
    }
    wrapped.delete(sourceId);
  };

  const sync = (ids: readonly string[]) => {
    if (disposed) return;
    const wanted = new Set(ids);
    for (const sourceId of wrapped.keys()) {
      if (!wanted.has(sourceId)) restore(sourceId);
    }

    const managers = map.style?.tileManagers;
    if (!managers) return;

    for (const sourceId of wanted) {
      const manager = managers[sourceId];
      if (wrapped.get(sourceId)?.manager !== manager) restore(sourceId);
      if (!manager || manager._source?.type !== 'raster' || wrapped.get(sourceId)?.manager === manager) continue;
      restore(sourceId);

      const original = manager._updateRetainedTiles;
      const addTile = manager._addTile;
      if (typeof original !== 'function' || typeof addTile !== 'function' || typeof manager.getTile !== 'function') continue;

      const wrapper: NonNullable<TileManagerLike['_updateRetainedTiles']> = (idealTileIDs, zoom) => {
        if ((map.getPitch?.() ?? 0) < 45 || (map.getZoom?.() ?? 24) >= 12)
          return original.call(manager, idealTileIDs, zoom);
        const candidates: TileId[] = [];
        const candidateKeys = new Set<string>();
        const minzoom = Math.max(0, Math.floor(manager._source?.minzoom ?? 0));

        // Schedule at most eight unique parents before the original schedules
        // ideal requests, so visible fallbacks enter this source first.
        for (const ideal of idealTileIDs) {
          const idealTile = manager.getTile!(ideal);
          if (idealTile?.hasData()) continue;

          // A loaded ancestor already covers this gap; avoid another request.
          let covered = false;
          const targetZoom = Math.max(minzoom, (ideal.canonical?.z ?? ideal.overscaledZ) - 2);
          for (let z = ideal.overscaledZ - 1; z >= targetZoom; z--) {
            if (manager.getTile!(ideal.scaledTo(z))?.hasData()) {
              covered = true;
              break;
            }
          }
          if (covered || targetZoom >= ideal.overscaledZ) continue;

          const parent = ideal.scaledTo(targetZoom);
          if (!candidateKeys.has(parent.key)) {
            candidateKeys.add(parent.key);
            candidates.push(parent);
          }
        }

        const selected = candidates.slice(0, MAX_PARENT_TILES);
        for (const parent of selected) addTile!.call(manager, parent);

        const retained = original.call(manager, idealTileIDs, zoom);
        // Recompute each frame: once all descendant ideal tiles have data,
        // their fallback parent is omitted and can be released by MapLibre.
        for (const parent of selected) {
          if (!manager.getTile!(parent)?.hasData()) retained[parent.key] = parent;
        }
        return retained;
      };

      manager._updateRetainedTiles = wrapper;
      wrapped.set(sourceId, {manager, original, wrapper});
    }
  };

  sync(sourceIds);
  return {
    sync,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const sourceId of [...wrapped.keys()]) restore(sourceId);
    }
  };
}
