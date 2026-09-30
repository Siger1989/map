/** Category order is presentation metadata; it never reorders or changes map objects. */
export const COLLECTION_TABS = {
  regions: '地区',
  all: '全部',
  hidden: '隐藏',
  route: '行程',
  track: '轨迹',
  pin: '标记',
  model: '模型',
  area: '区域',
  section: '剖面',
  measurement: '测量',
} as const;
export type CollectionTab = keyof typeof COLLECTION_TABS;
/** Keep archive kinds and saved tab keys stable; journeys also include timed originals. */
export function matchesCollectionTab(item: { kind: string; journey?: boolean; visible?: boolean }, tab: string) {
  if (tab === 'all') return true;
  if (tab === 'hidden') return item.visible === false;
  if (tab === 'route') return item.kind === 'route' || item.journey === true;
  if (tab === 'track') return item.kind === 'track' && !item.journey;
  return item.kind === tab;
}
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
  const next = [
    ...(order ?? []),
    ...DEFAULT_TAB_ORDER.filter((k) => !order?.includes(k)),
  ];
  if (order && !order.includes('hidden')) {
    next.splice(next.indexOf('hidden'), 1);
    next.splice(next.indexOf('all') + 1, 0, 'hidden');
  }
  return next;
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
