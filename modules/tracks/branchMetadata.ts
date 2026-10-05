import type { Coordinate } from '../navigation/types.ts';
import { metresBetween } from '../navigation/types.ts';
import { trackEdgeKey } from './alternatives.ts';
import { normalizeTrackStyle } from './style.ts';
import type { ManualTrack } from './drawing.ts';
import { inheritEdgeColors } from './edgeColors.ts';
import { inheritTrackDetails, type PointDetail } from './selectionDetails.ts';

type BranchMetadata = Pick<ManualTrack, 'pointDetails' | 'edgeNotes' | 'edgeColors'>;
type ColorEdge = { a: Coordinate; b: Coordinate; color: string | null };
type Cursor = {
  owner: ManualTrack;
  colors: Map<string, string | null>;
  notes: Map<string, string>;
  byPoint: Map<string, ColorEdge[]>;
  sourceColorRows: (string | null)[][];
  sourceNoteRows: (string | null)[][];
  pointDetails?: Record<string, PointDetail>;
  validPointDetails?: Record<string, PointDetail>;
  hasColors: boolean;
  hasNotes: boolean;
  duplicateEdges: boolean;
};

// A cursor is reusable only while its owner is the exact prior immutable snapshot.
// Advancing it invalidates aliases held by older snapshots; undo/forks rebuild safely.
const cursors = new WeakMap<ManualTrack, Cursor>();
const edgeKey = (a: Coordinate, b: Coordinate) => [a.join(','), b.join(',')].sort().join('|');
const pointKey = (point: Coordinate) => point.join(',');

function indexTrack(track: ManualTrack): Cursor {
  const colors = new Map<string, string | null>(), notes = new Map<string, string>();
  const byPoint = new Map<string, ColorEdge[]>(), edgeKeys = new Set<string>();
  const fallback = normalizeTrackStyle(track.style).color;
  let duplicateEdges = false, hasColors = false, hasNotes = false;
  const sourceColorRows = track.segments.map((line, segment) => {
    return line.slice(1).map((b, edge) => {
      const a = line[edge], key = edgeKey(a, b), color = track.edgeColors?.[segment]?.[edge] ?? fallback;
      if (edgeKeys.has(key)) duplicateEdges = true;
      edgeKeys.add(key);
      colors.set(key, color);
      if (color !== null) hasColors = true;
      const note = track.edgeNotes?.[segment]?.[edge];
      if (note !== null && note !== undefined) { notes.set(trackEdgeKey(a, b), note); hasNotes = true; }
      const candidate = { a, b, color };
      for (const point of [a, b]) {
        const id = pointKey(point), edges = byPoint.get(id);
        if (edges) edges.push(candidate);
        else byPoint.set(id, [candidate]);
      }
      return color;
    });
  });
  const sourceNoteRows = track.segments.map((line, segment) => line.slice(1).map((_, edge) => track.edgeNotes?.[segment]?.[edge] ?? null));
  const inherited = inheritTrackDetails(track.segments, [track]);
  return {
    owner: track, colors, notes, byPoint, sourceColorRows, sourceNoteRows,
    pointDetails: track.pointDetails, validPointDetails: inherited.pointDetails,
    hasColors, hasNotes, duplicateEdges,
  };
}

function colorFor(cursor: Cursor, a: Coordinate, b: Coordinate): string | null {
  const key = edgeKey(a, b);
  if (cursor.colors.has(key)) return cursor.colors.get(key)!;
  const aKey = pointKey(a), bKey = pointKey(b);
  const candidates = [...(cursor.byPoint.get(aKey) ?? []), ...(cursor.byPoint.get(bKey) ?? [])];
  const edge = candidates.find((candidate) =>
    (metresBetween(candidate.a, a) < 0.15 && metresBetween(candidate.b, b) < 0.15) ||
    (metresBetween(candidate.b, a) < 0.15 && metresBetween(candidate.a, b) < 0.15),
  );
  return edge ? edge.color : null;
}

/** Incremental fast path for ordinary unique-edge routes; ambiguous duplicates use the legacy remapper. */
export function inheritAppendedBranchMetadata(
  previous: ManualTrack,
  next: ManualTrack,
  branch: number,
  previousLength: number,
): BranchMetadata {
  const cursor = cursors.get(previous)?.owner === previous ? cursors.get(previous)! : indexTrack(previous);
  const line = next.segments[branch] ?? [];
  const startEdge = Math.max(0, previousLength - 1);
  const added: ColorEdge[] = [];
  const addedNotes: (string | null)[] = [];
  const seenAdded = new Set<string>();
  let ambiguous = cursor.duplicateEdges;
  for (let edge = startEdge; edge < line.length - 1; edge++) {
    const a = line[edge], b = line[edge + 1], key = edgeKey(a, b);
    if (cursor.colors.has(key) || seenAdded.has(key)) ambiguous = true;
    seenAdded.add(key);
    added.push({ a, b, color: colorFor(cursor, a, b) });
    addedNotes.push(cursor.notes.get(trackEdgeKey(a, b)) ?? null);
  }

  if (ambiguous) {
    const details = inheritTrackDetails(next.segments, [previous]);
    const edgeColors = inheritEdgeColors(next.segments, [previous]);
    return { ...details, edgeColors };
  }

  const notes = cursor.sourceNoteRows.slice();
  const colors = cursor.sourceColorRows.slice();
  const noteRow = notes[branch] = cursor.sourceNoteRows[branch]?.slice() ?? [];
  const colorRow = colors[branch] = cursor.sourceColorRows[branch]?.slice() ?? [];
  added.forEach((edge, i) => {
    const edgeIndex = startEdge + i;
    noteRow[edgeIndex] = addedNotes[i];
    colorRow[edgeIndex] = edge.color;
  });
  while (notes.length < next.segments.length) notes.push([]);
  while (colors.length < next.segments.length) colors.push([]);
  const hasNotes = cursor.hasNotes || addedNotes.some((note) => note !== null);
  const hasColors = cursor.hasColors || added.some((edge) => edge.color !== null);
  const edgeNotes = hasNotes ? notes : undefined;
  const edgeColors = hasColors ? colors : undefined;

  let validDetails = cursor.validPointDetails;
  for (let i = previousLength; i < line.length; i++) {
    const key = pointKey(line[i]), detail = cursor.pointDetails?.[key];
    if (detail && !validDetails?.[key]) validDetails = { ...validDetails, [key]: detail };
  }
  const pointDetails = validDetails;

  // Extend only after every new edge has inherited from the unchanged prior index.
  const fallback = normalizeTrackStyle(next.style).color;
  for (let i = 0; i < added.length; i++) {
    const edge = added[i], color = edge.color ?? fallback, note = addedNotes[i];
    cursor.colors.set(edgeKey(edge.a, edge.b), color);
    if (note !== null) cursor.notes.set(trackEdgeKey(edge.a, edge.b), note);
    const sourceEdge = { ...edge, color };
    for (const point of [edge.a, edge.b]) {
      const key = pointKey(point), candidates = cursor.byPoint.get(key);
      if (candidates) candidates.push(sourceEdge);
      else cursor.byPoint.set(key, [sourceEdge]);
    }
  }
  cursor.sourceColorRows = colors.map((row, i) => i === branch ? row.map((color) => color ?? fallback) : row);
  cursor.sourceNoteRows = edgeNotes ? notes : notes.map((row) => row.map(() => null));
  cursor.validPointDetails = pointDetails;
  cursor.hasColors = hasColors || (fallback !== null && next.segments.some((segment) => segment.length > 1));
  cursor.hasNotes = hasNotes;
  cursor.owner = next;
  cursors.set(next, cursor);
  return { pointDetails, edgeNotes, edgeColors };
}
