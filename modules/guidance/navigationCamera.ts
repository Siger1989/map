import type { Map, EaseToOptions } from 'maplibre-gl';

/** Seed the terrain height before a close view and release MapLibre's elevation
 * freeze at animation end, including cancellation by the next position fix. */
export function applyNavigationCamera(map: Map, options: EaseToOptions, event: { positionFollow: true } | { routePreview: true }) {
  const terrain = map.getTerrain();
  if (terrain && options.center) {
    const elevation = map.queryTerrainElevation(options.center);
    if (typeof elevation === 'number' && Number.isFinite(elevation))
      map.setCenterElevation(elevation, event);
  }
  map.easeTo({ ...options, ...(terrain ? { freezeElevation: true,
    // A cold DEM must not arrive halfway through a sea-level animation.
    ...(!map.isSourceLoaded(terrain.source) ? { duration: 0 } : {}),
  } : {}) }, event);
}
