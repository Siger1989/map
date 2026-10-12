import type { PlannedRoute } from './types';

type RouteApplied = (route: PlannedRoute) => void;

export function createSearchNavigationDraft() {
  let awaitingExplicitStart = false;

  return {
    begin(guidanceActive: boolean) {
      awaitingExplicitStart = guidanceActive;
    },
    clear() {
      awaitingExplicitStart = false;
    },
    onRouteApplied(
      guidanceActive: boolean,
      callback: RouteApplied | undefined,
    ) {
      return guidanceActive && awaitingExplicitStart ? undefined : callback;
    },
  };
}
