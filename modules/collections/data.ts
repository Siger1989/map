import type { RouteFavorite } from '../navigation/favorites.ts';
import { formatDistance, TRAVEL_MODES } from '../navigation/types.ts';
import { trackDistance, type ManualTrack } from '../tracks/drawing.ts';
import { hasTrackTime, trackSourceLabel } from '../tracks/provenance.ts';
import { validTabOrder, type CollectionTab } from './tabOrder.ts';

/** Organization only: route geometry, GPS samples and photos stay in their original stores. */
export const COLLECTION_STORAGE = 'shantu.route-collections.v1';
export const COLORS = [
  { value: '#72b7ff', name: '蓝色' },
  { value: '#89dfb3', name: '绿色' },
  { value: '#ffbd78', name: '橙色' },
  { value: '#c6a0ff', name: '紫色' },
  { value: '#68d7df', name: '青色' },
  { value: '#f59dbd', name: '粉色' },
];
export type CollectionGroup = {
  id: string;
  name: string;
  color: string;
  parentId?: string;
};
export type CollectionItem = { key: string; defaultGroup: string };
export type CollectionLayout = {
  version: 1;
  groups: CollectionGroup[];
  assignments: Record<string, string>;
  order: string[];
  /** Optional mixed folder/object order; older version-1 readers keep working. */
  treeOrder?: string[];
  tabOrder?: CollectionTab[];
};
export type CollectionEntry = {
  key: string;
  name: string;
  detail: string;
  defaultGroup: string;
} & (
  | { kind: 'route'; route: RouteFavorite }
  | { kind: 'track'; track: ManualTrack }
);
export const UNFILED: CollectionGroup = {
  id: 'unfiled',
  name: '未分组',
  color: '#afbec9',
};
export function defaultLayout(): CollectionLayout {
  return {
    version: 1,
    groups: [
      '驾车路线',
      '骑行路线',
      '步行路线',
      '实走轨迹',
      '导入轨迹',
      '手绘轨迹',
    ].map((name, i) => ({
      id: ['auto', 'bicycle', 'pedestrian', 'recorded', 'imported', 'manual'][
        i
      ],
      name,
      color: COLORS[i].value,
    })),
    assignments: {},
    order: [],
  };
}
const groupId = (id: unknown): id is string =>
  typeof id === 'string' && /^[\w-]{1,80}$/.test(id);
const itemKey = (key: unknown): key is string =>
  typeof key === 'string' &&
  /^(route|track|annotation|area|section|measurement):.{1,200}$/.test(key);
export function validateLayout(value: unknown): CollectionLayout {
  const v = value as CollectionLayout;
  if (
    !v ||
    v.version !== 1 ||
    !Array.isArray(v.groups) ||
    v.groups.length > 64 ||
    !v.groups.every(
      (g) =>
        g &&
        groupId(g.id) &&
        g.id !== UNFILED.id &&
        typeof g.name === 'string' &&
        g.name.trim().length > 0 &&
        g.name.length <= 30 &&
        /^#[\da-f]{6}$/i.test(g.color),
    ) ||
    new Set(v.groups.map((g) => g.id)).size !== v.groups.length ||
    !v.assignments ||
    typeof v.assignments !== 'object' ||
    Array.isArray(v.assignments) ||
    Object.keys(v.assignments).length > 12000 ||
    !Object.entries(v.assignments).every(
      ([k, g]) => itemKey(k) && groupId(g),
    ) ||
    !Array.isArray(v.order) ||
    v.order.length > 12000 ||
    !v.order.every(itemKey) ||
    new Set(v.order).size !== v.order.length ||
    (v.tabOrder !== undefined && !validTabOrder(v.tabOrder)) ||
    (v.treeOrder !== undefined &&
      (!Array.isArray(v.treeOrder) ||
        v.treeOrder.length > 12064 ||
        !v.treeOrder.every(
          (k) =>
            (typeof k === 'string' &&
              k.startsWith('folder:') &&
              groupId(k.slice(7))) ||
            itemKey(k),
        ) ||
        new Set(v.treeOrder).size !== v.treeOrder.length))
  )
    throw new Error('收藏分组数据无效，原数据未改动。');
  const groups = new Map(v.groups.map((g) => [g.id, g]));
  for (const group of v.groups) {
    const seen = new Set([group.id]);
    let parent = group.parentId;
    while (parent !== undefined) {
      if (
        !groupId(parent) ||
        !groups.has(parent) ||
        seen.has(parent) ||
        seen.size >= 8
      )
        throw new Error('收藏分组层级无效，最多支持 8 层文件夹。');
      seen.add(parent);
      parent = groups.get(parent)!.parentId;
    }
  }
  return v;
}
export function parseLayout(raw: string | null) {
  return raw === null ? defaultLayout() : validateLayout(JSON.parse(raw));
}
export function entriesFor(
  routes: RouteFavorite[],
  tracks: ManualTrack[],
): CollectionEntry[] {
  return [
    ...routes.map((route) => ({
      key: `route:${route.id}`,
      kind: 'route' as const,
      route,
      name: route.name,
      defaultGroup: route.route.mode,
      detail: `${TRAVEL_MODES.find((m) => m.id === route.route.mode)?.label} · ${formatDistance(route.route.distance)}`,
    })),
    ...tracks.map((track) => ({
      key: `track:${track.id}`,
      kind: 'track' as const,
      track,
      name: track.name,
      defaultGroup:
        track.source === 'recorded'
          ? 'recorded'
          : track.source === 'gpx' ||
              track.source === 'kml' ||
              hasTrackTime(track)
            ? 'imported'
            : 'manual',
      detail: `${trackSourceLabel(track)} · ${formatDistance(trackDistance(track.segments))}`,
    })),
  ];
}
export function groupFor(layout: CollectionLayout, entry: CollectionItem) {
  const id = layout.assignments[entry.key] ?? entry.defaultGroup;
  return layout.groups.find((g) => g.id === id) ?? UNFILED;
}
export function orderedEntries<T extends CollectionItem>(
  layout: CollectionLayout,
  entries: T[],
) {
  const ranks = new Map(layout.order.map((k, i) => [k, i]));
  return [...entries].sort(
    (a, b) => (ranks.get(a.key) ?? Infinity) - (ranks.get(b.key) ?? Infinity),
  );
}
export function moveEntry(
  layout: CollectionLayout,
  entries: CollectionItem[],
  key: string,
  group: string,
  before?: string,
): CollectionLayout {
  if (
    !entries.some((e) => e.key === key) ||
    (group !== UNFILED.id && !layout.groups.some((g) => g.id === group))
  )
    return layout;
  if (key === before) return layout;
  const ordered = orderedEntries(layout, entries).filter((e) => e.key !== key);
  let index = before ? ordered.findIndex((e) => e.key === before) : -1;
  if (index < 0) {
    const last = ordered.findLastIndex((e) => groupFor(layout, e).id === group);
    index = last < 0 ? ordered.length : last + 1;
  }
  const order = ordered.map((e) => e.key);
  order.splice(index, 0, key);
  return {
    ...layout,
    assignments: { ...layout.assignments, [key]: group },
    order,
  };
}
export function reorderGroup(
  layout: CollectionLayout,
  from: string,
  to: string,
) {
  const groups = [...layout.groups],
    a = groups.findIndex((g) => g.id === from),
    b = groups.findIndex((g) => g.id === to);
  if (a < 0 || b < 0 || a === b) return layout;
  groups.splice(b, 0, groups.splice(a, 1)[0]);
  return { ...layout, groups };
}
export function dropEntry(
  layout: CollectionLayout,
  entries: CollectionItem[],
  key: string,
  target: string,
) {
  const ordered = orderedEntries(layout, entries),
    to = ordered.find((e) => e.key === target);
  if (!to || key === target) return layout;
  const group = groupFor(layout, to).id;
  const siblings = ordered.filter((e) => groupFor(layout, e).id === group);
  const fromIndex = siblings.findIndex((e) => e.key === key),
    toIndex = siblings.findIndex((e) => e.key === target);
  return moveEntry(
    layout,
    entries,
    key,
    group,
    fromIndex >= 0 && fromIndex < toIndex ? siblings[toIndex + 1]?.key : target,
  );
}
export function deleteGroup(
  layout: CollectionLayout,
  id: string,
): CollectionLayout {
  return {
    ...layout,
    groups: layout.groups
      .filter((g) => g.id !== id)
      .map((g) =>
        g.parentId === id
          ? { ...g, parentId: layout.groups.find((p) => p.id === id)?.parentId }
          : g,
      ),
    assignments: Object.fromEntries(
      Object.entries(layout.assignments).map(([key, group]) => [
        key,
        group === id ? UNFILED.id : group,
      ]),
    ),
  };
}
