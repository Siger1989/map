import type { ExpressionSpecification } from 'maplibre-gl';

/** Shared camera-zoom multiplier for route-like strokes; base/user widths remain intact. */
export const ROUTE_LINE_WIDTH_ZOOM_STOPS = [
  [0, 0.12],
  [6, 0.12],
  [10, 0.3],
  [14, 0.7],
  [16, 1],
] as const;

/** Keeps route strokes readable at close zoom while reducing distant width and visual weight. */
export const ROUTE_LINE_OPACITY_ZOOM_STOPS = [
  [0, 0.35],
  [6, 0.35],
  [10, 0.55],
  [14, 0.85],
  [16, 1],
] as const;

function scaleAtZoom(zoom: number, stops: readonly (readonly [number, number])[]): number {
  if (!Number.isFinite(zoom)) return 1;
  if (zoom <= stops[0][0]) return stops[0][1];
  for (let index = 1; index < stops.length; index++) {
    const [endZoom, endScale] = stops[index];
    const [startZoom, startScale] = stops[index - 1];
    if (zoom <= endZoom) return startScale + (endScale - startScale) * (zoom - startZoom) / (endZoom - startZoom);
  }
  return stops[stops.length - 1][1];
}

export function routeLineWidthScale(zoom: number): number {
  return scaleAtZoom(zoom, ROUTE_LINE_WIDTH_ZOOM_STOPS);
}

export function routeLineOpacityScale(zoom: number): number {
  return scaleAtZoom(zoom, ROUTE_LINE_OPACITY_ZOOM_STOPS);
}

/** Scale a CSS line width smoothly with camera zoom while preserving user-selected ratios. */
export function routeLineWidthExpression(baseWidth: number | ExpressionSpecification): ExpressionSpecification {
  return [
    'interpolate', ['linear'], ['zoom'],
    ...ROUTE_LINE_WIDTH_ZOOM_STOPS.flatMap(([zoom, scale]) => [zoom, ['*', baseWidth, scale]]),
  ] as ExpressionSpecification;
}

/** Multiply the feature's existing opacity by the shared zoom fade, preserving user alpha. */
export function routeLineOpacityExpression(baseOpacity: number | ExpressionSpecification): ExpressionSpecification {
  return [
    'interpolate', ['linear'], ['zoom'],
    ...ROUTE_LINE_OPACITY_ZOOM_STOPS.flatMap(([zoom, scale]) => [zoom, ['*', baseOpacity, scale]]),
  ] as ExpressionSpecification;
}
