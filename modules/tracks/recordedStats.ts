import type { ManualTrack } from './drawing';
import { metresBetween } from '../navigation/types.ts';
import { ANALYSIS_POLICY } from '../routeAnalysis/config.ts';

/** Only measured adjacent samples contribute; never bridge a pause or missing interval. */
export function recordedStats(track: Pick<ManualTrack, 'segments' | 'samples'>) {
  let start: number | null = null, end: number | null = null;
  let distance = 0, timedDistance = 0, seconds = 0, movingSeconds = 0, movingDistance = 0;
  let maxSpeed: number | null = null, ascent = 0, descent = 0, heightPairs = 0;
  let minimum: number | null = null, maximum: number | null = null, points = 0;
  track.segments.forEach((line, part) => line.forEach((point, i) => {
    points++;
    const sample = track.samples?.[part]?.[i];
    if (sample?.time != null && Number.isFinite(sample.time)) {
      start = Math.min(start ?? sample.time, sample.time);
      end = Math.max(end ?? sample.time, sample.time);
    }
    if (sample?.altitude != null && Number.isFinite(sample.altitude)) {
      minimum = Math.min(minimum ?? sample.altitude, sample.altitude);
      maximum = Math.max(maximum ?? sample.altitude, sample.altitude);
    }
    if (!i) return;
    const metres = metresBetween(line[i - 1], point);
    distance += metres;
    const prior = track.samples?.[part]?.[i - 1];
    if (prior?.time == null || sample?.time == null) return;
    const dt = (sample.time - prior.time) / 1000;
    if (!Number.isFinite(dt) || dt <= 0 || dt > ANALYSIS_POLICY.maximumGapSeconds || metres / dt > ANALYSIS_POLICY.maximumSpeedMetresPerSecond) return;
    seconds += dt; timedDistance += metres;
    const speed = metres / dt * 3.6;
    maxSpeed = Math.max(maxSpeed ?? 0, speed);
    if (speed >= 1) { movingSeconds += dt; movingDistance += metres; }
    if (prior.altitude != null && sample.altitude != null && Number.isFinite(prior.altitude) && Number.isFinite(sample.altitude)) {
      const change = sample.altitude - prior.altitude;
      ascent += Math.max(0, change); descent += Math.max(0, -change); heightPairs++;
    }
  }));
  const elapsed = start !== null && end !== null ? (end - start) / 1000 : null;
  return { start, end, elapsed, seconds, movingSeconds, gapSeconds: elapsed === null ? null : Math.max(0, elapsed - seconds),
    distance, points, parts: track.segments.filter(line => line.length).length,
    averageSpeed: seconds > 0 ? timedDistance / seconds * 3.6 : null,
    movingSpeed: movingSeconds > 0 ? movingDistance / movingSeconds * 3.6 : null,
    maxSpeed, minimum, maximum, ascent: heightPairs ? ascent : null, descent: heightPairs ? descent : null };
}
export function recordedDuration(seconds: number | null) {
  if (seconds === null) return '无时间数据';
  const s = Math.max(0, Math.round(seconds));
  return s >= 3600 ? `${Math.floor(s / 3600)}时${Math.floor(s % 3600 / 60)}分` : `${Math.floor(s / 60)}分${s % 60}秒`;
}
