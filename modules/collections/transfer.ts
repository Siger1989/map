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
  for (const group of incoming.groups) {
    const same = groups.find((g) => g.id === group.id);
    const id =
      same && (same.name !== group.name || same.color !== group.color)
        ? (groups.find((g) => g.name === group.name && g.color === group.color)
            ?.id ?? crypto.randomUUID())
        : group.id;
    groupIds.set(group.id, id);
    if (!groups.some((g) => g.id === id)) groups.push({ ...group, id });
  }
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
  return validateLayout({ version: 1, groups, assignments, order });
}
