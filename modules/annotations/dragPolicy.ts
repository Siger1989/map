import type { Annotation } from './data';
/** Only unbound ordinary pins use direct map dragging; models retain precise controls. */
export function canDragPin(item: Annotation | undefined): item is Annotation {
  return (
    item?.kind === 'pin' &&
    !item.borehole &&
    !item.trackAnchor &&
    !item.sectionAnchor
  );
}
