import type { ManualTrack } from './drawing';
import { metresBetween } from '../navigation/types.ts';
import { analyzeRoute } from '../routeAnalysis/metrics.ts';
export const RECORDED_SPEED_COLORS = [
  { max: 3, color: '#16853b', label: '0–3' },
  { max: 6, color: '#60a7ad', label: '3–6' },
  { max: 15, color: '#dba51d', label: '6–15' },
  { max: 30, color: '#ed782a', label: '15–30' },
  { max: Infinity, color: '#d73c51', label: '≥30' },
];
export const speedColor = (speed: number | null) => speed === null ? '#8b9699' : RECORDED_SPEED_COLORS.find(b => speed < b.max)!.color;
export function recordedProfile(track: ManualTrack, heights: ManualTrack = track) {
  const speeds = analyzeRoute(track).speeds;
  let distance = 0;
  return track.segments.flatMap((line, part) => line.map((coordinate, index) => {
    if (index) distance += metresBetween(line[index - 1], coordinate);
    const sample = track.samples?.[part]?.[index];
    const h = heights.samples?.[part]?.[index]?.altitude;
    const prior = index ? track.samples?.[part]?.[index - 1]?.time : null;
    const dt = prior != null && sample?.time != null ? (sample.time - prior) / 1000 : null;
    return { coordinate, distance, part, index, time: sample?.time ?? null,
      altitude: h != null && Number.isFinite(h) ? h : null,
      estimated: sample?.altitude == null && h != null,
      speed: index ? speeds[part][index - 1] : null,
      connected: index > 0 && !(dt !== null && (dt <= 0 || dt > 120)),
    };
  }));
}
