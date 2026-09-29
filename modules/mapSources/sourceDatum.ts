import type { MapSource } from './types';
import type { RasterDatum } from './coordinates';

/** Resolve the raster payload, preserving the original imported declaration for review. */
export function defaultRasterDatum(source?: MapSource | null): RasterDatum {
  if (!source) return 'wgs84';
  const layers = source.ovmap?.layers;
  // Legacy Ovi Google satellite-only forwarding template. Its raw WGS84 tile grid
  // is unchanged even when the container declares China Mercator. Do not apply
  // this exception to labelled/hybrid tiles, multi-layer stacks, or arbitrary URLs.
  if (source.kind === 'online' && layers?.length === 1 && layers[0].tiles.length &&
    layers[0].tiles.every(isUnshiftedSatelliteTemplate)) return 'wgs84';
  return source.datum ?? 'wgs84';
}

function isUnshiftedSatelliteTemplate(template: string): boolean {
  try {
    const url = new URL(template);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    return /^\/vt\/lyrs=s&[^?#]*&gmapgz\.jpg$/i.test(url.pathname) && !url.search;
  } catch { return false; }
}
