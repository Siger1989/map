export type Coordinate = [number, number];
export type TravelMode = 'auto' | 'bicycle' | 'pedestrian';
export type RoutePlace = {
  name: string;
  coordinates: Coordinate;
  detail?: string;
};
export type RouteStep = {
  instruction: string;
  distance: number;
  duration: number;
  elapsedSeconds: number;
  coordinates: Coordinate[];
};
export type PlannedRoute = {
  mode: TravelMode;
  coordinates: Coordinate[];
  distance: number;
  duration: number;
  steps: RouteStep[];
  snapped: Coordinate[];
  stops?: RoutePlace[];
  createdAt: number;
};
export type RouteOverlay = {
  start: RoutePlace | null;
  end: RoutePlace | null;
  route: PlannedRoute | null;
  via?: (RoutePlace | null)[];
};
export type Endpoint = 'start' | 'end' | number;
export const TRAVEL_MODES: { id: TravelMode; label: string }[] = [
  { id: 'auto', label: '驾车' },
  { id: 'bicycle', label: '骑行' },
  { id: 'pedestrian', label: '步行' },
];
export function coordinate(value: unknown): value is Coordinate {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 85
  );
}
export function metresBetween(a: Coordinate, b: Coordinate): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b[1] - a[1]) * rad) / 2) ** 2 +
    Math.cos(a[1] * rad) *
      Math.cos(b[1] * rad) *
      Math.sin(((b[0] - a[0]) * rad) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function formatDistance(m: number) {
  return m < 1000 ? `${Math.round(m)} 米` : `${(m / 1000).toFixed(1)} 公里`;
}
export function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes < 60
    ? `${minutes} 分钟`
    : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}
