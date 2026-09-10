import type { Coordinate } from '../navigation/types.ts';
import type { ShareRoute } from '../routeShare/data.ts';
export type WorkbenchItem = {
  id: string;
  name: string;
  kind:
    | 'folder'
    | 'route'
    | 'track'
    | 'pin'
    | 'model'
    | 'area'
    | 'section'
    | 'measurement';
  color: string;
  detail?: string;
  shareData?: ShareRoute;
  children?: WorkbenchItem[];
  createdAt?: number;
  coordinates?: Coordinate;
  line?: Coordinate[];
  region?: string;
};
export function flattenWorkbench(items: WorkbenchItem[]): WorkbenchItem[] {
  return items.flatMap((item) => [
    item,
    ...flattenWorkbench(item.children ?? []),
  ]);
}
export function workbenchLeaves(items: WorkbenchItem[]) {
  return flattenWorkbench(items).filter((i) => i.kind !== 'folder');
}
export function workbenchRegionTree(items: WorkbenchItem[]): WorkbenchItem[] {
  const regions = [
    ...new Set(workbenchLeaves(items).map((i) => i.region || '待归类')),
  ].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const project = (list: WorkbenchItem[], region: string): WorkbenchItem[] =>
    list.flatMap((i) => {
      if (i.kind !== 'folder')
        return (i.region || '待归类') === region ? [i] : [];
      const children = project(i.children ?? [], region);
      if (i.id === 'unfiled') return children;
      return children.length ? [{ ...i, children }] : [];
    });
  return regions.map((region) => ({
    id: `region:${region}`,
    name: region,
    kind: 'folder',
    color: '#e3ece7',
    children: project(items, region),
  }));
}
export function workbenchDetails(item: WorkbenchItem) {
  return item.kind === 'folder'
    ? `${workbenchLeaves(item.children ?? []).length} 项`
    : (item.detail ?? '');
}
export function updateWorkbenchItem(
  items: WorkbenchItem[],
  id: string,
  patch: Partial<WorkbenchItem>,
): WorkbenchItem[] {
  return items.map((item) =>
    item.id === id
      ? { ...item, ...patch }
      : item.children
        ? { ...item, children: updateWorkbenchItem(item.children, id, patch) }
        : item,
  );
}
export function removeWorkbenchItems(
  items: WorkbenchItem[],
  ids: Set<string>,
): WorkbenchItem[] {
  return items
    .filter((item) => !ids.has(item.id))
    .map((item) =>
      item.children
        ? { ...item, children: removeWorkbenchItems(item.children, ids) }
        : item,
    );
}
export function moveWorkbenchItems(
  items: WorkbenchItem[],
  ids: Set<string>,
  destination: string,
): WorkbenchItem[] {
  if (destination === '') {
    const selected = flattenWorkbench(items).filter((i) => ids.has(i.id));
    if (selected.some((i) => i.kind !== 'folder' || i.id === 'unfiled'))
      throw new Error('条目请放入文件夹，根目录只放文件夹。');
    const roots = selected.filter(
      (i) =>
        !selected.some(
          (p) =>
            p.id !== i.id &&
            flattenWorkbench(p.children ?? []).some((c) => c.id === i.id),
        ),
    );
    return [
      ...removeWorkbenchItems(items, new Set(roots.map((i) => i.id))),
      ...roots,
    ];
  }
  const target = flattenWorkbench(items).find(
    (i) => i.id === destination && i.kind === 'folder',
  );
  if (!target) throw new Error('请选择目标文件夹');
  const selected = flattenWorkbench(items).filter((i) => ids.has(i.id));
  const roots = selected.filter(
    (i) =>
      !selected.some(
        (parent) =>
          parent.id !== i.id &&
          flattenWorkbench(parent.children ?? []).some(
            (child) => child.id === i.id,
          ),
      ),
  );
  if (
    roots.some(
      (i) =>
        i.id === destination ||
        flattenWorkbench(i.children ?? []).some((c) => c.id === destination),
    )
  )
    throw new Error('不能移动到自身或下级文件夹');
  const rest = removeWorkbenchItems(items, new Set(roots.map((i) => i.id)));
  const remainingTarget = flattenWorkbench(rest).find(
    (i) => i.id === destination,
  )!;
  return updateWorkbenchItem(rest, destination, {
    children: [...(remainingTarget.children ?? []), ...roots],
  });
}
/** Reparent or reorder the selected roots, preserving geometry and all unselected siblings. */
export function dropWorkbenchItems(
  items: WorkbenchItem[],
  ids: Set<string>,
  targetId: string,
  position: 'inside' | 'before' | 'after',
): WorkbenchItem[] {
  if (position === 'inside') return moveWorkbenchItems(items, ids, targetId);
  const all = flattenWorkbench(items),
    target = all.find((i) => i.id === targetId);
  if (!target) throw new Error('目标已不存在，请重试');
  const selected = all.filter((i) => ids.has(i.id));
  const roots = selected.filter(
    (i) =>
      !selected.some(
        (p) =>
          p.id !== i.id &&
          flattenWorkbench(p.children ?? []).some((c) => c.id === i.id),
      ),
  );
  if (
    roots.some(
      (i) =>
        i.id === targetId ||
        flattenWorkbench(i.children ?? []).some((c) => c.id === targetId),
    )
  )
    throw new Error('不能放到自身或下级文件夹');
  const parent = all.find((i) => i.children?.some((c) => c.id === targetId));
  if (!parent && roots.some((i) => i.kind !== 'folder'))
    throw new Error('请放入文件夹，或放到文件夹内的条目之间');
  const rest = removeWorkbenchItems(items, new Set(roots.map((i) => i.id)));
  const insert = (list: WorkbenchItem[]) => {
    const index =
      list.findIndex((i) => i.id === targetId) + (position === 'after' ? 1 : 0);
    return [...list.slice(0, index), ...roots, ...list.slice(index)];
  };
  return parent
    ? updateWorkbenchItem(rest, parent.id, {
        children: insert(
          flattenWorkbench(rest).find((i) => i.id === parent.id)!.children ??
            [],
        ),
      })
    : insert(rest);
}

/** Remove one organizational level without deleting or duplicating any contained object. */
export function dissolveWorkbenchFolder(
  items: WorkbenchItem[],
  id: string,
): WorkbenchItem[] {
  const all = flattenWorkbench(items),
    folder = all.find((i) => i.id === id && i.kind === 'folder');
  if (!folder || id === 'unfiled') throw new Error('请选择可以解散的文件夹');
  const parent = all.find((i) => i.children?.some((c) => c.id === id));
  if (parent)
    return updateWorkbenchItem(items, parent.id, {
      children: parent.children!.flatMap((i) =>
        i.id === id ? (folder.children ?? []) : [i],
      ),
    });
  const children = folder.children ?? [],
    leaves = children.filter((i) => i.kind !== 'folder');
  let next = items.flatMap((i) =>
    i.id === id ? children.filter((c) => c.kind === 'folder') : [i],
  );
  if (leaves.length) {
    const unfiled = next.find((i) => i.id === 'unfiled');
    if (unfiled)
      next = updateWorkbenchItem(next, 'unfiled', {
        children: [...(unfiled.children ?? []), ...leaves],
      });
    else
      next.push({
        id: 'unfiled',
        name: '未分组',
        kind: 'folder',
        color: '#e4e7e2',
        children: leaves,
      });
  }
  return next;
}
