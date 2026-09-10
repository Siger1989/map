import type { Transfer } from '../outdoor/exchange.ts';
import { MAX_TRACK_POINTS } from './drawing.ts';
import { connectedTracks, joinUniqueSegments } from './snapping.ts';
import { keepsOriginalPoints } from './provenance.ts';
import { preserveTrackColors } from './edgeColors.ts';
import { markerChainage } from './linePoint.ts';

/** Explicit merge replaces manual archives and rebinds their markers in one transaction. */
export function mergeTrackArchives(before: Transfer, id: string): Transfer {
  const seed = before.tracks.find((t) => t.id === id);
  if (!seed || keepsOriginalPoints(seed))
    throw new Error('请选择手绘路线进行合并。');
  const sources = connectedTracks(
    seed,
    before.tracks.filter((t) => !keepsOriginalPoints(t)),
  );
  const segments = joinUniqueSegments(sources.flatMap((t) => t.segments));
  if (sources.length < 2 && seed.segments.length === 1)
    throw new Error('没有端点相接的路线；请先连接端点。');
  if (segments.length !== 1)
    throw new Error('存在分岔或未连接部分，请先编辑成连续线路再合并。');
  if (segments[0].length > MAX_TRACK_POINTS)
    throw new Error('合并后点数超过 6000，暂不能合并。');
  const ids = new Set(sources.map((t) => t.id));
  const merged = preserveTrackColors(
    {
      ...seed,
      segments,
      sharedRoute: undefined,
      sourceTrackIds: [
        ...new Set(sources.flatMap((t) => [t.id, ...(t.sourceTrackIds ?? [])])),
      ]
        .filter((v) => v !== seed.id)
        .slice(0, 100),
      nodes: [
        ...new Map(
          sources.flatMap((t) => t.nodes ?? []).map((p) => [p.join(','), p]),
        ).values(),
      ].slice(0, MAX_TRACK_POINTS),
    },
    sources,
  );
  return {
    ...before,
    tracks: before.tracks
      .filter((t) => !ids.has(t.id) || t.id === seed.id)
      .map((t) => (t.id === seed.id ? merged : t)),
    annotations: before.annotations.map((a) =>
      a.trackAnchor && ids.has(a.trackAnchor.trackId)
        ? {
            ...a,
            trackAnchor: {
              trackId: seed.id,
              distance: markerChainage(segments, a.coordinates).distance,
            },
          }
        : a,
    ),
  };
}
