import type { RouteStyle } from './types';
import { TRACK_COLORS } from '../tracks/style.ts';

export const DEFAULT_ROUTE_STYLE: RouteStyle = { color: '#59dcff', width: 4 };

export function resolveRouteStyle(style?: RouteStyle): RouteStyle {
  return {
    color: typeof style?.color === 'string' && /^#[a-f0-9]{6}$/i.test(style.color)
      ? style.color.toLowerCase()
      : DEFAULT_ROUTE_STYLE.color,
    width: typeof style?.width === 'number' && Number.isFinite(style.width)
      ? Math.max(0.5, Math.min(5, style.width))
      : DEFAULT_ROUTE_STYLE.width,
  };
}

export function routeColorOptions(currentColor: string) {
  return TRACK_COLORS.includes(currentColor)
    ? TRACK_COLORS
    : [currentColor, ...TRACK_COLORS];
}

export function routeWidthOptions(currentWidth: number) {
  const standard = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
  return standard.includes(currentWidth)
    ? standard
    : [currentWidth, ...standard];
}
