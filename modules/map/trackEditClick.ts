export type TrackEditClickHandlers<Node, Line> = {
  pickNode: () => Node | null;
  pickLine: () => Line | null;
  pickRoute: () => boolean;
  onNodeSelect: (node: Node) => void;
  onLineSelect: (line: Line) => void;
  onRouteSelect: () => void;
  onMapPick: () => void;
};

export function handlePlannedRoutePick(
  pickRoute: () => boolean,
  onRouteSelect: () => void,
): boolean {
  if (!pickRoute()) return false;
  onRouteSelect();
  return true;
}

/** Keep editable track hits first, then allow the planned route through. */
export function handleTrackEditClick<Node, Line>(
  handlers: TrackEditClickHandlers<Node, Line>,
): void {
  const node = handlers.pickNode();
  if (node) {
    handlers.onNodeSelect(node);
    return;
  }

  const line = handlers.pickLine();
  if (line) {
    handlers.onLineSelect(line);
    return;
  }

  if (handlers.pickRoute()) {
    handlers.onRouteSelect();
    return;
  }

  handlers.onMapPick();
}
