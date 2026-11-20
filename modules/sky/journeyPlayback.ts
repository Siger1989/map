import { metresBetween, type PlannedRoute } from "../navigation/types.ts";
import type { ManualTrack } from "../tracks/drawing.ts";
import { journeyBearing, journeyDestination, JOURNEY_CAMERA_HEIGHT_M, JOURNEY_CAMERA_LAG_M } from "./journeyCamera.ts";
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
  cameraHeadingDeg: number | null;
  lookAt: [number, number];
  lookAtElevationM: number | null;
  cameraCoordinates: [number, number];
  cameraElevationM: number | null;
  cameraHeightM: number;
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

export function getJourneyPlaybackFrame(
  model: JourneyPlaybackModel,
  requestedDistanceM: number,
  settings: { lookAheadM?: number; cameraLagM?: number; cameraHeightM?: number; turnRadiusM?: number } = {},
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
  const segment = segments[lo];
  const frame = sampleSegment(segment, distanceM);
  const nonNegative = (value: number | undefined, fallback: number) =>
    value !== undefined && Number.isFinite(value) ? Math.max(0, value) : fallback;
  const lookDistanceM = Math.min(segment.endDistanceM, distanceM + nonNegative(settings.lookAheadM, 30));
  const ahead = sampleSegment(segment, lookDistanceM);
  const headingDeg = segmentHeading(segment, distanceM, frame.coordinates);
  const cameraHeadingDeg = headingDeg === null ? null : journeyCameraHeading(
    segment.turns, distanceM - segment.startDistanceM, headingDeg, nonNegative(settings.turnRadiusM, 20),
  );
  const cameraHeightM = nonNegative(settings.cameraHeightM, JOURNEY_CAMERA_HEIGHT_M);
  const cameraCoordinates = cameraHeadingDeg === null ? frame.coordinates
    : journeyDestination(frame.coordinates, cameraHeadingDeg + 180, nonNegative(settings.cameraLagM, JOURNEY_CAMERA_LAG_M));

  return {
    ...frame,
    distanceM,
    segmentIndex: lo,
    headingDeg,
    cameraHeadingDeg,
    lookAt: ahead.coordinates,
    lookAtElevationM: ahead.elevationM,
    cameraCoordinates,
    cameraElevationM: frame.elevationM === null ? null : frame.elevationM + cameraHeightM,
    cameraHeightM,
  };
}
