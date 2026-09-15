import { parseSavedTracks, TRACK_STORAGE } from './drawing.ts';
import type { ManualTrack } from './drawing.ts';
import { inheritEdgeColors } from './edgeColors.ts';
import { inheritSections } from './sections.ts';
import { joinSegments } from './snapping.ts';
export function reverseDrawing(track: ManualTrack): ManualTrack {
  const segments = joinSegments(track.segments)
    .reverse()
    .map((line) => line.slice().reverse());
  return {
    ...track,
    segments,
    edgeColors: inheritEdgeColors(segments, [track]),
    sections: inheritSections(segments, [track]),
    ...(track.sharedRoute
      ? {
          sharedRoute: {
            ...track.sharedRoute,
            stops: track.sharedRoute.stops.slice().reverse(),
          },
        }
      : {}),
  };
}
/** Compatibility for old non-section archives. New section editing uses editSection instead. */
export function legacyColorNote(
  id: string,
  color: string,
  value: string,
  storage: Pick<Storage, 'getItem'>,
) {
  if (!/^#[0-9a-f]{6}$/i.test(color) || value.length > 1600)
    throw new Error('备注数据无效');
  const latest = parseSavedTracks(storage.getItem(TRACK_STORAGE));
  const track = latest.find((t) => t.id === id);
  if (!track) throw new Error('路线已变化，请重新打开');
  if (track.sections) throw new Error('请在路线编辑中选择具体路段修改备注');
  const colorConditions = { ...track.colorConditions, [color]: value.trim() };
  if (Object.keys(colorConditions).length > 128)
    throw new Error('旧备注记录已达128项');
  return latest.map((t) => (t.id === id ? { ...t, colorConditions } : t));
}
