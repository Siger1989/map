import type { AnalysisMode } from '../routeAnalysis/metrics';
export const ROUTE_DISPLAY_KEY = 'shantu.route-display.v1';
export type RouteDisplayPreferences = {
  mode: 'original' | AnalysisMode;
  legend: boolean;
  statistics: boolean;
  profile: boolean;
  steep: boolean;
  coordinates: boolean;
};
export const DEFAULT_ROUTE_DISPLAY: RouteDisplayPreferences = {
  mode: 'original',
  legend: true,
  statistics: false,
  profile: false,
  steep: false,
  coordinates: false,
};
export function normalizeRouteDisplay(value: unknown): RouteDisplayPreferences {
  const input =
    value && typeof value === 'object'
      ? (value as Partial<RouteDisplayPreferences>)
      : {};
  const result = { ...DEFAULT_ROUTE_DISPLAY };
  if (
    ['original', 'solid', 'elevation', 'speed', 'slope'].includes(
      input.mode ?? '',
    )
  )
    result.mode = input.mode!;
  for (const key of [
    'legend',
    'statistics',
    'profile',
    'steep',
    'coordinates',
  ] as const)
    if (typeof input[key] === 'boolean') result[key] = input[key];
  return result;
}
