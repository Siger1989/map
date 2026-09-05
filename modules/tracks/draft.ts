import type { Coordinate } from '../navigation/types';
import { equalCoordinate, moveSegmentsNode } from './editing.ts';
export type DrawingMode = 'points' | 'freehand';
type Operation =
  | {
      kind: 'point' | 'stroke';
      segment: number;
      seeded?: boolean;
    }
  | {
      kind: 'move';
      segments: Coordinate[][];
      nodes?: Coordinate[];
      pointLine: number | null;
    };
export type TrackDraft = {
  segments: Coordinate[][];
  kinds: DrawingMode[];
  history: Operation[];
  pointLine: number | null;
  nodes?: Coordinate[];
};
export const EMPTY_DRAFT: TrackDraft = {
  segments: [],
  kinds: [],
  history: [],
  pointLine: null,
};
export function appendVertex(draft: TrackDraft, point: Coordinate): TrackDraft {
  const index = draft.pointLine ?? draft.segments.length;
  const segments = draft.segments.map((line) => line.slice()),
    kinds = [...draft.kinds];
  const seed = draft.pointLine === null ? draft.segments.at(-1)?.at(-1) : null;
  if (draft.pointLine === null) {
    segments.push(seed ? [seed, point] : [point]);
    kinds.push('points');
  } else segments[index].push(point);
  return {
    ...draft,
    segments,
    kinds,
    pointLine: index,
    history: [
      ...draft.history,
      { kind: 'point', segment: index, seeded: !!seed },
    ],
  };
}
export function appendStroke(
  draft: TrackDraft,
  points: Coordinate[],
): TrackDraft {
  if (points.length < 2) return draft;
  return {
    ...draft,
    segments: [...draft.segments, points],
    kinds: [...draft.kinds, 'freehand'],
    pointLine: null,
    history: [
      ...draft.history,
      { kind: 'stroke', segment: draft.segments.length },
    ],
  };
}
export function undoDraft(draft: TrackDraft): TrackDraft {
  const operation = draft.history.at(-1);
  if (!operation) return draft;
  if (operation.kind === 'move')
    return {
      ...draft,
      segments: operation.segments,
      nodes: operation.nodes,
      pointLine: operation.pointLine,
      history: draft.history.slice(0, -1),
    };
  const segments = draft.segments.map((line) => line.slice()),
    kinds = [...draft.kinds],
    history = draft.history.slice(0, -1);
  if (operation.kind === 'point') segments[operation.segment].pop();
  if (
    operation.kind === 'stroke' ||
    operation.seeded ||
    segments[operation.segment].length === 0
  ) {
    segments.splice(operation.segment, 1);
    kinds.splice(operation.segment, 1);
  }
  const prior = history.at(-1);
  return {
    ...draft,
    segments,
    kinds,
    history,
    pointLine:
      prior?.kind === 'point'
        ? prior.segment
        : prior?.kind === 'move'
          ? prior.pointLine
          : null,
  };
}
export function draftVertices(draft: TrackDraft) {
  return [
    ...(draft.nodes ?? []),
    ...draft.segments.flatMap((line, i) =>
      draft.kinds[i] === 'points' ? line : [],
    ),
  ];
}

export function moveDraftNode(
  draft: TrackDraft,
  from: Coordinate,
  to: Coordinate,
): TrackDraft {
  if (
    equalCoordinate(from, to) ||
    !draft.segments.some((line) => line.some((p) => equalCoordinate(p, from)))
  )
    return draft;
  return {
    ...draft,
    segments: moveSegmentsNode(draft.segments, from, to),
    nodes: draft.nodes?.map((point) =>
      equalCoordinate(point, from) ? [...to] : point,
    ),
    history: [
      ...draft.history,
      {
        kind: 'move',
        segments: draft.segments,
        nodes: draft.nodes,
        pointLine: draft.pointLine,
      },
    ],
  };
}
