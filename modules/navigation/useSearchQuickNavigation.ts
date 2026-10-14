import { useCallback, useEffect, useRef, useState } from 'react';
import type { PositionFix } from '../position/types';
import { coordinate, type PlannedRoute, type RoutePlace } from './types';
import type { NavigationState } from './useNavigation';

type SearchQuickNavigationOptions = {
  navigation: NavigationState;
  fix: PositionFix | null;
  active: boolean;
  panelOpen: boolean;
  locate: () => void;
  onRouteApplied?: (route: PlannedRoute) => void;
};

type PendingDestination = { id: number; destination: RoutePlace };

function freshQuickStart(fix: PositionFix | null, now = Date.now()): RoutePlace | undefined {
  if (
    !fix ||
    !coordinate(fix.coordinates) ||
    !Number.isFinite(fix.accuracy) ||
    fix.accuracy < 0 ||
    fix.accuracy > 50 ||
    !Number.isFinite(fix.timestamp) ||
    now - fix.timestamp > 20_000 ||
    fix.timestamp > now + 5_000 ||
    fix.source === 'network' ||
    fix.provider === 'ip'
  ) return undefined;
  return { name: '当前位置', coordinates: fix.coordinates };
}

function samePlace(a: RoutePlace | null | undefined, b: RoutePlace) {
  return !!a && a.name === b.name &&
    a.coordinates[0] === b.coordinates[0] &&
    a.coordinates[1] === b.coordinates[1];
}

/** Plans a search destination in one step when the existing start or a real fix is available. */
export function useSearchQuickNavigation({
  navigation,
  fix,
  active,
  panelOpen,
  locate,
  onRouteApplied,
}: SearchQuickNavigationOptions) {
  const navigationRef = useRef(navigation);
  const locateRef = useRef(locate);
  const onRouteAppliedRef = useRef(onRouteApplied);
  const latestRef = useRef({ fix, active, panelOpen });
  navigationRef.current = navigation;
  locateRef.current = locate;
  onRouteAppliedRef.current = onRouteApplied;
  latestRef.current = { fix, active, panelOpen };

  const nextId = useRef(0);
  const pendingRef = useRef<PendingDestination | null>(null);
  const [pendingDestination, setPendingDestination] = useState<PendingDestination | null>(null);

  const clearPending = useCallback(() => {
    nextId.current += 1;
    pendingRef.current = null;
    setPendingDestination(null);
  }, []);

  const plan = useCallback((destination: RoutePlace, fallbackStart?: RoutePlace) => {
    const id = nextId.current;
    void navigationRef.current.planTo(destination, fallbackStart, (route) => {
      if (id === nextId.current && latestRef.current.panelOpen && !latestRef.current.active) onRouteAppliedRef.current?.(route);
    });
  }, []);

  const begin = useCallback((destination: RoutePlace): boolean => {
    const latest = latestRef.current;
    if (latest.active) {
      clearPending();
      return false;
    }
    clearPending();
    const nav = navigationRef.current;
    const fallbackStart = nav.start ? undefined : freshQuickStart(latest.fix);
    if (nav.start || fallbackStart) {
      plan(destination, fallbackStart);
      return true;
    }

    const pending = { id: nextId.current, destination };
    pendingRef.current = pending;
    setPendingDestination(pending);
    nav.place('end', destination);
    // Location is requested as a user action. The hook waits for the real fix prop;
    // it never consumes an immediate/network/IP callback as a route origin.
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

    const fallbackStart = nav.start ? undefined : freshQuickStart(latest.fix);
    if (!nav.start && !fallbackStart) return;

    pendingRef.current = null;
    setPendingDestination(null);
    plan(pending.destination, fallbackStart);
  }, [active, panelOpen, fix, navigation.start, navigation.end, pendingDestination, clearPending, plan]);

  return { begin, waitingForPosition: pendingDestination !== null };
}
