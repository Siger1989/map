import {
  defaultLayout,
  validateLayout,
  type CollectionLayout,
} from './data.ts';

/** Merge only organization for newly imported records; preserve local choices on ID collisions. */
export function mergeCollections(
  before: CollectionLayout | undefined,
  incoming: CollectionLayout | undefined,
  importedKeys: Map<string, string>,
  defaults: Map<string, string>,
): CollectionLayout | undefined {
  if (!incoming) return before;
  validateLayout(incoming);
  const local = before ?? defaultLayout();
  const groups = before ? [...local.groups] : [];
  const groupIds = new Map<string, string>();
  const resolve = (group: CollectionLayout['groups'][number]): string => {
    if (groupIds.has(group.id)) return groupIds.get(group.id)!;
    const parentId = group.parentId ? resolve(incoming.groups.find((g) => g.id === group.parentId)!) : undefined;
    const same = groups.find((g) => g.id === group.id);
    const id =
      same && (same.name !== group.name || same.color !== group.color || same.parentId !== parentId)
        ? (groups.find((g) => g.name === group.name && g.color === group.color && g.parentId === parentId)
            ?.id ?? crypto.randomUUID())
        : group.id;
    groupIds.set(group.id, id);
    if (!groups.some((g) => g.id === id)) groups.push({ ...group, id, parentId });
    return id;
  };
  incoming.groups.forEach(resolve);
  const assignments = { ...local.assignments };
  for (const [oldKey, newKey] of importedKeys) {
    const assigned = incoming.assignments[oldKey] ?? defaults.get(oldKey);
    if (assigned) assignments[newKey] = groupIds.get(assigned) ?? 'unfiled';
  }
  const order = [...local.order];
  for (const key of incoming.order) {
    const next = importedKeys.get(key);
    if (next && !order.includes(next)) order.push(next);
  }
  const treeOrder = [...(local.treeOrder ?? [])];
  for (const key of incoming.treeOrder ?? []) {
    const next = key.startsWith('folder:') ? (key === 'folder:unfiled' ? key : groupIds.has(key.slice(7)) ? `folder:${groupIds.get(key.slice(7))}` : undefined) : importedKeys.get(key);
    if (next && !treeOrder.includes(next)) treeOrder.push(next);
  }
  return validateLayout({ version: 1, groups, assignments, order, ...(treeOrder.length && { treeOrder }) });
}
