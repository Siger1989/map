import { useLayoutEffect, useState, type RefObject } from 'react';
import type { WorkbenchSortOrder } from './WorkbenchSort';
export type CollectionView = {
  expanded: Set<string>;
  query: string;
  type: string;
  regionMode: boolean;
  sort: WorkbenchSortOrder;
  sortCenter: [number, number];
  active: string;
  scroll: number;
};
export type CollectionViewRef = { current: CollectionView | null };
/** App-owned transient UI state survives a detail visit without persisting object changes. */
export function useCollectionView(
  saved: CollectionViewRef,
  center: [number, number],
) {
  const [expanded, setExpanded] = useState(
    saved.current?.expanded ?? new Set(['unfiled']),
  );
  const [query, setQuery] = useState(saved.current?.query ?? ''),
    [type, setType] = useState(saved.current?.type ?? 'all');
  const [regionMode, setRegionMode] = useState(
      saved.current?.regionMode ?? false,
    ),
    [sort, setSort] = useState<WorkbenchSortOrder>(
      saved.current?.sort ?? 'manual',
    );
  const [sortCenter, setSortCenter] = useState<[number, number]>(
      saved.current?.sortCenter ?? center,
    ),
    [active, setActive] = useState(saved.current?.active ?? '');
  saved.current = {
    expanded,
    query,
    type,
    regionMode,
    sort,
    sortCenter,
    active,
    scroll: saved.current?.scroll ?? 0,
  };
  return {
    expanded,
    setExpanded,
    query,
    setQuery,
    type,
    setType,
    regionMode,
    setRegionMode,
    sort,
    setSort,
    sortCenter,
    setSortCenter,
    active,
    setActive,
  };
}
export function useCollectionScroll(
  saved: CollectionViewRef,
  list: RefObject<HTMLDivElement | null>,
  ready: boolean,
) {
  useLayoutEffect(() => {
    if (ready && list.current)
      list.current.scrollTop = saved.current?.scroll ?? 0;
  }, [ready, list, saved]);
  return (scroll: number) => {
    if (saved.current) saved.current.scroll = scroll;
  };
}
