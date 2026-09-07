import type { Map as TerrainMap } from 'maplibre-gl';
import { mercator } from './planeMath.ts';

/** MapLibre's public query returns a flat zero while DEMs load. Isolate its
 * coverage-index adapter here, and return null rather than that placeholder. */
export function loadedTerrainSampler(map: TerrainMap) {
  const terrain = map.terrain,
    index = terrain?.getCoverageIndex?.();
  return (ll: [number, number]): number | null => {
    if (!index || Math.abs(ll[1]) > 85) return null;
    const m = mercator(ll),
      wrappedX = ((m.x % 1) + 1) % 1;
    for (const z of index.zooms) {
      const n = 2 ** z,
        x = wrappedX * n,
        y = m.y * n,
        tx = Math.floor(x),
        ty = Math.floor(y);
      // Normalized coordinates may be drawn in a neighbouring wrapped world.
      const wrap = Math.round((map.getCenter().lng - ll[0]) / 360);
      const key = `${wrap}/${z}/${tx}/${ty}`;
      if (!index.samplerPerTile.has(key)) continue;
      const sampler = index.samplerPerTile.get(key);
      if (!sampler) return null;
      const value = sampler(
        Math.min((x - tx) * 8192, 8192 * (1 - 1e-12)),
        Math.min((y - ty) * 8192, 8192 * (1 - 1e-12)),
        8192,
      );
      return Number.isFinite(value) ? value : null;
    }
    return null;
  };
}
