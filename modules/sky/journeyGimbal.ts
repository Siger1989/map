import type { SkyJourneyCoordinate } from './journeyPlayback.ts';
import { shortestTurn } from './skyPoseMotion.ts';

export const JOURNEY_GIMBAL_RADIUS_SECONDS = 0.75;

const RAD = Math.PI / 180;
const HALF_WINDOW_STEPS = 6;
const TRIANGLE_RADIUS = HALF_WINDOW_STEPS - 1;
const MAX_CACHED_KNOTS = 64;

type JourneyGimbalSample = { coordinates: SkyJourneyCoordinate; headingDeg: number };
type Knot = { x: number; y: number; z: number; headingDeg: number };

/**
 * Filter a single connected route in playback seconds. Extend its endpoint poses
 * as constants for filter support beyond the segment. The sampler must be pinned
 * to that segment, including when two segments share a playback timestamp.
 */
export function createJourneyGimbal(
  segmentStartSeconds: number,
  segmentEndSeconds: number,
  sample: (elapsedSeconds: number) => JourneyGimbalSample,
  radiusSeconds = JOURNEY_GIMBAL_RADIUS_SECONDS,
): (elapsedSeconds: number) => { coordinates: [number, number]; headingDeg: number } {
  const clampTime = (time: number) => Math.min(segmentEndSeconds, Math.max(segmentStartSeconds, time));
  const direct = (time: number) => {
    const { coordinates: [lon, lat], headingDeg } = sample(clampTime(time));
    return { coordinates: [lon, lat] as [number, number], headingDeg };
  };
  const step = radiusSeconds / HALF_WINDOW_STEPS;
  const duration = segmentEndSeconds - segmentStartSeconds;
  if (!(duration > 0 && step > 0 && Number.isFinite(step) && duration / step <= Number.MAX_SAFE_INTEGER - HALF_WINDOW_STEPS)) {
    return direct;
  }
  const knots = new Map<number, Knot>();
  const getKnot = (index: number) => {
    const existing = knots.get(index);
    if (existing) return existing;
    const { coordinates: [lon, lat], headingDeg } = direct(segmentStartSeconds + index * step);
    const cosLat = Math.cos(lat * RAD);
    const knot = { x: cosLat * Math.cos(lon * RAD), y: cosLat * Math.sin(lon * RAD), z: Math.sin(lat * RAD), headingDeg };
    if (knots.size >= MAX_CACHED_KNOTS) knots.delete(knots.keys().next().value!);
    knots.set(index, knot);
    return knot;
  };

  return elapsedSeconds => {
    const tick = (clampTime(elapsedSeconds) - segmentStartSeconds) / step;
    const index = Math.floor(tick);
    const fraction = tick - index;
    const fSquared = fraction * fraction;
    const fCubed = fSquared * fraction;
    const cubic = [
      (1 - fraction) ** 3 / 6,
      (4 - 6 * fSquared + 3 * fCubed) / 6,
      (1 + 3 * fraction + 3 * fSquared - 3 * fCubed) / 6,
      fCubed / 6,
    ];

    // Convolve a discrete symmetric triangle with the cubic B-spline basis.
    // The positive weights preserve constants and make the result C2 at each knot.
    let x = 0, y = 0, z = 0, heading = 0;
    let previousHeading: number | undefined;
    for (let offset = -TRIANGLE_RADIUS; offset <= TRIANGLE_RADIUS + 1; offset++) {
      let weight = 0;
      for (let basis = 0; basis < cubic.length; basis++) {
        weight += cubic[basis] * Math.max(0, TRIANGLE_RADIUS - Math.abs(offset - basis + 1));
      }
      const knot = getKnot(index + offset);
      // Unwrap in time order to retain the same signed turn near north and at U-turns.
      previousHeading = previousHeading === undefined ? knot.headingDeg : previousHeading + shortestTurn(previousHeading, knot.headingDeg);
      x += knot.x * weight;
      y += knot.y * weight;
      z += knot.z * weight;
      heading += previousHeading * weight;
    }

    const radialLength = Math.hypot(x, y, z);
    const coordinates: [number, number] = radialLength > 1e-8
      ? [Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD]
      : direct(elapsedSeconds).coordinates;
    const headingDeg = heading / (TRIANGLE_RADIUS * TRIANGLE_RADIUS);
    return { coordinates, headingDeg: (headingDeg % 360 + 360) % 360 };
  };
}
