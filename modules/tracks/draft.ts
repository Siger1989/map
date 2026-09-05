import type { Coordinate } from '../navigation/types';
export type DrawingMode = 'points' | 'freehand';
type Operation = {
  kind: 'point' | 'stroke';
  segment: number;
  seeded?: boolean;
};
export type TrackDraft = {
  segments: Coordinate[][];
  kinds: DrawingMode[];
  history: Operation[];
  pointLine: number | null;
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
    segments,
    kinds,
    history,
    pointLine: prior?.kind === 'point' ? prior.segment : null,
  };
}
export function draftVertices(draft: TrackDraft) {
  return draft.segments.flatMap((line, i) =>
    draft.kinds[i] === 'points' ? line : [],
  );
}
