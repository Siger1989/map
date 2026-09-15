import { collectData } from './exchange.ts';
import { saveWorkbench } from '../collections/workbenchStore.ts';
import {
  type ManualTrack,
  MAX_SAVED_TRACKS,
  trackDistance,
} from '../tracks/drawing.ts';
import { hasTrackTime } from '../tracks/provenance.ts';
import { normalizeTrackStyle } from '../tracks/style.ts';
import { analyzeRoute } from '../routeAnalysis/metrics.ts';
import { metresBetween } from '../navigation/types.ts';

export const isTrip = (t: ManualTrack) =>
  t.source === 'recorded' || hasTrackTime(t);
export function tripStats(track: ManualTrack) {
  const times =
    track.samples
      ?.flat()
      .map((s) => s.time)
      .filter((t): t is number => t !== null && Number.isFinite(t)) ?? [];
  const metrics = analyzeRoute(track);
  let sampledSeconds = 0,
    sampledDistance = 0;
  track.segments.forEach((line, p) =>
    line.slice(1).forEach((b, i) => {
      if (metrics.speeds[p][i] !== null) {
        sampledSeconds +=
          (track.samples![p][i + 1].time! - track.samples![p][i].time!) / 1000;
        sampledDistance += metresBetween(line[i], b);
      }
    }),
  );
  const start = times.length ? Math.min(...times) : null,
    end = times.length ? Math.max(...times) : null;
  return {
    start,
    end,
    distance: trackDistance(track.segments),
    sampledSeconds,
    duration:
      start !== null && end !== null
        ? (Math.max(end, track.finishedAt ?? end) - start) / 1000
        : null,
    average:
      sampledSeconds > 0 ? (sampledDistance / sampledSeconds) * 3.6 : null,
    maximum: metrics.maximumSpeedKmh,
  };
}
/** An independent spatial route. Historical samples remain exclusively on the source trip. */
export function routeFromTrip(
  track: ManualTrack,
  name: string,
  id: string,
  now: number,
): ManualTrack {
  if (!isTrip(track)) throw new Error('请选择带记录信息的行程');
  const style = normalizeTrackStyle(track.style);
  return {
    id,
    name: name.trim().slice(0, 100) || `${track.name} 路线`,
    createdAt: now,
    source: 'manual',
    sourceTripId: track.id,
    segments: track.segments.map((line) => line.map((p) => [...p])),
    style: {
      ...style,
      colorMode: style.colorMode === 'speed' ? 'solid' : style.colorMode,
    },
    ...(track.samples && {
      samples: track.samples.map((line) =>
        line.map((s) => ({ time: null, altitude: s.altitude })),
      ),
    }),
    ...(track.edgeColors && {
      edgeColors: track.edgeColors.map((line) => [...line]),
    }),
    ...(track.sections && { sections: structuredClone(track.sections) }),
    ...(track.colorConditions && {
      colorConditions: { ...track.colorConditions },
    }),
    ...(track.nodes && { nodes: track.nodes.map((p) => [...p]) }),
  };
}
export function saveTripRoute(
  track: ManualTrack,
  name: string,
  storage: Storage = localStorage,
) {
  const before = collectData(storage),
    current = before.tracks.find((t) => t.id === track.id);
  if (JSON.stringify(current) !== JSON.stringify(track))
    throw new Error('原行程已变化，请重新打开后转换');
  if (before.tracks.length >= MAX_SAVED_TRACKS)
    throw new Error('路线存档已满，请先导出或整理');
  const route = routeFromTrip(track, name, crypto.randomUUID(), Date.now());
  const after = saveWorkbench(
    before,
    { ...before, tracks: [...before.tracks, route] },
    storage,
  );
  if (!after.tracks.some((t) => JSON.stringify(t) === JSON.stringify(route)))
    throw new Error('未确认保存成功，原行程保留');
  return route;
}
