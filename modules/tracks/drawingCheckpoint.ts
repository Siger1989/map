import { parseSavedTracks, type ManualTrack } from './drawing.ts';
import { EMPTY_DRAFT, type TrackDraft } from './draft.ts';
import { normalizeTrackStyle, type TrackStyle } from './style.ts';
import { materializeSections } from './sections.ts';

export const DRAWING_CHECKPOINT = 'shantu.drawing-draft.v1';
export type DrawingCheckpoint = {
  draft: TrackDraft;
  style: TrackStyle;
  name: string | null;
  editingId: string | null;
  startedAt: number;
  sectionId: string;
  note: string;
  baseRevision?: string;
  outputId?: string;
  completed?: string;
};
export function readDrawingCheckpoint(
  raw: string | null,
): DrawingCheckpoint | null {
  if (!raw) return null;
  const value = JSON.parse(raw) as DrawingCheckpoint;
  if (value?.completed) return null;
  if (!value || !Number.isFinite(value.startedAt) || !value.draft)
    throw new Error('绘制草稿无法读取');
  const track = parseSavedTracks(
    JSON.stringify([
      {
        ...value.draft,
        id: 'draft',
        name: value.name ?? '',
        createdAt: value.startedAt,
        source: 'manual',
      },
    ]),
  )[0];
  if (!track) throw new Error('绘制草稿无效，原备份未修改');
  return {
    ...value,
    name: typeof value.name === 'string' ? value.name.slice(0, 60) : null,
    editingId: typeof value.editingId === 'string' ? value.editingId : null,
    style: normalizeTrackStyle(value.style),
    sectionId:
      typeof value.sectionId === 'string' ? value.sectionId : 'recovered',
    note: typeof value.note === 'string' ? value.note.slice(0, 1600) : '',
    // Recovery deliberately opens a paused draft; old undo references are not trusted.
    draft: {
      ...EMPTY_DRAFT,
      ...track,
      kinds: track.segments.map(() => 'freehand'),
      pointLine: null,
      history: [],
    },
  };
}
export function writeDrawingCheckpoint(
  value: DrawingCheckpoint,
  storage: Pick<Storage, 'setItem' | 'getItem' | 'removeItem'>,
) {
  if (!value.draft.segments.length) {
    storage.removeItem(DRAWING_CHECKPOINT);
    if (storage.getItem(DRAWING_CHECKPOINT) !== null)
      throw new Error('草稿未清除');
    return;
  }
  const json = JSON.stringify(value);
  storage.setItem(DRAWING_CHECKPOINT, json);
  if (storage.getItem(DRAWING_CHECKPOINT) !== json)
    throw new Error('绘制草稿备份未写入，请先保存路线');
}
/** New physical edges use the current pen; existing section IDs and notes are immutable here. */
export function assignNewEdges(
  draft: TrackDraft,
  color: string,
  sectionId: string,
  note: string,
): TrackDraft {
  const sections = draft.sections ?? {
    edges: draft.segments.map((line) => line.slice(1).map(() => null)),
    notes: {},
  };
  const edges = sections.edges.map((row) => row.map((id) => id ?? sectionId));
  return {
    ...draft,
    edgeColors: sections.edges.map((row, i) =>
      row.map((id, j) =>
        id === null ? color : (draft.edgeColors?.[i]?.[j] ?? color),
      ),
    ),
    sections: { edges, notes: { ...sections.notes, [sectionId]: note } },
  };
}
export function draftFromTrack(track: ManualTrack): TrackDraft {
  return {
    ...EMPTY_DRAFT,
    segments: track.segments,
    nodes: track.nodes,
    edgeColors: track.edgeColors,
    colorConditions: track.colorConditions,
    sections: materializeSections(track),
    kinds: track.segments.map(() => 'freehand'),
    history: [],
    pointLine: null,
  };
}
