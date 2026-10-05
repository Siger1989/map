import type { ComparisonChoice } from './choices';

export const COMPARISON_SOURCE_GROUP_VISIBILITY_KEY = 'shantu-map-comparison-source-groups-v1';
export const COMPARISON_SOURCE_GROUPS_CHANGED_EVENT = 'shantu-map-comparison-source-groups-changed';

export const COMPARISON_SOURCE_GROUP_ORDER = ['常用', '当前', '内置', '我的图源', '公共库'] as const;
export type ComparisonSourceGroupName = typeof COMPARISON_SOURCE_GROUP_ORDER[number];
export type ComparisonSourceGroup = { name: ComparisonSourceGroupName; choices: ComparisonChoice[] };

const validGroup = (value: unknown): value is ComparisonSourceGroupName =>
  typeof value === 'string' && COMPARISON_SOURCE_GROUP_ORDER.includes(value as ComparisonSourceGroupName);

export function readComparisonSourceOpenGroups(): ComparisonSourceGroupName[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(COMPARISON_SOURCE_GROUP_VISIBILITY_KEY) ?? 'null');
    if (!Array.isArray(parsed)) return [...COMPARISON_SOURCE_GROUP_ORDER];
    return [...new Set(parsed.filter(validGroup))];
  } catch {
    return [...COMPARISON_SOURCE_GROUP_ORDER];
  }
}

export function writeComparisonSourceOpenGroups(groups: ComparisonSourceGroupName[]): boolean {
  const open = [...new Set(groups.filter(validGroup))];
  try {
    localStorage.setItem(COMPARISON_SOURCE_GROUP_VISIBILITY_KEY, JSON.stringify(open));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new window.CustomEvent(COMPARISON_SOURCE_GROUPS_CHANGED_EVENT, { detail: open }));
    }
    return true;
  } catch {
    return false;
  }
}

export function subscribeComparisonSourceOpenGroups(onChange: (groups: ComparisonSourceGroupName[]) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const update = () => onChange(readComparisonSourceOpenGroups());
  const onStorage = (event: StorageEvent) => {
    if (event.key === COMPARISON_SOURCE_GROUP_VISIBILITY_KEY) update();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(COMPARISON_SOURCE_GROUPS_CHANGED_EVENT, update);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(COMPARISON_SOURCE_GROUPS_CHANGED_EVENT, update);
  };
}

/** One canonical partition keeps favorite display and quick-step order identical. */
export function comparisonSourceGroups(
  choices: ComparisonChoice[], favoriteKeys: string[],
): ComparisonSourceGroup[] {
  const favorites = new Set(favoriteKeys);
  const common = choices.filter(choice => favorites.has(choice.id));
  return COMPARISON_SOURCE_GROUP_ORDER.map(name => {
    const items = name === '常用'
      ? common
      : choices.filter(choice => choice.group === name && !favorites.has(choice.id));
    return { name, choices: items };
  });
}

export function visibleComparisonSourceChoices(
  groups: ComparisonSourceGroup[], openGroups: ComparisonSourceGroupName[],
): ComparisonChoice[] {
  const open = new Set(openGroups);
  const seen = new Set<string>();
  return groups.flatMap(group => open.has(group.name) ? group.choices : [])
    .filter(choice => !seen.has(choice.id) && !!seen.add(choice.id));
}
