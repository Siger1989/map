import { coordinate, type Coordinate } from '../navigation/types.ts';
import type { Pose } from '../objectTransform/math';

export const MEASUREMENT_KEY = 'shantu.measurement.v1';
export const MAX_POINTS = 200;
export function pointLabel(index: number): string {
  let n = index + 1,
    label = '';
  while (n > 0) {
    n--;
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26);
  }
  return label;
}
export type MeasurePoint = {
  id: string;
  coordinates: Coordinate;
  altitude: number | null;
  heightSource: 'terrain' | 'manual' | 'unknown';
};
export const validHeight = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= -12000 &&
  value <= 100000;
export function validPoint(p: MeasurePoint) {
  return (
    !!p &&
    typeof p.id === 'string' &&
    p.id.length > 0 &&
    p.id.length <= 100 &&
    coordinate(p.coordinates) &&
    Math.abs(p.coordinates[1]) <= 85 &&
    (p.altitude === null || validHeight(p.altitude)) &&
    ['terrain', 'manual', 'unknown'].includes(p.heightSource) &&
    (p.altitude === null) === (p.heightSource === 'unknown')
  );
}
export function parseMeasurement(raw: string | null): MeasurePoint[] {
  if (!raw) return [];
  const value = JSON.parse(raw);
  if (
    value.version !== 1 ||
    !Array.isArray(value.points) ||
    value.points.length > MAX_POINTS ||
    !value.points.every(validPoint) ||
    new Set(value.points.map((p: MeasurePoint) => p.id)).size !==
      value.points.length
  )
    throw new Error('上次测量数据无法读取，未覆盖原数据');
  return value.points;
}
export function pointPose(point: MeasurePoint): Pose | null {
  return point.altitude === null
    ? null
    : {
        coordinates: [...point.coordinates],
        altitude: point.altitude,
        rotation: [0, 0, 0, 1],
        size: [1, 1, 1],
      };
}
const rad = Math.PI / 180;
export function segmentMetrics(a: MeasurePoint, b: MeasurePoint) {
  const lat1 = a.coordinates[1] * rad,
    lat2 = b.coordinates[1] * rad;
  const dl = (b.coordinates[0] - a.coordinates[0]) * rad,
    dp = lat2 - lat1;
  const h =
    Math.sin(dp / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dl / 2) ** 2;
  const horizontal =
    2 * 6371008.8 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
  const bearing =
    horizontal < 0.001 || Math.abs(Math.PI - horizontal / 6371008.8) < 1e-8
      ? null
      : (Math.atan2(
          Math.sin(dl) * Math.cos(lat2),
          Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dl),
        ) /
          rad +
          360) %
        360;
  const rise =
    a.altitude === null || b.altitude === null ? null : b.altitude - a.altitude;
  const inclination =
    rise === null || (horizontal < 0.001 && Math.abs(rise) < 0.001)
      ? null
      : Math.atan2(Math.abs(rise), horizontal) / rad;
  return {
    horizontal,
    bearing,
    rise,
    inclination,
    spatial: rise === null ? null : Math.hypot(horizontal, rise),
  };
}
export function measurementMetrics(points: MeasurePoint[]) {
  const segments = points
    .slice(1)
    .map((point, i) => segmentMetrics(points[i], point));
  return {
    segments,
    horizontal: segments.reduce((n, s) => n + s.horizontal, 0),
    spatial:
      !segments.length || segments.some((s) => s.spatial === null)
        ? null
        : segments.reduce((n, s) => n + s.spatial!, 0),
    bearing:
      points.length < 2
        ? null
        : segmentMetrics(points[0], points[points.length - 1]).bearing,
  };
}
export const lengthLabel = (value: number | null) =>
  value === null
    ? '待定'
    : value < 1000
      ? `${value.toFixed(1)} m`
      : `${(value / 1000).toFixed(3)} km`;
