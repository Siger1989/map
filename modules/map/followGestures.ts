type DragStartEvent = { originalEvent?: unknown };

type DragEventMap = {
  on: (type: 'dragstart', listener: (event: DragStartEvent) => void) => unknown;
  off: (type: 'dragstart', listener: (event: DragStartEvent) => void) => unknown;
};

/** Pause location follow only when MapLibre reports a user drag (map pan). */
export function installFollowPanHandler(
  map: DragEventMap,
  onPan: () => void,
) {
  const onDragStart = (event: DragStartEvent) => {
    const touches = (event.originalEvent as TouchEvent | undefined)?.touches;
    if (event.originalEvent && (!touches || touches.length < 2)) onPan();
  };
  map.on('dragstart', onDragStart);
  return () => map.off('dragstart', onDragStart);
}
