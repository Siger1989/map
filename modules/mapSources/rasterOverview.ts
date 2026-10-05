import type { RasterSourceSpecification } from 'maplibre-gl';

/**
 * Build a lower-detail source for a separately rendered overview layer.
 *
 * Call only for the selected online source or the selected OVMAP base layer.
 * Reusing the same tile template and geographic limits keeps the overview in
 * the same source coordinate system; the 4x tileSize makes MapLibre select
 * approximately two zoom levels less detail for the same camera footprint.
 * It does not fetch tiles or add a map layer.
 */
export function rasterOverviewSource(
  source: RasterSourceSpecification,
  kind: 'online' | 'ovmap-base',
): RasterSourceSpecification {
  if (kind !== 'online' && kind !== 'ovmap-base')
    throw new TypeError('Raster overview is limited to online and OVMAP base sources');
  if (source.type !== 'raster')
    throw new TypeError('Raster overview requires a raster tile source');
  if (!Array.isArray(source.tiles) || source.tiles.length === 0)
    throw new TypeError('Raster overview requires an explicit tile template');
  if (source.tileSize !== 256 && source.tileSize !== 512)
    throw new RangeError('Raster overview requires an effective 256px or 512px tile size');

  return {
    ...source,
    tiles: [...source.tiles],
    tileSize: source.tileSize * 4,
  };
}
