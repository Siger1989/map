export type LayerSettings = {
  terrain: boolean;
  satellite: boolean;
  satelliteProvider?: 'sentinel' | 'tianditu';
  offlineBasemap?: boolean;
  tiandituBase?: 'vec' | 'img' | 'ter';
  tiandituLabels?: 'auto' | 'cva' | 'cia' | 'cta' | 'none';
  tiandituBoundaries?: boolean;
  offlineMaxZoom?: number | null;
  contours: boolean;
  elevationColors: boolean;
  elevationColorsOpacity: number;
  geology: boolean;
  geologySource: 'world' | 'geocloud20w';
  geologyOpacity: number;
  clouds: boolean;
  rain: boolean;
  temperature: boolean;
  roads: boolean;
  roadsOpacity?: number;
  rasterLevel?: number | null;
  labels: boolean;
  opacity: number;
  exaggeration: number;
  imageryMode: 'detail' | 'latest';
};
export const DEFAULT_LAYERS: LayerSettings = {
  terrain: true,
  satellite: false,
  satelliteProvider: 'sentinel',
  contours: false,
  elevationColors: false,
  elevationColorsOpacity: 1,
  geology: false,
  geologySource: 'world',
  geologyOpacity: 0.85,
  clouds: false,
  rain: false,
  temperature: false,
  roads: true,
  roadsOpacity: 1,
  rasterLevel: null,
  labels: true,
  opacity: 0.6,
  exaggeration: 1,
  imageryMode: 'detail',
};
/** Thematic colours must not blend into a misleading combined legend. */
export function applyLayerPatch(
  current: LayerSettings,
  patch: Partial<LayerSettings>,
): LayerSettings {
  const next = { ...current, ...patch };
  if (patch.tiandituBase) {
    next.satelliteProvider = patch.satelliteProvider ?? 'tianditu';
    next.satellite = patch.tiandituBase === 'img';
    next.imageryMode = 'detail';
    next.offlineBasemap = patch.offlineBasemap ?? false;
  } else if (patch.satellite !== undefined) next.tiandituBase = patch.satellite ? 'img' : 'vec';
  if (patch.satellite === true && patch.offlineBasemap !== true) next.offlineBasemap = false;
  if (patch.temperature === true) {
    next.elevationColors = false;
    next.geology = false;
  } else if (patch.geology === true) {
    next.elevationColors = false;
    next.temperature = false;
  } else if (patch.elevationColors === true) {
    next.geology = false;
    next.temperature = false;
  }
  return next;
}
export type Point = { lng: number; lat: number; elevation: number | null };
export type ViewState = { bearing: number; pitch: number; zoom: number };
export const INITIAL_VIEW = {
  center: [0, 20] as [number, number],
  zoom: 1,
  pitch: 0,
  bearing: 0,
};
