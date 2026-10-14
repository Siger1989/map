export type FocusLockActivity =
  | 'drawing' | 'areaDrawing' | 'areaEditing' | 'routeEditor'
  | 'measurement' | 'survey' | 'markerPicking' | 'routePicking'
  | 'movingFeature' | 'quickAdd' | 'sectionEditing' | 'navigation'
  | 'comparison' | 'boxSelection' | 'sectionList'
  | 'annotationDetails' | 'photoDetails' | 'rally' | 'routeCard'
  | 'navigationTarget' | 'sharing' | 'sourcePicker';

/** Only visible controls/active interactions block entry; retained data is not a task. */
export function focusLockVisibility(locked: boolean, panel: string | null, activities: Record<FocusLockActivity, boolean>) {
  const reasons = [
    ...(panel === null ? [] : ['panel']),
    // User 2026-10-14: navigation itself must keep the lock entry available.
    ...Object.entries(activities).filter(([name, active]) => active && name !== 'navigation').map(([name]) => name),
  ];
  return { visible: locked || reasons.length === 0, reasons };
}
