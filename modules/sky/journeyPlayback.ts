import { metresBetween, type PlannedRoute } from "../navigation/types.ts";
import type { ManualTrack } from "../tracks/drawing.ts";
import { journeyBearing, journeyDestination, JOURNEY_CAMERA_HEIGHT_M, JOURNEY_CAMERA_LAG_M, limitCameraOffset, normalizeJourneyCameraDistance } from "./journeyCamera.ts";
import { createJourneyGimbal, JOURNEY_GIMBAL_RADIUS_SECONDS } from "./journeyGimbal.ts";
import { indexJourneyTurns, journeyCameraHeading, type JourneyTurn } from "./journeyHeadingProfile.ts";

export type SkyJourneyCoordinate = readonly [longitude: number, latitude: number];

export interface SkyJourneyPoint {
  coordinates: SkyJourneyCoordinate;
  elevationM?: number | null;
  timeMs?: number | null;
}

export interface SkyJourney {
  name: string;
  segments: readonly (readonly SkyJourneyPoint[])[];
}

interface JourneyPlaybackPoint extends SkyJourneyPoint {
  distanceM: number;
}

export interface JourneyPlaybackSegment {
  points: readonly JourneyPlaybackPoint[];
  turns: readonly JourneyTurn[];
  startDistanceM: number;
  endDistanceM: number;
}

export interface JourneyPlaybackModel {
  totalDistanceM: number;
  segments: readonly JourneyPlaybackSegment[];
  pointCount: number;
}

export interface JourneyPlaybackFrame {
  coordinates: [number, number];
  elevationM: number | null;
  timeMs: number | null;
  distanceM: number;
  segmentIndex: number;
  headingDeg: number | null;
  arrowHeadingDeg: number | null;
  cameraHeadingDeg: number | null;
  cameraTarget: SkyJourneyCoordinate;
  lookAt: [number, number];
  lookAtElevationM: number | null;
  cameraCoordinates: [number, number];
  cameraElevationM: number | null;
  cameraHeightM: number;
  cameraLagM: number;
  cameraTurnRadiusM: number;
  cameraMotion?: JourneyCameraMotion;
}

interface JourneyCameraMotion {
  metresPerSecond: number;
  sample(segment: JourneyPlaybackSegment, distanceM: number): { coordinates: [number, number]; headingDeg: number };
}

interface JourneyPlaybackSettings {
  lookAheadM?: number;
  cameraLagM?: number;
  cameraHeightM?: number;
  turnRadiusM?: number;
  cameraMotion?: JourneyCameraMotion;
}

export const SKY_JOURNEY_EVENT = "shantu:sky-journey";

export function requestSkyJourney(journey: SkyJourney) {
  window.dispatchEvent(new CustomEvent<SkyJourney>(SKY_JOURNEY_EVENT, { detail: journey }));
}


export function savedTrackSkyJourney(track: ManualTrack): SkyJourney {
  return {
    name: track.name,
    segments: track.segments.map((segment, part) => segment.map((coordinates, index) => ({
      coordinates,
      elevationM: track.samples?.[part]?.[index]?.altitude ?? null,
      timeMs: track.samples?.[part]?.[index]?.time ?? null,
    }))),
  };
}

export function plannedRouteSkyJourney(route: PlannedRoute, name: string): SkyJourney {
  const segments: SkyJourneyPoint[][] = [];
  const sources = route.segments?.length
    ? route.segments
    : (route.roadLegs?.length ? route.roadLegs : [route.coordinates]).map(coordinates => ({ kind: "road", coordinates }));
  let previous: SkyJourneyPoint[] | undefined;
  for (const source of sources) {
    // Temporary direct connections between disconnected saved tracks are not traversed.
    if (route.geometryKind === "track" && source.kind === "access") {
      previous = undefined;
      continue;
    }
    const first = source.coordinates[0];
    if (!first) continue;
    const last = previous?.at(-1)?.coordinates;
    if (previous && last && first[0] === last[0] && first[1] === last[1]) {
      previous.push(...source.coordinates.slice(1).map(coordinates => ({ coordinates })));
    } else {
      previous = source.coordinates.map(coordinates => ({ coordinates }));
      segments.push(previous);
    }
  }
  return { name: route.name?.trim() || name, segments };
}
const DEGREES = 180 / Math.PI;

function isValidPoint(point: SkyJourneyPoint): boolean {
  const [lon, lat] = point.coordinates;
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
}

export function createJourneyPlayback(journey: SkyJourney): JourneyPlaybackModel {
  const segments: JourneyPlaybackSegment[] = [];
  let totalDistanceM = 0;
  let pointCount = 0;
  for (const segment of journey.segments) {
    let points: JourneyPlaybackPoint[] = [];
    let startDistanceM = totalDistanceM;
    const finishSegment = () => {
      if (points.length) segments.push({ points, turns: indexJourneyTurns(points), startDistanceM, endDistanceM: totalDistanceM });
      points = [];
      startDistanceM = totalDistanceM;
    };

    for (const point of segment) {
      if (!isValidPoint(point)) {
        finishSegment();
        continue;
      }
      const previous = points.at(-1);
      if (previous) totalDistanceM += metresBetween([...previous.coordinates], [...point.coordinates]);
      points.push({ ...point, distanceM: totalDistanceM });
      pointCount++;
    }
    finishSegment();
  }
  return { totalDistanceM, segments, pointCount };
}

function interpolateCoordinates(from: SkyJourneyCoordinate, to: SkyJourneyCoordinate, ratio: number): [number, number] {
  if (ratio <= 0) return [...from];
  if (ratio >= 1) return [...to];
  const unit = (coordinate: SkyJourneyCoordinate) => {
    const [longitude, latitude] = coordinate.map(degrees => degrees / DEGREES);
    return [Math.cos(latitude) * Math.cos(longitude), Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude)];
  };
  const first = unit(from);
  const second = unit(to);
  const separation = Math.acos(Math.min(1, Math.max(-1, first.reduce((sum, value, i) => sum + value * second[i], 0))));
  const sine = Math.sin(separation);
  if (sine < 0.000001) {
    // At very short separations a normalized longitude interpolation avoids precision loss.
    // Exactly antipodal points have no unique shorter geodesic, so choose one consistently.
    const delta = (to[0] - from[0] + 540) % 360 - 180;
    return [((from[0] + ratio * delta + 540) % 360) - 180, from[1] + ratio * (to[1] - from[1])];
  }
  const a = Math.sin((1 - ratio) * separation) / sine;
  const b = Math.sin(ratio * separation) / sine;
  const [x, y, z] = first.map((value, index) => a * value + b * second[index]);
  return [Math.atan2(y, x) * DEGREES, Math.atan2(z, Math.hypot(x, y)) * DEGREES];
}

function interpolateValue(from: number | null | undefined, to: number | null | undefined, ratio: number) {
  const first = typeof from === "number" && Number.isFinite(from) ? from : null;
  const second = typeof to === "number" && Number.isFinite(to) ? to : null;
  if (ratio <= 0) return first;
  if (ratio >= 1) return second;
  return first !== null && second !== null ? first + (second - first) * ratio : null;
}

function sampleSegment(segment: JourneyPlaybackSegment, distanceM: number) {
  const { points, startDistanceM, endDistanceM } = segment;
  let left = 0;
  let right = points.length - 1;
  if (distanceM <= startDistanceM) right = left;
  else if (distanceM >= endDistanceM) left = right;
  while (right - left > 1) {
    const middle = Math.floor((left + right) / 2);
    if (points[middle].distanceM <= distanceM) left = middle;
    else right = middle;
  }
  const from = points[left];
  const to = points[right];
  const ratio = from.distanceM < to.distanceM ? (distanceM - from.distanceM) / (to.distanceM - from.distanceM) : 0;
  return {
    coordinates: interpolateCoordinates(from.coordinates, to.coordinates, ratio),
    elevationM: interpolateValue(from.elevationM, to.elevationM, ratio),
    timeMs: ratio > 0 && typeof from.timeMs === "number" && typeof to.timeMs === "number" && to.timeMs < from.timeMs
      ? null : interpolateValue(from.timeMs, to.timeMs, ratio),
  };
}

/** Follow the actual local edge, including immediately after a switchback. */
function segmentHeading(segment: JourneyPlaybackSegment, distanceM: number, coordinates: SkyJourneyCoordinate): number | null {
  const points = segment.points;
  if (segment.endDistanceM - segment.startDistanceM < 0.001) return null;
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const middle = Math.floor((lo + hi) / 2);
    if (points[middle].distanceM <= distanceM + 0.001) lo = middle + 1;
    else hi = middle;
  }
  if (lo < points.length) return journeyBearing(coordinates, points[lo].coordinates);
  let prior = points.length - 2;
  while (prior >= 0 && points[prior].distanceM >= distanceM - 0.001) prior--;
  return prior >= 0 ? (journeyBearing(coordinates, points[prior].coordinates) + 180) % 360 : null;
}

/** Tie the gimbal to the selected replay duration so playback, seeking and export sample the same pose. */
export function journeyCameraSettings(model: JourneyPlaybackModel, playbackSeconds: number, distanceM = JOURNEY_CAMERA_LAG_M): JourneyPlaybackSettings {
  const cameraLagM = normalizeJourneyCameraDistance(distanceM);
  // Lift the distant view a little as the boom retreats, to keep the road and arrow visible.
  const cameraHeightM = JOURNEY_CAMERA_HEIGHT_M + (cameraLagM - JOURNEY_CAMERA_LAG_M) * .22;
  const framing = { cameraLagM, cameraHeightM };
  if (!(playbackSeconds > 0 && Number.isFinite(playbackSeconds) && model.totalDistanceM > 0)) return framing;
  const metresPerSecond = model.totalDistanceM / playbackSeconds;
  if (!Number.isFinite(metresPerSecond)) return framing;
  const turnRadiusM = Math.max(20, Math.min(2400, metresPerSecond * 0.6));
  const radiusSeconds = Math.min(JOURNEY_GIMBAL_RADIUS_SECONDS, 360 / metresPerSecond);
  const followRadiusSeconds = Math.min(radiusSeconds, 36 / metresPerSecond);
  const filters = new Map<JourneyPlaybackSegment, {
    wide: ReturnType<typeof createJourneyGimbal>;
    close: ReturnType<typeof createJourneyGimbal>;
  }>();
  return {
    ...framing,
    turnRadiusM,
    cameraMotion: {
      metresPerSecond,
      sample(segment, distanceM) {
        let pair = filters.get(segment);
        if (!pair) {
          const duration = (segment.endDistanceM - segment.startDistanceM) / metresPerSecond;
          const sample = (seconds: number) => {
            const station = Math.min(segment.endDistanceM, segment.startDistanceM + seconds * metresPerSecond);
            const { coordinates } = sampleSegment(segment, station);
            const heading = segmentHeading(segment, station, coordinates) ?? 0;
            return {
              coordinates,
              headingDeg: journeyCameraHeading(segment.turns, station - segment.startDistanceM, heading, turnRadiusM),
            };
          };
          const wide = createJourneyGimbal(0, duration, sample, radiusSeconds);
          const close = followRadiusSeconds < radiusSeconds ? createJourneyGimbal(0, duration, sample, followRadiusSeconds) : wide;
          pair = { wide, close };
          if (filters.size >= 8) filters.delete(filters.keys().next().value!);
          filters.set(segment, pair);
        }
        const time = (distanceM - segment.startDistanceM) / metresPerSecond;
        const wide = pair.wide(time);
        if (pair.wide === pair.close) return wide;
        // Use the shorter window to stay with the road at a tight bend. Both targets
        // are filtered so keeping the arrow in view doesn't reintroduce GPS jitter.
        const close = pair.close(time).coordinates;
        const separation = metresBetween(close, wide.coordinates);
        const offset = limitCameraOffset(separation, cameraLagM * .09);
        return {
          coordinates: separation > offset ? interpolateCoordinates(close, wide.coordinates, offset / separation) : wide.coordinates,
          headingDeg: wide.headingDeg,
        };
      },
    },
  };
}

export function getJourneyPlaybackFrame(
  model: JourneyPlaybackModel,
  requestedDistanceM: number,
  settings: JourneyPlaybackSettings = {},
): JourneyPlaybackFrame | null {
  const { segments, totalDistanceM } = model;
  if (!segments.length || !Number.isFinite(requestedDistanceM)) return null;
  const distanceM = Math.min(totalDistanceM, Math.max(0, requestedDistanceM));
  let lo = 0;
  let hi = segments.length - 1;
  if (distanceM === 0) hi = 0;
  // A shared boundary belongs to the preceding segment on the exact tick.
  while (lo < hi) {
    const middle = Math.floor((lo + hi) / 2);
    if (segments[middle].endDistanceM < distanceM) lo = middle + 1;
    else hi = middle;
  }
  return getJourneySegmentFrame(segments[lo], lo, distanceM, settings);
}

/** A control point at a new segment's start must use that segment's terrain and direction. */
export function getJourneySegmentFrame(
  segment: JourneyPlaybackSegment,
  segmentIndex: number,
  station: number,
  settings: JourneyPlaybackSettings,
): JourneyPlaybackFrame {
  const distanceM = Math.max(segment.startDistanceM, Math.min(segment.endDistanceM, station));
  const frame = sampleSegment(segment, distanceM);
  const nonNegative = (value: number | undefined, fallback: number) =>
    value !== undefined && Number.isFinite(value) ? Math.max(0, value) : fallback;
  const lookDistanceM = Math.min(segment.endDistanceM, distanceM + nonNegative(settings.lookAheadM, 30));
  const ahead = sampleSegment(segment, lookDistanceM);
  const headingDeg = segmentHeading(segment, distanceM, frame.coordinates);
  const cameraTurnRadiusM = nonNegative(settings.turnRadiusM, 20);
  const cameraHeightM = nonNegative(settings.cameraHeightM, JOURNEY_CAMERA_HEIGHT_M);
  const cameraLagM = nonNegative(settings.cameraLagM, JOURNEY_CAMERA_LAG_M);
  const cameraMotion = cameraLagM > 0 && headingDeg !== null ? settings.cameraMotion : undefined;
  const gimbal = cameraMotion?.sample(segment, distanceM);
  const stationInSegment = distanceM - segment.startDistanceM;
  const cameraHeadingDeg = gimbal?.headingDeg ?? (headingDeg === null ? null :
    journeyCameraHeading(segment.turns, stationInSegment, headingDeg, cameraTurnRadiusM));
  let cameraTarget: SkyJourneyCoordinate = frame.coordinates;
  if (gimbal) {
    // Keep the subject in front of the boom even when the stabilized target shortcuts a tight hairpin.
    const offset = metresBetween(frame.coordinates, gimbal.coordinates);
    const bounded = limitCameraOffset(offset, cameraLagM * .23, .85);
    cameraTarget = offset > bounded
      ? interpolateCoordinates(frame.coordinates, gimbal.coordinates, bounded / offset) : gimbal.coordinates;
  }
  const cameraCoordinates = cameraHeadingDeg === null ? frame.coordinates
    : journeyDestination(cameraTarget, cameraHeadingDeg + 180, cameraLagM);
  const arrowHeadingDeg = headingDeg !== null && cameraMotion ? journeyCameraHeading(
    segment.turns, stationInSegment, headingDeg, Math.min(35, cameraMotion.metresPerSecond * .14),
  ) : headingDeg;

  return {
    ...frame,
    distanceM,
    segmentIndex,
    headingDeg,
    arrowHeadingDeg,
    cameraHeadingDeg,
    cameraTarget,
    lookAt: ahead.coordinates,
    lookAtElevationM: ahead.elevationM,
    cameraCoordinates,
    cameraElevationM: frame.elevationM === null ? null : frame.elevationM + cameraHeightM,
    cameraHeightM,
    cameraLagM,
    cameraTurnRadiusM,
    cameraMotion,
  };
}
