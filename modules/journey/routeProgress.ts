import {
  metresBetween,
  type Coordinate,
  type PlannedRoute,
} from '../navigation/types.ts';
import { lineLength, pointAlong, type JourneySample } from './metrics.ts';
import type { PositionFix } from '../position/types';
export type TimedStop = JourneySample & { seconds: number };
export function secondsAlong(route: PlannedRoute, distance: number) {
  const total = route.steps.reduce((sum, s) => sum + s.distance, 0);
  if (!total || !route.steps.length)
    return (route.duration * distance) / (route.distance || 1);
  let target = Math.max(
      0,
      Math.min(total, (distance / (route.distance || 1)) * total),
    ),
    seconds = 0;
  for (const step of route.steps) {
    if (step.distance > 0 && target <= step.distance)
      return Math.min(
        route.duration,
        seconds + (step.duration * target) / step.distance,
      );
    target -= step.distance;
    seconds += step.duration;
  }
  return route.duration;
}
export function routeWeatherStops(route: PlannedRoute): TimedStop[] {
  const length = lineLength(route.coordinates),
    count = Math.max(2, Math.min(8, Math.ceil(route.distance / 5000) + 1));
  return Array.from({ length: count }, (_, i) => {
    const fraction = i / (count - 1),
      distance = route.distance * fraction;
    return {
      coordinates:
        i === 0
          ? route.coordinates[0]
          : i === count - 1
            ? route.coordinates.at(-1)!
            : pointAlong(route.coordinates, length * fraction),
      distance,
      part: 0,
      seconds: secondsAlong(route, distance),
    };
  });
}
export function nearestOnRoute(line: Coordinate[], point: Coordinate) {
  let distance = 0,
    nearest = { distance: 0, offset: Infinity, coordinates: line[0] };
  const rad = Math.PI / 180,
    lngDelta = (a: number, b: number) => ((b - a + 540) % 360) - 180;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1],
      b = line[i],
      scaleX = 111320 * Math.cos(point[1] * rad);
    const dx = lngDelta(a[0], b[0]) * scaleX,
      dy = (b[1] - a[1]) * 111320,
      px = lngDelta(a[0], point[0]) * scaleX,
      py = (point[1] - a[1]) * 111320;
    const t = Math.max(
        0,
        Math.min(1, (dx * px + dy * py) / (dx * dx + dy * dy || 1)),
      ),
      length = metresBetween(a, b);
    const coordinates: Coordinate = [
      ((a[0] + lngDelta(a[0], b[0]) * t + 540) % 360) - 180,
      a[1] + (b[1] - a[1]) * t,
    ];
    const offset = metresBetween(point, coordinates);
    if (offset < nearest.offset)
      nearest = { distance: distance + length * t, offset, coordinates };
    distance += length;
  }
  return {
    ...nearest,
    fraction: distance > 0 ? nearest.distance / distance : 0,
  };
}
export function locateProgress(
  route: PlannedRoute,
  fix: PositionFix | null,
  now = Date.now(),
) {
  if (!fix) return { label: '点定位查看进度', fraction: null };
  if (now - fix.timestamp > 60000)
    return { label: '定位已过期', fraction: null };
  if (fix.accuracy > 250) return { label: '定位精度不足', fraction: null };
  const nearest = nearestOnRoute(route.coordinates, fix.coordinates);
  if (nearest.offset > Math.max(50, Math.min(150, fix.accuracy * 2)))
    return { label: `离路线约${Math.round(nearest.offset)}m`, fraction: null };
  return {
    label: `约${Math.round(nearest.fraction * 100)}%`,
    fraction: nearest.fraction,
  };
}
export function temperatureColor(value: number | null) {
  return value === null
    ? '#64747d'
    : value < 0
      ? '#6668e8'
      : value < 10
        ? '#409eee'
        : value < 20
          ? '#4ad3af'
          : value < 30
            ? '#ecd74c'
            : value < 35
              ? '#f39a36'
              : '#ee5260';
}
export function precipitationColor(value: number | null) {
  return value === null
    ? '#64747d'
    : value < 0.1
      ? '#314951'
      : value < 1
        ? '#70ddeb'
        : value < 4
          ? '#299fef'
          : value < 10
            ? '#8372e4'
            : '#dd57c7';
}
