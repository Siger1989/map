import type { LayerSettings } from '../map/types';

export const SENTINEL_NAME = 'Sentinel-2 2025';
export const SENTINEL_MAXZOOM = 14;
export const SENTINEL_TILES = ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg'];
export const SENTINEL_CREDIT = '<a href="https://cloudless.eox.at" target="_blank">EOxCloudless by EOX · modified Copernicus Sentinel data 2025</a> · <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank">CC BY-NC-SA 4.0</a>';
/** Provider choice is explicit. Missing values belong to the new free default. */
export const usesTianditu = (s: LayerSettings, configured: boolean) => configured && !s.offlineBasemap && s.satelliteProvider === 'tianditu';
export const usesSentinel = (s: LayerSettings) => !s.offlineBasemap && s.satellite && s.imageryMode === 'detail' && s.satelliteProvider !== 'tianditu';
