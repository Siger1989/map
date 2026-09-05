import type { Coordinate } from '../navigation/types';
import type { ManualTrack, ScreenPoint } from './drawing';

export type TrackNode = { trackId: string; coordinate: Coordinate };
export const DRAFT_ID = 'draft';
export const equalCoordinate = (a: Coordinate, b: Coordinate) =>
  a[0] === b[0] && a[1] === b[1];

/** Shared junctions within this track move together; nearby independent points do not. */
export function moveSegmentsNode(
  segments: Coordinate[][],
  from: Coordinate,
  to: Coordinate,
): Coordinate[][] {
  return segments.map((line) =>
    line.map((point) => (equalCoordinate(point, from) ? [...to] : point)),
  );
}

export function moveTrackNode(
  track: ManualTrack,
  from: Coordinate,
  to: Coordinate,
): ManualTrack {
  return {
    ...track,
    segments: moveSegmentsNode(track.segments, from, to),
    nodes: track.nodes?.map((point) =>
      equalCoordinate(point, from) ? [...to] : point,
    ),
  };
}

/** Keep explicit nodes/endpoints, and reveal spaced freehand handles when selected. */
export function nodeHandles(
  segments: Coordinate[][],
  explicit: Coordinate[],
  selected: boolean,
  project: (point: Coordinate) => ScreenPoint,
): Coordinate[] {
  const result = new Map<string, Coordinate>();
  const actual = new Set(segments.flat().map((point) => point.join(',')));
  const add = (point: Coordinate) => result.set(point.join(','), point);
  explicit.filter((point) => actual.has(point.join(','))).forEach(add);
  for (const line of segments) {
    if (!line.length) continue;
    add(line[0]);
    add(line.at(-1)!);
    if (!selected) continue;
    let previous = project(line[0]);
    for (const point of line.slice(1, -1)) {
      const screen = project(point);
      if (Math.hypot(screen.x - previous.x, screen.y - previous.y) >= 24) {
        add(point);
        previous = screen;
      }
    }
  }
  return [...result.values()];
}
