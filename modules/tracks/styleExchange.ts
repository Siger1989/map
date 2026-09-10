import type { ManualTrack } from './drawing.ts';
import { validEdgeColors } from './edgeColors.ts';
import { validColorConditions } from './colorSections.ts';
import { normalizeTrackStyle } from './style.ts';
type Geometry = Pick<
  ManualTrack,
  'segments' | 'style' | 'edgeColors' | 'colorConditions'
>;
/** Optional GPX/KML extension; legacy files without one retain their defaults. */
export function trackStyleText(track: Geometry) {
  return JSON.stringify({
    style: normalizeTrackStyle(track.style),
    edgeColors: track.edgeColors,
    colorConditions: track.colorConditions,
  });
}
export function readTrackStyle(
  text: string,
  segments: ManualTrack['segments'],
) {
  const value = JSON.parse(text);
  if (
    !value ||
    typeof value !== 'object' ||
    !value.style ||
    typeof value.style.color !== 'string' ||
    !/^#[0-9a-f]{6}$/i.test(value.style.color) ||
    (value.edgeColors !== undefined &&
      !validEdgeColors(value.edgeColors, segments)) ||
    (value.colorConditions !== undefined &&
      !validColorConditions(value.colorConditions))
  )
    throw new Error('路线颜色或路况备注数据无效');
  return {
    style: normalizeTrackStyle(value.style),
    ...(value.edgeColors ? { edgeColors: value.edgeColors } : {}),
    ...(value.colorConditions
      ? { colorConditions: value.colorConditions }
      : {}),
  };
}
