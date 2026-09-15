import type { Transfer } from '../outdoor/exchange.ts';
import {
  workbenchDetails,
  workbenchRegionTree,
  workbenchLeaves,
  type WorkbenchItem,
} from './workbenchTree.ts';

export const HIDDEN_FOLDER = 'system:hidden';
/** Per-object visibility only. Layer visibility and original folder membership are untouched. */
export function hiddenKeys(data: Transfer) {
  return new Set([
    ...data.tracks.filter((t) => t.hidden).map((t) => `track:${t.id}`),
    ...data.annotations
      .filter((a) => !a.visible)
      .map((a) => `annotation:${a.id}`),
    ...(data.areas ?? []).filter((a) => !a.visible).map((a) => `area:${a.id}`),
    ...(data.sections ?? [])
      .filter((s) => !s.settings.enabled)
      .map((s) => `section:${s.id}`),
  ]);
}
export function visibilityTransfer(
  data: Transfer,
  keys: string[],
  show: boolean,
): Transfer {
  const ids = new Set(keys);
  return {
    ...data,
    tracks: data.tracks.map((t) =>
      ids.has(`track:${t.id}`) ? { ...t, hidden: !show } : t,
    ),
    annotations: data.annotations.map((a) =>
      ids.has(`annotation:${a.id}`) ? { ...a, visible: show } : a,
    ),
    ...(data.areas && {
      areas: data.areas.map((a) =>
        ids.has(`area:${a.id}`) ? { ...a, visible: show } : a,
      ),
    }),
    ...(data.sections && {
      sections: data.sections.map((s) =>
        ids.has(`section:${s.id}`)
          ? { ...s, settings: { ...s.settings, enabled: show } }
          : s,
      ),
    }),
  };
}
export function hiddenProjection(
  items: WorkbenchItem[],
  hidden: Set<string>,
): WorkbenchItem[] {
  const visible = (list: WorkbenchItem[]): WorkbenchItem[] =>
    list.flatMap((i) =>
      i.kind === 'folder'
        ? [{ ...i, children: visible(i.children ?? []) }]
        : hidden.has(i.id)
          ? []
          : [i],
    );
  return [
    ...visible(items),
    {
      id: HIDDEN_FOLDER,
      name: '隐藏',
      kind: 'folder',
      color: '#d5ded8',
      children: workbenchLeaves(items).filter((i) => hidden.has(i.id)),
    },
  ];
}

export function visibleWorkbench(
  items: WorkbenchItem[],
  hidden: Set<string>,
  regions: boolean,
  type: string,
  query: string,
): WorkbenchItem[] {
  const filtered = type !== 'all' || !!query.trim();
  const filter = (list: WorkbenchItem[]): WorkbenchItem[] =>
    list.flatMap((i) => {
      if (i.kind !== 'folder')
        return `${i.name} ${workbenchDetails(i)}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()) &&
          (type === 'all' || i.kind === type)
          ? [i]
          : [];
      const children = filter(i.children ?? []);
      return children.length || !filtered ? [{ ...i, children }] : [];
    });
  return filter(
    hiddenProjection(regions ? workbenchRegionTree(items) : items, hidden),
  );
}
