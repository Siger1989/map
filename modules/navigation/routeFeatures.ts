import type { Feature, FeatureCollection } from 'geojson';
import { metresBetween, type Coordinate, type RouteOverlay } from './types.ts';
import { createNavigationProgressParts } from './routeProgress.ts';

/** Shared route geometry for Web and native renderers; routing and saved data remain untouched. */
export function createRouteFeatures(state: RouteOverlay, navigationPosition: Coordinate | null = null): FeatureCollection {
  const startHidden = !!state.start && !!navigationPosition && metresBetween(state.start.coordinates, navigationPosition) < 40;
  const features: Feature[] = [];
  const routeStyle = state.route?.style;
  const routeStyleProperties = routeStyle ? { routeColor: routeStyle.color, routeWidth: routeStyle.width } : {};
  const navigationActive = !!state.route && Number.isFinite(state.navigationProgress);
  if (state.route && navigationActive) {
    for (const part of createNavigationProgressParts(state.route, state.navigationProgress!)) {
      features.push({
        type: 'Feature',
        properties: {
          kind: part.kind,
          navigationState: part.navigationState,
          navigationClose: state.navigationClose === true,
          opacity: state.route.displayOpacity ?? 1,
          ...routeStyleProperties,
        },
        geometry: { type: 'LineString', coordinates: part.coordinates },
      });
    }
  } else {
    if (state.route && state.displayParts)
      for (const part of state.displayParts)
        features.push({
          type: 'Feature',
          properties: { kind: 'road', color: part.color, opacity: state.route.displayOpacity ?? 1, ...routeStyleProperties },
          geometry: { type: 'LineString', coordinates: part.coordinates },
        });
    if (state.route)
      for (const segment of state.route.segments ?? [
        { kind: 'road', coordinates: state.route.coordinates },
      ]) {
        if (state.displayParts && segment.kind !== 'access') continue;
        features.push({
          type: 'Feature',
          properties: { kind: segment.kind, opacity: state.route.displayOpacity ?? 1, ...routeStyleProperties },
          geometry: { type: 'LineString', coordinates: segment.coordinates },
        });
      }
  }
  for (const slot of ['start', 'end'] as const)
    if (state[slot] && !(slot === 'start' && startHidden))
      features.push({
        type: 'Feature',
        properties: { slot, label: slot === 'start' ? '起' : '终', name: state[slot]!.name },
        geometry: { type: 'Point', coordinates: state[slot]!.coordinates },
      });
  for (const [index, place] of (state.via ?? []).entries())
    if (place)
      features.push({
        type: 'Feature',
        properties: { slot: 'via', label: String(index + 1), name: place.name },
        geometry: { type: 'Point', coordinates: place.coordinates },
      });
  return { type: 'FeatureCollection', features };
}
