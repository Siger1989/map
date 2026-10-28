import type { Feature, FeatureCollection } from 'geojson';
import { createRouteFeatures } from '../../navigation/routeFeatures.ts';
import type { Coordinate, RouteOverlay } from '../../navigation/types.ts';

/** Resolve the existing RouteLayer paint expressions for a renderer without MapLibre styles. */
export function createNativeRouteGeometry(state: RouteOverlay, navigationPosition: Coordinate | null = null): FeatureCollection {
  const shared = createRouteFeatures(state, navigationPosition);
  const outlines: Feature[] = [], paths: Feature[] = [], access: Feature[] = [], points: Feature[] = [];
  for (const item of shared.features) {
    const p = item.properties ?? {};
    const nativePick = { kind: 'route' };
    if (item.geometry.type === 'Point') {
      const color = p.slot === 'start' ? '#22a46b' : p.slot === 'via' ? '#cae3ff' : '#e34f4f';
      points.push({ ...item, properties: { ...p, nativePick, role: 'routePoint', color, pointSize: 20,
        label: `${p.label} · ${p.name}`, labelColor: '#ffffff',
        labelHaloColor: p.slot === 'start' ? '#126a45' : p.slot === 'end' ? '#9d2727' : '#14392e' } });
      continue;
    }
    const traveled = p.navigationState === 'traveled';
    const close = traveled && p.navigationClose === true;
    if (p.kind === 'access') {
      access.push({ ...item, properties: { ...p, nativePick, role: 'routeAccess',
        color: traveled ? '#8e999b' : '#ffcb65', width: close ? 14 : 4, dash: [2, 2] } });
      continue;
    }
    outlines.push({ ...item, properties: { ...p, nativePick, role: 'routeOutline',
      color: traveled ? '#384244' : '#102a38', width: close ? 18 : (p.routeWidth ?? 4) + 4 } });
    paths.push({ ...item, properties: { ...p, nativePick, role: 'routePath',
      color: p.navigationState === 'future' ? '#39c878' : traveled ? '#8e999b' : p.color ?? p.routeColor ?? '#59dcff',
      width: close ? 14 : p.routeWidth ?? 4 } });
  }
  return { type: 'FeatureCollection', features: [...outlines, ...paths, ...access, ...points] };
}
