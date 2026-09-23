import { collectData } from '../outdoor/exchange.ts';
import { saveWorkbench } from '../collections/workbenchStore.ts';
import { prepareRouteEdit, type RouteEditSession } from './routeEdit.ts';
import { markerChainage } from './linePoint.ts';

/** Joined geometry, removed source archives and marker bindings commit or roll back together. */
export function storeJoinedRouteEdit(
  session: RouteEditSession,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  id: string,
  now: number,
) {
  const before = collectData(storage),
    result = prepareRouteEdit(session, before.tracks, id, now);
  const remaining = new Set(result.records.map((t) => t.id));
  const removed = new Set(
    before.tracks.filter((t) => !remaining.has(t.id)).map((t) => t.id),
  );
  const next = {
    ...before,
    tracks: result.records,
    annotations: before.annotations.map((a) => {
      if (!a.trackAnchor) return a;
      if (result.removed)
        return removed.has(a.trackAnchor.trackId)
          ? { ...a, trackAnchor: undefined }
          : a;
      return removed.has(a.trackAnchor.trackId) ||
        a.trackAnchor.trackId === result.track.id
        ? {
            ...a,
            trackAnchor: {
              trackId: result.track.id,
              distance: markerChainage(result.track.segments, a.coordinates)
                .distance,
            },
          }
        : a;
    }),
  };
  if (session.pendingMarkers?.length) {
    if (result.removed) throw new Error('路线已清空，无法绑定新增标记；请撤销删除或撤销新增标记');
    next.annotations.push(...session.pendingMarkers.map(marker => ({...marker,trackAnchor:{trackId:result.track.id,distance:markerChainage(result.track.segments,marker.coordinates).distance}})));
  }
  if (next.collections)
    next.collections = {
      ...next.collections,
      assignments: Object.fromEntries(
        Object.entries(next.collections.assignments).filter(
          ([key]) => !removed.has(key.slice(6)) || !key.startsWith('track:'),
        ),
      ),
      order: next.collections.order.filter(
        (key) => !key.startsWith('track:') || !removed.has(key.slice(6)),
      ),
      treeOrder: next.collections.treeOrder?.filter(
        (key) => !key.startsWith('track:') || !removed.has(key.slice(6)),
      ),
    };
  const saved = saveWorkbench(before, next, storage);
  return { ...result, records: saved.tracks };
}
