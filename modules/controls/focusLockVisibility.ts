export type FocusLockActivity =
  | 'drawing' | 'areaDrawing' | 'areaEditing' | 'routeEditor'
  | 'measurement' | 'survey' | 'markerPicking' | 'routePicking'
  | 'movingFeature' | 'quickAdd' | 'sectionEditing' | 'navigation'
  | 'recording' | 'comparison' | 'boxSelection' | 'sectionList'
  | 'annotationDetails' | 'photoDetails' | 'rally' | 'routeCard'
  | 'navigationTarget' | 'sharing' | 'sourcePicker';

/** Only visible controls/active interactions block entry; retained data is not a task. */
export function focusLockVisibility(locked: boolean, panel: string | null, activities: Record<FocusLockActivity, boolean>) {
  const reasons = [
    ...(panel === null ? [] : ['panel']),
    ...Object.entries(activities).filter(([, active]) => active).map(([name]) => name),
  ];
  return { visible: locked || reasons.length === 0, reasons };
}
