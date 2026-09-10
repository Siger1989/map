/** Category order is presentation metadata; it never reorders or changes map objects. */
export const COLLECTION_TABS = {
  regions: '地区',
  all: '全部',
  route: '路线',
  track: '轨迹',
  pin: '标记',
  model: '模型',
  area: '区域',
  section: '剖面',
  measurement: '测量',
} as const;
export type CollectionTab = keyof typeof COLLECTION_TABS;
export const DEFAULT_TAB_ORDER = Object.keys(
  COLLECTION_TABS,
) as CollectionTab[];
export function validTabOrder(value: unknown): value is CollectionTab[] {
  return (
    Array.isArray(value) &&
    value.length <= DEFAULT_TAB_ORDER.length &&
    value.every(
      (k) => typeof k === 'string' && Object.hasOwn(COLLECTION_TABS, k),
    ) &&
    new Set(value).size === value.length
  );
}
export function completeTabOrder(order?: CollectionTab[]): CollectionTab[] {
  return [
    ...(order ?? []),
    ...DEFAULT_TAB_ORDER.filter((k) => !order?.includes(k)),
  ];
}
export function moveCollectionTab(
  order: CollectionTab[],
  key: CollectionTab,
  to: number,
): CollectionTab[] {
  const next = completeTabOrder(order),
    from = next.indexOf(key);
  if (from < 0 || !Number.isInteger(to) || to < 0 || to >= next.length)
    return next;
  next.splice(from, 1);
  next.splice(to, 0, key);
  return next;
}
