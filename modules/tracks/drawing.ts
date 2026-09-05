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
  style?: TrackStyle;
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
        v.segments.reduce((n: number, line: unknown[]) => n + line.length, 0) <=
          MAX_TRACK_POINTS,
    );
}
