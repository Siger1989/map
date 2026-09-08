import {
  coordinate,
  metresBetween,
  type Coordinate,
} from '../navigation/types.ts';
import type { TrackStyle } from './style';
export type ScreenPoint = { x: number; y: number };
export type ManualTrack = {
  id: string;
  name: string;
  segments: Coordinate[][];
  createdAt: number;
  updatedAt?: number;
  hidden?: boolean;
  sourceTrackIds?: string[];
  drawingLocation?: { coordinate: Coordinate; label: string };
  style?: TrackStyle;
  source?: 'recorded' | 'gpx' | 'kml' | 'manual' | 'shared';
  navigationMode?: 'auto' | 'bicycle' | 'pedestrian';
  sharedRoute?: {
    stops: { name: string; coordinates: Coordinate }[];
    duration: number | null;
    tolerance: number;
  };
  samples?: { time: number | null; altitude: number | null }[][];
  nodes?: Coordinate[];
};
export const MAX_TRACK_POINTS = 6000;
export const TRACK_STORAGE = 'guanyun.manual-tracks.v1';
/** A pulled string: motion inside the slack radius changes direction, not the tip. */
export function pullTip(
  tip: ScreenPoint,
  finger: ScreenPoint,
  length: number,
): ScreenPoint {
  const dx = finger.x - tip.x,
    dy = finger.y - tip.y,
    distance = Math.hypot(dx, dy);
  const radius = Math.max(16, Math.min(96, length));
  if (distance <= radius) return tip;
  const amount = (distance - radius) / distance;
  return { x: tip.x + dx * amount, y: tip.y + dy * amount };
}
export function trackDistance(segments: Coordinate[][]) {
  return segments.reduce(
    (total, points) =>
      total +
      points
        .slice(1)
        .reduce((length, p, i) => length + metresBetween(points[i], p), 0),
    0,
  );
}
export function parseSavedTracks(value: string | null): ManualTrack[] {
  if (!value) return [];
  const records: unknown = JSON.parse(value);
  if (!Array.isArray(records)) throw new Error('轨迹存档格式无效');
  return records
    .slice(0, 20)
    .filter(
      (v): v is ManualTrack =>
        v &&
        typeof v.id === 'string' &&
        typeof v.name === 'string' &&
        Number.isFinite(v.createdAt) &&
        (v.source === undefined ||
          ['recorded', 'gpx', 'kml', 'manual', 'shared'].includes(v.source)) &&
        (v.nodes === undefined ||
          (Array.isArray(v.nodes) &&
            v.nodes.length <= MAX_TRACK_POINTS &&
            v.nodes.every(coordinate))) &&
        Array.isArray(v.segments) &&
        v.segments.length <= 100 &&
        v.segments.every(
          (line: unknown) =>
            Array.isArray(line) && line.length >= 2 && line.every(coordinate),
        ) &&
        (v.samples === undefined ||
          (Array.isArray(v.samples) &&
            v.samples.length === v.segments.length &&
            v.samples.every(
              (line: unknown, index: number) =>
                Array.isArray(line) &&
                line.length === v.segments[index].length &&
                line.every(
                  (sample) =>
                    sample &&
                    (sample.time === null ||
                      (Number.isFinite(sample.time) &&
                        Math.abs(sample.time) <= 8640000000000000)) &&
                    (sample.altitude === null ||
                      Number.isFinite(sample.altitude)),
                ),
            ))) &&
        v.segments.reduce((n: number, line: unknown[]) => n + line.length, 0) <=
          MAX_TRACK_POINTS,
    )
    .map((track) => {
      // Optional new metadata must not make an otherwise valid legacy track disappear.
      const {
        updatedAt,
        drawingLocation,
        navigationMode,
        sharedRoute,
        hidden,
        sourceTrackIds,
        ...rest
      } = track;
      return {
        ...rest,
        ...(hidden === true ? { hidden: true } : {}),
        ...(Array.isArray(sourceTrackIds)
          ? {
              sourceTrackIds: [
                ...new Set(
                  sourceTrackIds.filter(
                    (id: unknown): id is string =>
                      typeof id === 'string' &&
                      id !== track.id &&
                      id.length <= 200,
                  ),
                ),
              ].slice(0, 100),
            }
          : {}),
        ...(sharedRoute &&
        Array.isArray(sharedRoute.stops) &&
        sharedRoute.stops.length >= 2 &&
        sharedRoute.stops.length <= 24 &&
        sharedRoute.stops.every(
          (s) =>
            s &&
            typeof s.name === 'string' &&
            s.name.length <= 120 &&
            coordinate(s.coordinates),
        ) &&
        (sharedRoute.duration === null ||
          (Number.isFinite(sharedRoute.duration) &&
            sharedRoute.duration >= 0)) &&
        Number.isFinite(sharedRoute.tolerance) &&
        sharedRoute.tolerance >= 0
          ? { sharedRoute }
          : {}),
        ...(['auto', 'bicycle', 'pedestrian'].includes(navigationMode ?? '')
          ? { navigationMode }
          : {}),
        ...(Number.isFinite(updatedAt) ? { updatedAt } : {}),
        ...(drawingLocation &&
        coordinate(drawingLocation.coordinate) &&
        typeof drawingLocation.label === 'string'
          ? {
              drawingLocation: {
                coordinate: drawingLocation.coordinate,
                label: drawingLocation.label.slice(0, 120),
              },
            }
          : {}),
      };
    });
}
