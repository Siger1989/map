export type LayerSettings = {
  rasterDatums?: Record<string, import('../mapSources/coordinates').RasterDatum>;
  terrain: boolean;
  satellite: boolean;
  satelliteProvider?: 'sentinel' | 'tianditu';
  offlineBasemap?: boolean;
  tiandituBase?: 'vec' | 'img' | 'ter';
  tiandituLabels?: 'auto' | 'cva' | 'cia' | 'cta' | 'none';
  tiandituBoundaries?: boolean;
  offlineMaxZoom?: number | null;
  contours: boolean;
  contourInterval?: import('../terrain/contourInterval').ContourInterval;
  elevationColors: boolean;
  elevationColorsOpacity: number;
  geology: boolean;
  geologySource: 'world' | 'geocloud20w';
  geologyOpacity: number;
  roads: boolean;
  roadsOpacity?: number;
  rasterLevel?: number | null;
  labels: boolean;
  exaggeration: number;
  imageryMode: 'detail' | 'latest';
};
export const DEFAULT_LAYERS: LayerSettings = {
  terrain: true,
  satellite: false,
  satelliteProvider: 'sentinel',
  contours: false,
  contourInterval: 30,
  elevationColors: false,
  elevationColorsOpacity: 1,
  geology: false,
  geologySource: 'world',
  geologyOpacity: 0.85,
  roads: true,
  roadsOpacity: 1,
  rasterLevel: null,
  labels: true,
  exaggeration: 1,
  imageryMode: 'detail',
};
/** Apply map display changes while refusing retired weather-layer keys from old clients. */
export function applyLayerPatch(
  current: LayerSettings,
  patch: Partial<LayerSettings>,
): LayerSettings {
  const next = { ...current, ...patch } as LayerSettings & Record<string, unknown>;
  for (const key of ['clouds', 'cloudOpacity', 'cloudTime', 'rain', 'temperature', 'opacity']) delete next[key];
  if (patch.tiandituBase) {
    next.satelliteProvider = patch.satelliteProvider ?? 'tianditu';
    next.satellite = patch.tiandituBase === 'img';
    next.imageryMode = 'detail';
    next.offlineBasemap = patch.offlineBasemap ?? false;
  } else if (patch.satellite !== undefined) next.tiandituBase = patch.satellite ? 'img' : 'vec';
  if (patch.satellite === true && patch.offlineBasemap !== true) next.offlineBasemap = false;
  if (patch.geology === true) next.elevationColors = false;
  else if (patch.elevationColors === true) next.geology = false;
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
