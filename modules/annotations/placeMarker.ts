import type { RoutePlace } from '../navigation/types';
import type { Annotation } from './data';

export function placeMarkerDefaults(place: RoutePlace) {
  return {
    name: (place.name || '地点').trim().slice(0, 60) || '地点',
    icon: 'pin' as const,
    note: (place.detail || '').slice(0, 500),
  };
}

/** Re-selecting the same named place must not fill the user's store with duplicates. */
export function existingPlaceMarker(items: Annotation[], place: RoutePlace) {
  const { name } = placeMarkerDefaults(place);
  return items.find(item => item.kind === 'pin' && !item.trackAnchor && !item.sectionAnchor &&
    item.name === name && item.coordinates.every((value, index) => Math.abs(value - place.coordinates[index]) <= 1e-6));
}
