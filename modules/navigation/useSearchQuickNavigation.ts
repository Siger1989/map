import { useCallback, useEffect, useRef, useState } from 'react';
import type { PositionFix } from '../position/types';
import { checkPlanningPosition, estimatedPlanningPosition, planningFix, planningFixIssue } from '../position/planningFix';
import type { PlannedRoute, RoutePlace } from './types';
import { reliableGpsFix } from '../guidance/session';
import type { NavigationState } from './useNavigation';

type SearchQuickNavigationOptions = {
  navigation: NavigationState;
  fix: PositionFix | null;
  locationError?: string;
  active: boolean;
  panelOpen: boolean;
  locate: () => void;
  onRouteApplied?: (route: PlannedRoute) => void;
};

type PendingDestination = { id: number; destination: RoutePlace };

function samePlace(a: RoutePlace | null | undefined, b: RoutePlace) {
  return !!a && a.name === b.name &&
    a.coordinates[0] === b.coordinates[0] &&
    a.coordinates[1] === b.coordinates[1];
}

/** Plans a search destination in one step when the existing start or a real fix is available. */
export function useSearchQuickNavigation({
  navigation,
  fix,
  locationError = '',
  active,
  panelOpen,
  locate,
  onRouteApplied,
}: SearchQuickNavigationOptions) {
  const navigationRef = useRef(navigation);
  const locateRef = useRef(locate);
  const onRouteAppliedRef = useRef(onRouteApplied);
  const latestRef = useRef({ fix, active, panelOpen, locationError });
  navigationRef.current = navigation;
  locateRef.current = locate;
  onRouteAppliedRef.current = onRouteApplied;
  latestRef.current = { fix, active, panelOpen, locationError };

  const nextId = useRef(0);
  const pendingRef = useRef<PendingDestination | null>(null);
  const [pendingDestination, setPendingDestination] = useState<PendingDestination | null>(null);
  const [appliedPosition, setAppliedPosition] = useState<{ route: PlannedRoute; message: string } | null>(null);

  const clearPending = useCallback(() => {
    nextId.current += 1;
    pendingRef.current = null;
    setPendingDestination(null);
  }, []);

  const plan = useCallback((destination: RoutePlace, origin?: PositionFix) => {
    const id = nextId.current;
    const fallbackStart = origin ? { name: '当前位置', coordinates: origin.coordinates } : undefined;
    void navigationRef.current.planTo(destination, fallbackStart, (route) => {
      if (id === nextId.current && latestRef.current.panelOpen && !latestRef.current.active) {
        setAppliedPosition(origin && !reliableGpsFix(origin)
          ? { route, message: estimatedPlanningPosition(origin) } : null);
        onRouteAppliedRef.current?.(route);
      }
    }, origin ? () => {
      const live = latestRef.current;
      if (id !== nextId.current || !live.panelOpen || live.active) throw new Error('路线规划已取消。');
      if (live.locationError) throw new Error(live.locationError);
      checkPlanningPosition(origin, live.fix);
    } : undefined);
  }, []);

  const begin = useCallback((destination: RoutePlace): boolean => {
    const latest = latestRef.current;
    if (latest.active) {
      clearPending();
      return false;
    }
    clearPending();
    const nav = navigationRef.current;
    const fallbackFix = !nav.start && !latest.locationError && planningFix(latest.fix) ? latest.fix : undefined;
    if (nav.start || fallbackFix) {
      plan(destination, fallbackFix);
      return true;
    }

    const pending = { id: nextId.current, destination };
    pendingRef.current = pending;
    setPendingDestination(pending);
    nav.place('end', destination);
    // Location is requested as a user action. The hook waits for the real fix prop;
    // it uses the latest device sample rather than a one-shot/IP callback.
    locateRef.current();
    return true;
  }, [clearPending, plan]);

  useEffect(() => {
    const pending = pendingDestination;
    if (!pending || pendingRef.current?.id !== pending.id) return;
    const nav = navigationRef.current;
    const latest = latestRef.current;
    if (latest.active || !latest.panelOpen || !samePlace(nav.end, pending.destination)) {
      clearPending();
      return;
    }

    const fallbackFix = !nav.start && !latest.locationError && planningFix(latest.fix) ? latest.fix : undefined;
    if (!nav.start && !fallbackFix) return;

    pendingRef.current = null;
    setPendingDestination(null);
    plan(pending.destination, fallbackFix);
  }, [active, panelOpen, fix, locationError, navigation.start, navigation.end, pendingDestination, clearPending, plan]);

  const positionMessage = locationError || (planningFix(fix)
    ? reliableGpsFix(fix) ? '' : estimatedPlanningPosition(fix)
    : planningFixIssue(fix));
  return { begin, waitingForPosition: pendingDestination !== null, positionMessage,
    appliedPositionMessage: appliedPosition?.route === navigation.route ? appliedPosition.message : '' };

}
