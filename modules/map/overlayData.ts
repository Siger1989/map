import type { Map, GeoJSONSource } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';

const snapshots = new WeakMap<GeoJSONSource, string>();
const overlayOrder = [
  'area-fill',
  'area-border',
  'area-nodes',
  'route-outline',
  'route-path',
  'route-points',
  'route-point-labels',
  'manual-track-outline',
  'manual-track-line',
  'manual-track-node',
  'manual-track-selected-node',
  'manual-track-endpoint-label',
  'guidance-outline',
  'guidance-path',
  'guidance-target',
  'position-accuracy',
  'position-dot',
];

/** Avoid invalidating terrain drape textures for unchanged geometry or layer order. */
export function syncOverlayData(map: Map, id: string, data: FeatureCollection) {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  if (!source) return false;
  const serialized = JSON.stringify(data);
  const changed = snapshots.get(source) !== serialized;
  if (changed) {
    source.setData(data);
    snapshots.set(source, serialized);
  }
  const present = map.getStyle().layers.map((layer) => layer.id);
  const desired = overlayOrder.filter((layer) => present.includes(layer));
  const actual = present.slice(-desired.length);
  if (actual.some((layer, index) => layer !== desired[index])) {
    // Base roads may load after the route. Keep overlays above them, then leave
    // the order untouched on subsequent location/recording polls.
    for (const layer of desired) map.moveLayer(layer);
  }
  return changed;
}
