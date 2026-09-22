import type { ManualTrack } from './drawing';
import { metresBetween } from '../navigation/types.ts';
import { analyzeRoute } from '../routeAnalysis/metrics.ts';
export { speedColor } from '../routeAnalysis/travelMode.ts';
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
