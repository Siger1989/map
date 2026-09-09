import { flattenWorkbench, workbenchLeaves, type WorkbenchItem } from './workbenchTree.ts';
export function workbenchShareIds(requested: string[], checked?: string[]) { return [...new Set(checked ?? requested)]; }
export function selectedWorkbenchKeys(items: WorkbenchItem[], ids: string[]) {
  const selected = new Set(ids);
  return [...new Set(flattenWorkbench(items).filter(i=>selected.has(i.id)).flatMap(i=>i.kind==='folder' ? workbenchLeaves(i.children ?? []).map(c=>c.id) : [i.id]))];
}
/** Use original planned routes / recorded tracks, never reconstruct them as hand-drawn examples. */
export function workbenchImageRoutes(items: WorkbenchItem[], ids: string[]) {
  const selected = new Set(selectedWorkbenchKeys(items,ids));
  return workbenchLeaves(items).filter(i=>selected.has(i.id)).flatMap(i=>i.shareData ? [{id:i.id,name:i.name,data:i.shareData}] : []);
}
