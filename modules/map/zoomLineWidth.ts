import type { ExpressionSpecification } from 'maplibre-gl';

/** Shared camera-zoom multiplier for route-like strokes; base/user widths remain intact. */
export const ROUTE_LINE_WIDTH_ZOOM_STOPS = [
  [0, 0.25],
  [6, 0.25],
  [10, 0.5],
  [14, 0.8],
  [16, 1],
] as const;

export function routeLineWidthScale(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  const stops = ROUTE_LINE_WIDTH_ZOOM_STOPS;
  if (zoom <= stops[0][0]) return stops[0][1];
  for (let index = 1; index < stops.length; index++) {
    const [endZoom, endScale] = stops[index];
    const [startZoom, startScale] = stops[index - 1];
    if (zoom <= endZoom) return startScale + (endScale - startScale) * (zoom - startZoom) / (endZoom - startZoom);
  }
  return stops[stops.length - 1][1];
}

/** Scale a CSS line width smoothly with camera zoom while preserving user-selected ratios. */
export function routeLineWidthExpression(baseWidth: number | ExpressionSpecification): ExpressionSpecification {
  return [
    'interpolate', ['linear'], ['zoom'],
    ...ROUTE_LINE_WIDTH_ZOOM_STOPS.flatMap(([zoom, scale]) => [zoom, ['*', baseWidth, scale]]),
  ] as ExpressionSpecification;
}
