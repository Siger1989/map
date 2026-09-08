import type { Coordinate } from '../navigation/types';
import { equalCoordinate, moveSegmentsNode } from './editing.ts';
export type DrawingMode = 'points' | 'freehand';
type Operation =
  | {
      kind: 'point' | 'stroke';
      segment: number;
      seeded?: boolean;
      restoreNodes?: boolean;
      nodes?: Coordinate[];
    }
  | {
      kind: 'move';
      segments: Coordinate[][];
      nodes?: Coordinate[];
      pointLine: number | null;
      kinds?: DrawingMode[];
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
/** One click commits one complete road leg; intermediate bends are not edit handles. */
export function appendRoadVertex(
  draft: TrackDraft,
  points: Coordinate[],
): TrackDraft {
  const start = draft.segments.at(-1)?.at(-1);
  if (!start || !points.length) return draft;
  const next = appendStroke(draft, [start, ...points]);
  const existing = draftVertices(draft);
  const end = points.at(-1)!;
  return {
    ...next,
    nodes: existing.some((p) => equalCoordinate(p, end))
      ? draft.nodes
      : [...(draft.nodes ?? []), end],
    history: [
      ...draft.history,
      {
        kind: 'stroke',
        segment: draft.segments.length,
        restoreNodes: true,
        nodes: draft.nodes,
      },
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
      kinds: operation.kinds ?? draft.kinds,
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
    ...(operation.restoreNodes ? { nodes: operation.nodes } : {}),
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

/** Node toolbar edits remain part of the unsaved draft and share its undo stack. */
export function replaceDraftGeometry(
  draft: TrackDraft,
  segments: Coordinate[][],
  nodes: Coordinate[],
  kinds = draft.kinds,
  pointLine = draft.pointLine,
): TrackDraft {
  return {
    ...draft,
    segments,
    nodes,
    kinds,
    pointLine,
    history: [
      ...draft.history,
      {
        kind: 'move',
        segments: draft.segments,
        nodes: draft.nodes,
        pointLine: draft.pointLine,
        kinds: draft.kinds,
      },
    ],
  };
}

export function branchDraft(draft: TrackDraft, point: Coordinate): TrackDraft {
  if (
    !draft.segments.some((line) => line.some((p) => equalCoordinate(p, point)))
  )
    throw new Error('节点已变化，请重新选择。');
  return replaceDraftGeometry(
    draft,
    [...draft.segments, [point]],
    [...draftVertices(draft), point],
    [...draft.kinds, 'points'],
    draft.segments.length,
  );
}

export function removeDraftNode(
  draft: TrackDraft,
  point: Coordinate,
): TrackDraft {
  const segments: Coordinate[][] = [],
    kinds: DrawingMode[] = [];
  let pointLine: number | null = null;
  draft.segments.forEach((line, i) => {
    const next = line.filter((p) => !equalCoordinate(p, point));
    if (next.length === line.length) {
      // Keep unrelated, unfinished strokes intact.
    } else if (line.length > 1 && next.length < 2) {
      throw new Error('每段至少保留两个节点；请选择中间节点。');
    }
    if (next.length) {
      if (i === draft.pointLine) pointLine = segments.length;
      segments.push(next);
      kinds.push(draft.kinds[i]);
    }
  });
  return replaceDraftGeometry(
    draft,
    segments,
    draftVertices(draft).filter((p) => !equalCoordinate(p, point)),
    kinds,
    pointLine,
  );
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
