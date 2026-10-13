export type MarkerQueryBounds = { left: number; top: number; right: number; bottom: number };
export type MarkerQueryItem<T extends HTMLElement = HTMLElement> = {
  element: T;
  bounds: MarkerQueryBounds | null;
};
export type MarkerQueryGroup<T extends HTMLElement = HTMLElement> = {
  unionBounds: MarkerQueryBounds;
  members: MarkerQueryItem<T>[];
};

function intersects(a: MarkerQueryBounds, b: MarkerQueryBounds): boolean {
  return a.right >= b.left && a.left <= b.right && a.bottom >= b.top && a.top <= b.bottom;
}

/** Groups visible marker bounds by inclusive, transitive screen-space overlap. */
export function groupMarkerQueries<T extends HTMLElement>(
  items: MarkerQueryItem<T>[], viewportBounds: MarkerQueryBounds,
): MarkerQueryGroup<T>[] {
  const visible = items.filter(({ bounds }) => bounds !== null && intersects(bounds, viewportBounds));
  const parents = visible.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const next = parents[index]; parents[index] = root; index = next;
    }
    return root;
  };
  const join = (a: number, b: number) => {
    const rootA = find(a), rootB = find(b);
    if (rootA !== rootB) parents[rootB] = rootA;
  };
  for (let i = 0; i < visible.length; i++) {
    const bounds = visible[i].bounds!;
    for (let j = i + 1; j < visible.length; j++) {
      if (intersects(bounds, visible[j].bounds!)) join(i, j);
    }
  }

  const groups = new Map<number, MarkerQueryGroup<T>>();
  for (let index = 0; index < visible.length; index++) {
    const item = visible[index], bounds = item.bounds!, root = find(index);
    const group = groups.get(root);
    if (group) {
      group.members.push(item);
      group.unionBounds.left = Math.min(group.unionBounds.left, bounds.left);
      group.unionBounds.top = Math.min(group.unionBounds.top, bounds.top);
      group.unionBounds.right = Math.max(group.unionBounds.right, bounds.right);
      group.unionBounds.bottom = Math.max(group.unionBounds.bottom, bounds.bottom);
    } else {
      groups.set(root, { unionBounds: { ...bounds }, members: [item] });
    }
  }
  return [...groups.values()];
}
