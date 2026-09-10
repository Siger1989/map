import type { Coordinate } from '../navigation/types.ts';
import { coordinate } from '../navigation/types.ts';
import { DRAFT_ID, equalCoordinate, moveTrackNode } from './editing.ts';
import { insertTrackNode, removeTrackNodes } from './nodeOperations.ts';
import {
  MAX_TRACK_POINTS,
  MAX_SAVED_TRACKS,
  parseSavedTracks,
  TRACK_STORAGE,
  type ManualTrack,
} from './drawing.ts';
import { normalizeTrackStyle, type TrackStyle } from './style.ts';
import { keepsOriginalPoints } from './provenance.ts';
import { inheritEdgeColors } from './edgeColors.ts';

export type RouteEditSnapshot = {
  track: ManualTrack;
  selected: Coordinate | null;
  branch: number | null;
  sources: ManualTrack[];
};
export type RouteEditSession = RouteEditSnapshot & {
  original: ManualTrack;
  history: RouteEditSnapshot[];
};
export function startRouteEdit(original: ManualTrack): RouteEditSession {
  return {
    original,
    track: {
      ...original,
      source: 'manual',
      samples: undefined,
      sharedRoute: undefined,
      style: normalizeTrackStyle(original.style),
      segments: original.segments.map((line) =>
        line.map((p) => [...p] as Coordinate),
      ),
      nodes: original.nodes?.map((p) => [...p] as Coordinate),
    },
    selected: null,
    branch: null,
    sources: original.id === DRAFT_ID ? [] : [original],
    history: [],
  };
}
function revise(
  session: RouteEditSession,
  change: Partial<RouteEditSnapshot>,
): RouteEditSession {
  const { track, selected, branch, sources } = session;
  return {
    ...session,
    ...change,
    history: [
      ...session.history.slice(-49),
      { track, selected, branch, sources },
    ],
  };
}
export function undoRouteEdit(session: RouteEditSession): RouteEditSession {
  const prior = session.history.at(-1);
  return prior
    ? { ...session, ...prior, history: session.history.slice(0, -1) }
    : session;
}
export function selectEditNode(
  session: RouteEditSession,
  point: Coordinate,
): RouteEditSession {
  if (
    !session.track.segments.some((line) =>
      line.some((p) => equalCoordinate(p, point)),
    )
  )
    throw new Error('请选择当前路线上的节点。');
  return { ...session, selected: point };
}
export function moveEditNode(
  session: RouteEditSession,
  from: Coordinate,
  to: Coordinate,
): RouteEditSession {
  if (session.branch !== null)
    throw new Error('分叉起点已固定，请先结束分叉再移动节点。');
  if (!coordinate(to)) throw new Error('节点坐标无效。');
  return revise(session, {
    track: moveTrackNode(session.track, from, to),
    selected: to,
  });
}
export function insertEditNode(
  session: RouteEditSession,
  point: Coordinate,
  distance?: number,
): RouteEditSession {
  return revise(session, {
    track: insertTrackNode(session.track, point, distance),
    selected: point,
  });
}
export function removeEditNode(session: RouteEditSession): RouteEditSession {
  if (!session.selected) throw new Error('请先选中要删除的节点。');
  return removeEditNodes(session, [session.selected]);
}
export function removeEditNodes(
  session: RouteEditSession,
  points: Coordinate[],
): RouteEditSession {
  return revise(session, {
    track: removeTrackNodes(session.track, points),
    selected: null,
    branch: null,
  });
}
export function styleRouteEdit(
  session: RouteEditSession,
  style: TrackStyle,
): RouteEditSession {
  const next = normalizeTrackStyle(style);
  return JSON.stringify(next) === JSON.stringify(session.track.style)
    ? session
    : revise(session, {
        track: {
          ...session.track,
          style: next,
          edgeColors:
            next.color !== normalizeTrackStyle(session.track.style).color
              ? undefined
              : session.track.edgeColors,
        },
      });
}
export function toggleEditBranch(session: RouteEditSession): RouteEditSession {
  if (session.branch !== null) {
    const segments = session.track.segments.filter(
      (line, i) => i !== session.branch || line.length >= 2,
    );
    return revise(session, {
      track: {
        ...session.track,
        segments,
        edgeColors: inheritEdgeColors(segments, [session.track]),
      },
      branch: null,
    });
  }
  if (!session.selected) throw new Error('请先选中分叉的起始节点。');
  if (session.track.segments.length >= 100)
    throw new Error('路线已达100段，请先整理。');
  return revise(session, {
    track: {
      ...session.track,
      segments: [...session.track.segments, [session.selected]],
      edgeColors: inheritEdgeColors(
        [...session.track.segments, [session.selected]],
        [session.track],
      ),
    },
    branch: session.track.segments.length,
  });
}
/** Snapping to another line only chooses the endpoint; it never imports or hides that line. */
export function appendEditBranch(
  session: RouteEditSession,
  point: Coordinate,
  target?: ManualTrack,
  section?: Coordinate[],
): RouteEditSession {
  if (session.branch === null) throw new Error('请先选中节点并开启分叉。');
  if (!coordinate(point)) throw new Error('节点坐标无效。');
  const line = session.track.segments[session.branch];
  if (equalCoordinate(line.at(-1)!, point)) return session;
  const continuation = (section ?? []).slice();
  if (!continuation.every(coordinate)) throw new Error('连线路径坐标无效。');
  if (continuation.length && equalCoordinate(continuation[0], line.at(-1)!))
    continuation.shift();
  if (!continuation.length || !equalCoordinate(continuation.at(-1)!, point))
    continuation.push(point);
  if (target?.hidden) throw new Error('隐藏路线不能作为连接目标。');
  if (
    target &&
    !target.segments.some((l) => l.some((p) => equalCoordinate(p, point)))
  )
    throw new Error('连接节点已变化，请重新选择。');
  const joinsSelf = session.track.segments.some((l, i) =>
    l.some(
      (p, j) =>
        (i !== session.branch || j < l.length - 1) && equalCoordinate(p, point),
    ),
  );
  const segments = session.track.segments.map((l, i) =>
    i === session.branch ? [...l, ...continuation] : l,
  );
  if (segments.length > 100 || segments.flat().length > MAX_TRACK_POINTS)
    throw new Error('连接后超过100段或6000点上限。');
  return revise(session, {
    track: {
      ...session.track,
      segments,
      edgeColors: inheritEdgeColors(segments, [session.track]),
      nodes: [...(session.track.nodes ?? []), point],
    },
    branch: target || joinsSelf ? null : session.branch,
    selected: point,
  });
}
export function editedRouteRecord(
  session: RouteEditSession,
  id: string,
  now: number,
): ManualTrack {
  const { track, original, sources } = session;
  if (
    session.branch !== null &&
    (track.segments[session.branch]?.length ?? 0) < 2
  )
    throw new Error('分叉还没有完成，请继续画到第二个点，或撤销该分叉。');
  if (
    !track.segments.length ||
    track.segments.some((l) => l.length < 1 || !l.every(coordinate))
  )
    throw new Error('分叉还没有完成，请继续画到第二个点，或撤销该分叉。');
  if (
    track.segments.length > 100 ||
    track.segments.flat().length > MAX_TRACK_POINTS
  )
    throw new Error('路线超过100段或6000点上限。');
  const copied =
    original.id === DRAFT_ID ||
    keepsOriginalPoints(original) ||
    sources.length > 1;
  const sourceTrackIds = [
    ...new Set(sources.flatMap((t) => [t.id, ...(t.sourceTrackIds ?? [])])),
  ].filter((source) => source !== (copied ? id : original.id));
  return {
    ...track,
    id: copied ? id : original.id,
    hidden: false,
    sourceTrackIds,
    name:
      sources.length > 1
        ? `${original.name} · 组合路线`.slice(0, 60)
        : original.name,
    createdAt: copied ? now : original.createdAt,
    updatedAt: now,
  };
}
/** One archive write commits geometry/style and source visibility together; failures mutate nothing. */
export function storeRouteEdit(
  session: RouteEditSession,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  id: string,
  now: number,
) {
  const records = parseSavedTracks(storage.getItem(TRACK_STORAGE));
  const revision = (t: ManualTrack) =>
    JSON.stringify([
      t.name,
      t.segments,
      t.nodes ?? [],
      t.style,
      t.edgeColors,
      t.colorConditions,
      t.updatedAt ?? t.createdAt,
      t.sourceTrackIds ?? [],
    ]);
  for (const original of session.sources) {
    const current = records.find((t) => t.id === original.id);
    if (!current || revision(current) !== revision(original))
      throw new Error(
        '原路线已在其他窗口更新，请保留本次编辑并重新核对后保存。',
      );
  }
  if (!session.track.segments.length) {
    // Saving an explicitly emptied edit removes only that archive, not other source routes.
    const recordsAfter = records.filter(
      (t) =>
        t.id !== session.original.id || keepsOriginalPoints(session.original),
    );
    storage.setItem(TRACK_STORAGE, JSON.stringify(recordsAfter));
    return { track: session.track, records: recordsAfter, removed: true };
  }
  const track = editedRouteRecord(session, id, now);
  const exists = records.some((t) => t.id === track.id);
  if (!exists && records.length >= MAX_SAVED_TRACKS)
    throw new Error(
      `已保存${MAX_SAVED_TRACKS}条路线，当前编辑已保留，请先整理收藏。`,
    );
  const hidden = new Set(
    track.id !== session.original.id ? session.sources.map((t) => t.id) : [],
  );
  const next = records.map((t) =>
    t.id === track.id ? track : hidden.has(t.id) ? { ...t, hidden: true } : t,
  );
  if (!exists) next.push(track);
  storage.setItem(TRACK_STORAGE, JSON.stringify(next));
  return { track, records: next, removed: false };
}
