export type LayerSettings = {
  terrain: boolean;
  satellite: boolean;
  contours: boolean;
  elevationColors: boolean;
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
  satellite: true,
  contours: true,
  elevationColors: false,
  geology: false,
  geologySource: 'world',
  geologyOpacity: 0.85,
  clouds: true,
  rain: true,
  roads: true,
  labels: true,
  opacity: 0.6,
  exaggeration: 1,
  imageryMode: 'detail',
};
/** Thematic colours must not blend into a misleading combined legend. */
export function applyLayerPatch(current: LayerSettings, patch: Partial<LayerSettings>): LayerSettings {
  const next = { ...current, ...patch };
  if (patch.geology === true) next.elevationColors = false;
  else if (patch.elevationColors === true) next.geology = false;
  return next;
}
export type Point = { lng: number; lat: number; elevation: number | null };
export type ViewState = { bearing: number; pitch: number; zoom: number };
export const INITIAL_VIEW = {
  center: [103.28, 31.08] as [number, number],
  zoom: 10.5,
  pitch: 65,
  bearing: -24,
};
