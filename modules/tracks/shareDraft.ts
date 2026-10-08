import { DRAFT_ID } from './editing.ts';
import type { Coordinate } from '../navigation/types.ts';
import type { ManualTrack } from './drawing.ts';
import type { TrackEdgeColors } from './edgeColors.ts';
import type { TrackStyle } from './style.ts';

/** Build an export-only route from the live draft. It never saves or timestamps it. */
export function shareDraftTrack(input: {
  segments: Coordinate[][];
  name?: string | null;
  style: TrackStyle;
  edgeColors?: TrackEdgeColors;
  colorConditions?: Record<string, string>;
}): ManualTrack | null {
  if (input.segments.reduce((count, line) => count + line.length, 0) < 2) return null;
  return {
    id: DRAFT_ID,
    name: input.name?.trim().slice(0, 60) || '路线草稿',
    createdAt: 0,
    source: 'manual',
    segments: input.segments,
    style: input.style,
    ...(input.edgeColors ? { edgeColors: input.edgeColors } : {}),
    ...(input.colorConditions ? { colorConditions: input.colorConditions } : {}),
  };
}
