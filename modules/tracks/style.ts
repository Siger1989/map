import { normalizeTravelMode, type TravelMode } from '../routeAnalysis/travelMode.ts';
export type TrackStyle = {
  color: string;
  width: number;
  /** Node diameter in CSS pixels; omitted legacy styles use 8px. */
  pointSize?: number;
  opacity?: number;
  travelMode?: TravelMode;
  colorMode?: 'solid' | 'speed' | 'slope' | 'elevation';
};
export const DEFAULT_TRACK_STYLE: TrackStyle = {
  color: '#ffb477',
  width: 1.5,
  opacity: 1,
};
export const TRACK_STYLE_STORAGE = 'guanyun.track-style.v1';
export const TRACK_COLORS = [
  '#ffb477',
  '#ff637c',
  '#55d6ff',
  '#a5efc8',
  '#e7bf55',
  '#ffffff',
];
export function normalizeTrackStyle(input: unknown): TrackStyle {
  const value = input as Partial<TrackStyle> | null;
  return {
    ...(typeof value?.pointSize === 'number' && Number.isFinite(value.pointSize) ? { pointSize: Math.round(Math.max(4, Math.min(16, value.pointSize))) } : {}),
    travelMode: normalizeTravelMode(value?.travelMode),
    ...(value?.colorMode === 'speed' ||
    value?.colorMode === 'slope' ||
    value?.colorMode === 'elevation'
      ? { colorMode: value.colorMode }
      : {}),
    opacity:
      typeof value?.opacity === 'number' && Number.isFinite(value.opacity)
        ? Math.round(Math.max(0.1, Math.min(1, value.opacity)) * 100) / 100
        : 1,
    color:
      typeof value?.color === 'string' && /^#[a-f0-9]{6}$/i.test(value.color)
        ? value.color.toLowerCase()
        : DEFAULT_TRACK_STYLE.color,
    width:
      typeof value?.width === 'number' && Number.isFinite(value.width)
        ? Math.round(Math.min(5, Math.max(0.5, value.width)) * 2) / 2
        : DEFAULT_TRACK_STYLE.width,
  };
}
