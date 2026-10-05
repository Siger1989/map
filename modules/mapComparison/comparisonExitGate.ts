type ExitRequest = {
  editingRoute: boolean;
  dirtyRoute: boolean;
  closeRouteEditor: () => void;
  confirmRouteExit: () => void;
  exitComparison: () => void;
};

/** Keep the pending exit action until the route editor's save/discard dialog resolves. */
export function createComparisonExitGate() {
  let pendingExit: (() => void) | null = null;
  return {
    request({ editingRoute, dirtyRoute, closeRouteEditor, confirmRouteExit, exitComparison }: ExitRequest) {
      if (editingRoute && dirtyRoute) {
        pendingExit = exitComparison;
        confirmRouteExit();
        return;
      }
      if (editingRoute) closeRouteEditor();
      exitComparison();
    },
    resolve(accepted: boolean) {
      const exit = pendingExit;
      pendingExit = null;
      if (accepted) exit?.();
    },
  };
}
