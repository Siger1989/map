export type LayerSettings = {
  terrain: boolean;
  satellite: boolean;
  contours: boolean;
  elevationColors: boolean;
  elevationColorsOpacity: number;
  geology: boolean;
  geologySource: 'world' | 'geocloud20w';
  geologyOpacity: number;
  clouds: boolean;
  rain: boolean;
  roads: boolean;
  labels: boolean;
  opacity: number;
  exaggeration: number;
  imageryMode: 'detail' | 'latest';
};
export const DEFAULT_LAYERS: LayerSettings = {
  terrain: true,
  satellite: false,
  contours: false,
  elevationColors: false,
  elevationColorsOpacity: 1,
  geology: false,
  geologySource: 'world',
  geologyOpacity: 0.85,
  clouds: false,
  rain: false,
  roads: true,
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
