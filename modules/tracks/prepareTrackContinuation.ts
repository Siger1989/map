import { metresBetween, type Coordinate } from '../navigation/types.ts';
import type { TrackDraft } from './draft.ts';
import { MAX_TRACK_POINTS, type ManualTrack, type ScreenPoint } from './drawing.ts';
import { keepsOriginalPoints } from './provenance.ts';
import { pickLinePoint } from './linePoint.ts';
import { equalCoordinate } from './editing.ts';
import { insertTrackNode } from './nodeOperations.ts';
import { inheritTrackDetails } from './selectionDetails.ts';

export const TRACK_CONTINUATION_TOLERANCE = 12;

export type TrackContinuationHit = {
  track: ManualTrack;
  coordinate: Coordinate;
  /** Chainage from the beginning of the rendered traversal, in metres. */
  distance: number;
  /** Screen-space distance from the tap to the projected line, in CSS pixels. */
  offset: number;
};

/** Empty drafts can start from a visible saved line; populated drafts take precedence. */
export function pickTrackContinuation(
  tracks: readonly ManualTrack[],
  point: ScreenPoint,
  project: (coordinate: Coordinate) => ScreenPoint,
  options: { draftEmpty: boolean; tolerance?: number },
): TrackContinuationHit | null {
  if (!options.draftEmpty) return null;
  const tolerance = options.tolerance ?? TRACK_CONTINUATION_TOLERANCE;
  let best: TrackContinuationHit | null = null;
  for (const track of tracks) {
    if (track.hidden) continue;
    let travelled = 0;
    for (const segment of track.segments) {
      const hit = pickLinePoint(track.id, [segment], point, project, tolerance);
      if (!hit) {
        travelled += segment.slice(1).reduce((sum, coordinate, index) =>
          sum + metresBetween(segment[index], coordinate), 0);
        continue;
      }
      const screen = project(hit.coordinate);
      const offset = Math.hypot(screen.x - point.x, screen.y - point.y);
      if (!best || offset < best.offset)
        best = { track, coordinate: hit.coordinate, distance: travelled + hit.distance, offset };
      travelled += segment.slice(1).reduce((sum, coordinate, index) =>
        sum + metresBetween(segment[index], coordinate), 0);
    }
  }
  return best;
}

export type PreparedTrackContinuation = {
  draft: TrackDraft;
  editingId: string | null;
  copyName: string | null;
  anchor: Coordinate | null;
  /** Metadata-only geometry used to remap point and edge notes on save. */
  detailsSource?: ManualTrack;
};

export type TrackContinuationStart = Coordinate | {
  coordinate: Coordinate;
  distance: number;
};

/**
 * Copy saved geometry into a draft. An optional line hit splits only the draft
 * clone, then starts a connected branch at that exact junction. The archive is
 * never changed. Recorded/time-sampled tracks become untimed copies.
 */
export function prepareTrackContinuation(
  track: ManualTrack | null,
  startAt?: TrackContinuationStart,
): PreparedTrackContinuation {
  if (!track) {
    return {
      draft: { segments: [], kinds: [], history: [], pointLine: null },
      editingId: null,
      copyName: null,
      anchor: null,
    };
  }

  if (track.segments.length >= 100)
    throw new Error('路线已达100段，无法继续绘制；请先整理或复制路线。');
  const start = Array.isArray(startAt)
    ? { coordinate: startAt as Coordinate, distance: undefined }
    : startAt;
  const branch = start ? ([...start.coordinate] as Coordinate) : null;
  const sampledOrRecorded = keepsOriginalPoints(track) || track.simulation === true;
  const editable: ManualTrack = {
    ...track,
    source: 'manual',
    samples: undefined,
    simulation: undefined,
    ...(track.segments && {
      segments: track.segments.map((line) => line.map(([lng, lat]) => [lng, lat] as Coordinate)),
    }),
    ...(track.edgeColors && { edgeColors: track.edgeColors.map((line) => [...line]) }),
    ...(track.edgeNotes && { edgeNotes: track.edgeNotes.map((line) => [...line]) }),
    ...(track.pointDetails && { pointDetails: { ...track.pointDetails } }),
  };
  const inserted = branch
    ? insertTrackNode(editable, branch, start?.distance)
    : editable;
  const nodes = [...(inserted.nodes ?? [])];
  if (branch && !nodes.some((point) => equalCoordinate(point, branch)))
    nodes.push(branch);
  const segments = inserted.segments.map((line) => line.map(([lng, lat]) => [lng, lat] as Coordinate));
  if (branch) segments.push([branch]);
  const pointCount = segments.reduce((sum, line) => sum + line.length, 0);
  if (segments.length > 100 || pointCount >= MAX_TRACK_POINTS)
    throw new Error('续画起点会使路线超过100段或6000点上限，请换一条线或整理节点。');
  const pointLine = branch ? segments.length - 1 : null;
  const edgeColors = inserted.edgeColors?.map((line) => [...line]);
  if (branch && edgeColors) edgeColors.push([]);
  return {
    detailsSource: inserted,
    draft: {
      segments,
      kinds: [
        ...track.segments.map(() => 'freehand' as const),
        ...(branch ? ['points' as const] : []),
      ],
      history: [],
      pointLine,
      ...(edgeColors ? { edgeColors } : {}),
      ...(track.colorConditions ? { colorConditions: { ...track.colorConditions } } : {}),
      ...(nodes.length ? { nodes: nodes.map(([lng, lat]) => [lng, lat] as Coordinate) } : {}),
    },
    editingId: sampledOrRecorded ? null : track.id,
    copyName: sampledOrRecorded ? `${track.name} · 手绘副本` : null,
    anchor: branch ?? segments.at(-1)?.at(-1) ?? null,
  };
}

/** Remap metadata from the prepared split clone onto the final drawable geometry. */
export function trackContinuationDetails(
  segments: Coordinate[][],
  source: ManualTrack,
) {
  return inheritTrackDetails(segments, [source]);
}
