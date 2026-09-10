import type { CatalogEntry } from './catalog.ts';
import { entriesFor, groupFor, type CollectionLayout } from './data.ts';

/** Folder metadata never owns or rewrites the underlying map objects. */
export function folderEntries(entries: CatalogEntry[]) {
  return entries.map((entry) => ({
    ...entry,
    defaultGroup:
      entry.kind === 'route'
        ? entry.route.route.mode
        : entry.kind === 'track'
          ? entriesFor([], [entry.track])[0].defaultGroup
          : 'unfiled',
  }));
}
export function folderPath(layout: CollectionLayout, id: string): string {
  const group = layout.groups.find((g) => g.id === id);
  return group
    ? `${group.parentId ? `${folderPath(layout, group.parentId)} / ` : ''}${group.name}`
    : '未分组';
}
export function folderIds(layout: CollectionLayout, id: string): Set<string> {
  const ids = new Set([id]);
  for (const group of layout.groups.filter((g) => g.parentId === id))
    for (const child of folderIds(layout, group.id)) ids.add(child);
  return ids;
}
export function folderContents(
  layout: CollectionLayout,
  entries: ReturnType<typeof folderEntries>,
  id: string | null,
) {
  if (id === null) return entries;
  const ids = folderIds(layout, id);
  return entries.filter((e) => ids.has(groupFor(layout, e).id));
}
/** Keep selected records' folder colors and ancestry in portable exports. */
export function collectionSubset(
  layout: CollectionLayout,
  entries: ReturnType<typeof folderEntries>,
): CollectionLayout {
  const keys = new Set(entries.map((e) => e.key));
  const groups = new Set<string>();
  for (const entry of entries) {
    let group = layout.groups.find((g) => g.id === groupFor(layout, entry).id);
    while (group) {
      groups.add(group.id);
      group = layout.groups.find((g) => g.id === group!.parentId);
    }
  }
  return {
    version: 1,
    groups: layout.groups.filter((g) => groups.has(g.id)),
    assignments: Object.fromEntries(
      entries.map((e) => [e.key, groupFor(layout, e).id]),
    ),
    order: layout.order.filter((key) => keys.has(key)),
    ...(layout.tabOrder && { tabOrder: [...layout.tabOrder] }),
    ...(layout.treeOrder && {
      treeOrder: layout.treeOrder.filter(
        (key) =>
          keys.has(key) ||
          (key.startsWith('folder:') &&
            (groups.has(key.slice(7)) || key === 'folder:unfiled')),
      ),
    }),
  };
}
