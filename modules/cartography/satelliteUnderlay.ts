import type { RasterSourceSpecification } from 'maplibre-gl';
import type { LayerSettings } from '../map/types';
import { SENTINEL_CREDIT } from './sentinel.ts';

export const SATELLITE_UNDERLAY = 'satellite-underlay';
/** Bundled world overview: never competes with selected imagery for network slots. */
export function satelliteUnderlaySource(origin: string): RasterSourceSpecification {
  return {
    type: 'raster',
    tiles: [origin + '/basemaps/satellite-overview-v1/{z}/{x}/{y}.jpg'],
    tileSize: 256,
    minzoom: 0,
    maxzoom: 5,
    attribution: SENTINEL_CREDIT,
  };
}

export function showSatelliteUnderlay(settings: Pick<LayerSettings, 'satellite' | 'offlineBasemap'>, custom: boolean): boolean {
  return custom || (settings.satellite && !settings.offlineBasemap);
}
