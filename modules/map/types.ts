export type LayerSettings = {
  terrain: boolean;
  satellite: boolean;
  contours: boolean;
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
  clouds: true,
  rain: true,
  roads: true,
  labels: true,
  opacity: 0.6,
  exaggeration: 1.3,
  imageryMode: 'detail',
};
export type Point = { lng: number; lat: number; elevation: number | null };
export type ViewState = { bearing: number; pitch: number; zoom: number };
export const INITIAL_VIEW = {
  center: [103.28, 31.08] as [number, number],
  zoom: 10.5,
  pitch: 65,
  bearing: -24,
};
