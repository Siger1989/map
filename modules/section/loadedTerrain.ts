import type { Map as TerrainMap } from 'maplibre-gl';
import { mercator } from './planeMath.ts';

type LoadedRasterDEM = {
  dim: number;
  sampleBilinear: (x: number, y: number) => number;
};
type LoadedRasterTile = {
  tileID: { wrap: number; canonical: { z: number; x: number; y: number } };
  dem?: LoadedRasterDEM | null;
};
type LoadedDEMManager = {
  getRenderableIds?: () => string[];
  getTileByID?: (id: string) => LoadedRasterTile | undefined;
};
type TerrainSampler = (point: [number, number]) => number | null;
const samplerByMap = new WeakMap<TerrainMap, TerrainSampler>();

/** MapLibre's public query returns a flat zero while DEMs load. Isolate its
 * coverage-index adapter here, and return null rather than that placeholder. */
export function loadedTerrainSampler(map: TerrainMap) {
  const cached = samplerByMap.get(map);
  if (cached) return cached;
  let sourceTiles: LoadedRasterTile[] | undefined;
  const invalidate = () => {
    sourceTiles = undefined;
  };
  // TerrainMap calls this adapter for each sample. Cache the callback and its
  // visible 2D tile snapshot so grid sampling does not rescan all map tiles.
  map.on('move', invalidate);
  map.on('sourcedata', invalidate);
  map.on('styledata', invalidate);
  const sample: TerrainSampler = (ll) => {
    if (Math.abs(ll[1]) > 85) return null;
    const terrain = map.terrain,
      index = terrain?.getCoverageIndex?.();
    if (!sourceTiles) {
      // With terrain disabled, `elevation` is no longer terrain-rendered. The
      // visible hillshade uses the parallel `shading` raster-dem source, so
      // prefer its already-decoded tiles and also inspect `elevation` cache.
      sourceTiles = (['shading', 'elevation'] as const)
        .flatMap((sourceId) => {
          const manager = map.style?.tileManagers?.[sourceId] as
            | LoadedDEMManager
            | undefined;
          return (manager?.getRenderableIds?.() ?? [])
            .map((id) => manager?.getTileByID?.(id))
            .filter(
              (tile): tile is LoadedRasterTile =>
                !!tile?.dem &&
                Number.isFinite(tile.dem.dim) &&
                tile.dem.dim > 0,
            );
        })
        .sort((a, b) => b.tileID.canonical.z - a.tileID.canonical.z);
    }
    const m = mercator(ll),
      wrappedX = ((m.x % 1) + 1) % 1;
    // Normalized coordinates may be drawn in a neighbouring wrapped world.
    const wrap = Math.round((map.getCenter().lng - ll[0]) / 360);
    if (index) {
      for (const z of index.zooms) {
        const n = 2 ** z,
          x = wrappedX * n,
          y = m.y * n,
          tx = Math.floor(x),
          ty = Math.floor(y),
          key = `${wrap}/${z}/${tx}/${ty}`;
        if (!index.samplerPerTile.has(key)) continue;
        const sampler = index.samplerPerTile.get(key);
        // MapLibre 6.7 indexes renderable tiles even before their DEM is decoded.
        // A null sampler at a finer zoom must not hide a loaded parent tile.
        if (!sampler) continue;
        const value = sampler(
          Math.min((x - tx) * 8192, 8192 * (1 - 1e-12)),
          Math.min((y - ty) * 8192, 8192 * (1 - 1e-12)),
          8192,
        );
        if (Number.isFinite(value)) return value;
      }
    }
    for (const tile of sourceTiles) {
      const { canonical } = tile.tileID,
        n = 2 ** canonical.z,
        x = wrappedX * n,
        y = m.y * n,
        tx = Math.floor(x),
        ty = Math.floor(y);
      if (tile.tileID.wrap !== wrap || canonical.x !== tx || canonical.y !== ty)
        continue;
      const dim = tile.dem!.dim;
      try {
        const value = tile.dem!.sampleBilinear(
          Math.min((x - tx) * dim, dim * (1 - 1e-12)),
          Math.min((y - ty) * dim, dim * (1 - 1e-12)),
        );
        if (Number.isFinite(value)) return value;
      } catch {
        // Try an already-loaded lower-resolution tile if this tile's edge is unavailable.
      }
    }
    return null;
  };
  samplerByMap.set(map, sample);
  return sample;
}
