import { coordinate, type Coordinate } from '../navigation/types.ts';
export type PositionFix = {
  coordinates: Coordinate;
  accuracy: number;
  timestamp: number;
  source?: 'gps' | 'network';
  speed?: number;
  heading?: number;
  headingAccuracy?: number;
};
export type LocationMode = 'auto' | 'network';
export type DirectionMode = 'free' | 'north' | 'device' | 'motion';
export function positionFix(position: GeolocationPosition): PositionFix | null {
  const c: Coordinate = [position.coords.longitude, position.coords.latitude];
  return coordinate(c) &&
    Number.isFinite(position.coords.accuracy) &&
    position.coords.accuracy >= 0 &&
    Number.isFinite(position.timestamp)
    ? {
        coordinates: c,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp,
        ...(Number.isFinite(position.coords.speed) && position.coords.speed! >= 0 ? { speed: position.coords.speed! } : {}),
        ...(Number.isFinite(position.coords.heading) && position.coords.heading! >= 0 && position.coords.heading! < 360 ? { heading: position.coords.heading! } : {}),
      }
    : null;
}
export const wrapHeading = (angle: number) => ((angle % 360) + 360) % 360;
export const headingDelta = (from: number, to: number) =>
  ((to - from + 540) % 360) - 180;
export function compassHeading(
  event: {
    alpha: number | null;
    absolute: boolean;
    webkitCompassHeading?: number;
    webkitCompassAccuracy?: number;
  },
  screenAngle: number,
) {
  if (Number.isFinite(event.webkitCompassHeading)) {
    if (
      event.webkitCompassAccuracy !== undefined &&
      (event.webkitCompassAccuracy < 0 || event.webkitCompassAccuracy > 45)
    )
      return null;
    return wrapHeading(event.webkitCompassHeading! + screenAngle);
  }
  // Relative gyroscope alpha cannot establish north. Only accept absolute readings.
  return event.absolute && event.alpha !== null && Number.isFinite(event.alpha)
    ? wrapHeading(360 - event.alpha + screenAngle)
    : null;
}
