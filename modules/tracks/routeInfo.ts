import type { Annotation } from '../annotations/data';
import type { ManualTrack } from './drawing';
import { connectedNetwork } from '../guidance/network.ts';
import { hasLoosePoints } from './snapping.ts';
export const linkedRouteMarkers = (
  track: Pick<ManualTrack, 'id' | 'sourceTrackIds'>,
  markers: Annotation[],
) =>
  markers.filter(
    (m) =>
      m.trackAnchor &&
      (m.trackAnchor.trackId === track.id ||
        track.sourceTrackIds?.includes(m.trackAnchor.trackId)),
  );
export function routeConnectionLabel(
  track: Pick<ManualTrack, 'segments'>,
): string {
  if (!track.segments.length || hasLoosePoints(track.segments))
    return '含未完成线段';
  try {
    connectedNetwork(
      { id: 'check', name: '', createdAt: 0, segments: track.segments },
      [],
    );
    return track.segments.length > 1 ? '已连通分叉' : '已连通';
  } catch {
    return '存在断开路段';
  }
}
