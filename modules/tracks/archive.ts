import type { Coordinate } from '../navigation/types.ts';
import { placeCenter } from '../navigation/placeName.ts';
import {
  parseSavedTracks,
  MAX_SAVED_TRACKS,
  TRACK_STORAGE,
  type ManualTrack,
} from './drawing.ts';
import type { TrackStyle } from './style';
import { inheritEdgeColors, type TrackEdgeColors } from './edgeColors.ts';

export function drawingTime(time: number) {
  return new Date(time).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function drawingArea(
  track: Pick<ManualTrack, 'segments' | 'drawingLocation'>,
) {
  if (track.drawingLocation?.label) return track.drawingLocation.label;
  const point = track.drawingLocation?.coordinate ?? track.segments[0]?.[0];
  return point
    ? `${Math.abs(point[1]).toFixed(2)}°${point[1] < 0 ? 'S' : 'N'}, ${Math.abs(point[0]).toFixed(2)}°${point[0] < 0 ? 'W' : 'E'}`
    : '位置未知';
}

/** A committed drawing has its own identity; continuation preserves the original creation time. */
export function drawingRecord(input: {
  colorConditions?: Record<string, string>;
  edgeColors?: TrackEdgeColors;
  segments: Coordinate[][];
  nodes: Coordinate[];
  style: TrackStyle;
  prior?: ManualTrack;
  id: string;
  name: string;
  createdAt: number;
  now: number;
  place?: string;
}): ManualTrack {
  if (!input.segments.length || input.segments.some((line) => !line.length))
    throw new Error('还没有路线点可保存。');
  const location = input.prior?.drawingLocation ?? {
    coordinate: placeCenter(input.segments[0][0])!,
    label: input.place?.trim().slice(0, 120) || '',
  };
  const createdAt = input.prior?.createdAt ?? input.createdAt;
  const prior = { ...input.prior };
  delete prior.sharedRoute;
  const colors =
    input.edgeColors ??
    (input.prior?.edgeColors && input.style.color === input.prior.style?.color
      ? inheritEdgeColors(input.segments, [input.prior], input.style.color)
      : undefined);
  delete prior.edgeColors;
  return {
    ...prior,
    id: input.prior?.id ?? input.id,
    name:
      input.name.trim().slice(0, 60) ||
      input.prior?.name ||
      `${drawingArea({ segments: input.segments, drawingLocation: location })} · ${drawingTime(createdAt)}`.slice(
        0,
        60,
      ),
    segments: input.segments.map((line) =>
      line.map((p) => [...p] as Coordinate),
    ),
    nodes: input.nodes,
    createdAt,
    updatedAt: input.now,
    drawingLocation: location,
    source: 'manual',
    ...(colors ? { edgeColors: colors } : {}),
    ...(input.colorConditions
      ? { colorConditions: input.colorConditions }
      : {}),
    style: input.style,
  };
}

/** Read the latest archive before writing; quota/parse errors leave the draft with its caller. */
export function storeDrawingRecord(
  track: ManualTrack,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
) {
  const records = parseSavedTracks(storage.getItem(TRACK_STORAGE));
  const exists = records.some((record) => record.id === track.id);
  if (!exists && records.length >= MAX_SAVED_TRACKS)
    throw new Error(`已保存 ${MAX_SAVED_TRACKS} 条轨迹，请先整理路线存档。`);
  const next = exists
    ? records.map((record) => (record.id === track.id ? track : record))
    : [...records, track];
  storage.setItem(TRACK_STORAGE, JSON.stringify(next));
  return next;
}
