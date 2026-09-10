import { catalogEntries, regionFor } from './catalog.ts';
import {
  defaultLayout,
  groupFor,
  orderedEntries,
  validateLayout,
  type CollectionLayout,
} from './data.ts';
import { folderEntries } from './folders.ts';
import {
  flattenWorkbench,
  workbenchLeaves,
  type WorkbenchItem,
} from './workbenchTree.ts';
import { withoutEntries } from './remove.ts';
import { validateTransfer, type Transfer } from '../outdoor/exchange.ts';
import { normalizeTrackStyle } from '../tracks/style.ts';
import { sharePlanned, shareTrack } from '../routeShare/data.ts';

/** A projection only: provenance, geometry, model parameters and photos remain in their original records. */
export function workbenchTree(data: Transfer): WorkbenchItem[] {
  const layout = data.collections ?? defaultLayout();
  const entries = orderedEntries(
    layout,
    folderEntries(
      catalogEntries(
        data.favorites,
        data.tracks,
        data.annotations,
        data.sections ?? [],
        data.areas ?? [],
        data.measurements ?? [],
      ),
    ),
  );
  const groups = new Map<string, WorkbenchItem>(
    layout.groups.map((g) => [g.id, { ...g, kind: 'folder', children: [] }]),
  );
  groups.set('unfiled', {
    id: 'unfiled',
    name: '未分组',
    kind: 'folder',
    color: '#e4e7e2',
    children: [],
  });
  const roots: WorkbenchItem[] = [];
  for (const group of layout.groups)
    (group.parentId ? groups.get(group.parentId)!.children! : roots).push(
      groups.get(group.id)!,
    );
  roots.push(groups.get('unfiled')!);
  for (const e of entries) {
    const region = regionFor(e, data.regions ?? {});
    const item: WorkbenchItem = {
      id: e.key,
      kind: e.kind,
      name: e.name,
      detail: e.detail,
      coordinates: e.coordinates,
      color: '#237eee',
      region: [region?.country, region?.province, region?.city]
        .filter(Boolean)
        .join(' · '),
    };
    if (e.kind === 'route') {
      item.createdAt = e.route.savedAt;
      item.line = e.route.route.coordinates;
      item.shareData = sharePlanned(e.route.route, e.name);
    } else if (e.kind === 'track') {
      item.createdAt = e.track.createdAt;
      item.color = normalizeTrackStyle(e.track.style).color;
      item.line = e.track.segments.flat();
      if (item.line.length >= 2)
        item.shareData = shareTrack(e.track, data.annotations, data.tracks);
    } else if (e.kind === 'pin' || e.kind === 'model')
      item.color = e.annotation.color;
    else if (e.kind === 'area') {
      item.createdAt = e.area.createdAt;
      item.color = e.area.color;
      item.line = e.area.boundary;
    } else if (e.kind === 'measurement') {
      item.createdAt = e.measurement.updatedAt;
      item.line = e.measurement.points.map((p) => p.coordinates);
      item.color = '#bc5d22';
    }
    groups.get(groupFor(layout, e).id)!.children!.push(item);
  }
  const ranks = new Map((layout.treeOrder ?? []).map((key, i) => [key, i]));
  const sort = (items: WorkbenchItem[]): WorkbenchItem[] =>
    [...items]
      .sort(
        (a, b) =>
          (ranks.get(a.kind === 'folder' ? `folder:${a.id}` : a.id) ??
            Infinity) -
          (ranks.get(b.kind === 'folder' ? `folder:${b.id}` : b.id) ??
            Infinity),
      )
      .map((i) => (i.children ? { ...i, children: sort(i.children) } : i));
  return sort(roots);
}

export function workbenchTransfer(
  before: Transfer,
  tree: WorkbenchItem[],
): Transfer {
  const visibleBefore = workbenchLeaves(workbenchTree(before));
  const all = flattenWorkbench(tree),
    leaves = workbenchLeaves(tree),
    ids = new Set(leaves.map((i) => i.id));
  if (
    new Set(all.map((i) => i.id)).size !== all.length ||
    leaves.some((i) => !visibleBefore.some((old) => old.id === i.id))
  )
    throw new Error('收藏已变化，请重新打开后操作。');
  const next = withoutEntries(
    before,
    visibleBefore.filter((i) => !ids.has(i.id)).map((i) => i.id),
  );
  const previousLayout = next.collections ?? defaultLayout();
  const layout: CollectionLayout = {
    ...previousLayout,
    groups: [],
    assignments: { ...previousLayout.assignments },
    order: [],
    treeOrder: [],
  };
  const visit = (items: WorkbenchItem[], parent?: string) => {
    for (const item of items) {
      layout.treeOrder!.push(
        item.kind === 'folder' ? `folder:${item.id}` : item.id,
      );
      if (item.kind === 'folder') {
        if (item.id === 'unfiled') {
          if (parent || item.children?.some((i) => i.kind === 'folder'))
            throw new Error('未分组只存放收藏条目，文件夹请移到收藏根目录。');
        } else
          layout.groups.push({
            id: item.id,
            name: item.name,
            color: item.color,
            ...(parent && { parentId: parent }),
          });
        visit(item.children ?? [], item.id);
      } else {
        layout.assignments[item.id] = parent ?? 'unfiled';
        layout.order.push(item.id);
      }
    }
  };
  visit(tree);
  const edits = new Map(leaves.map((i) => [i.id, i]));
  next.collections = validateLayout(layout);
  next.favorites = next.favorites.map((i) =>
    edits.has(`route:${i.id}`)
      ? { ...i, name: edits.get(`route:${i.id}`)!.name }
      : i,
  );
  next.tracks = next.tracks.map((i) => {
    const edit = edits.get(`track:${i.id}`);
    if (!edit) return i;
    const colorChanged = normalizeTrackStyle(i.style).color !== edit.color;
    return {
      ...i,
      name: edit.name,
      ...(colorChanged && {
        style: { ...normalizeTrackStyle(i.style), color: edit.color },
      }),
    };
  });
  next.annotations = next.annotations.map((i) => {
    const edit = edits.get(`annotation:${i.id}`);
    return edit ? { ...i, name: edit.name, color: edit.color } : i;
  });
  if (next.areas)
    next.areas = next.areas.map((i) => {
      const edit = edits.get(`area:${i.id}`);
      return edit ? { ...i, name: edit.name, color: edit.color } : i;
    });
  if (next.sections)
    next.sections = next.sections.map((i) => {
      const edit = edits.get(`section:${i.id}`);
      return edit ? { ...i, name: edit.name } : i;
    });
  if (next.measurements)
    next.measurements = next.measurements.map((i) => {
      const edit = edits.get(`measurement:${i.id}`);
      return edit ? { ...i, name: edit.name } : i;
    });
  return validateTransfer(next);
}
