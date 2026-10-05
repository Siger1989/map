import type { Map, GeoJSONSource } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';

const snapshots = new WeakMap<GeoJSONSource, string>();
const overlayOrder = [
  'area-fill',
  'area-border',
  'area-nodes',
  'route-outline',
  'route-path',
  'route-access',
  'route-points',
  'route-point-labels',
  'manual-track-outline',
  'manual-track-selection-edge',
  'manual-track-line',
  'manual-track-node',
  'manual-track-endpoint-label',
  'manual-track-notes-line',
  'manual-track-notes-point',
  'guidance-outline',
  'guidance-path',
  'guidance-access',
  'guidance-target',
  'route-grade-warning-dot',
  'route-grade-warning-label',
  'manual-track-selected-node',
  'track-line-selection-halo',
  'track-line-selection',
  'route-gap-line',
  'route-gap-points',
  'position-accuracy',
  'position-dot',
  'position-arrow',
  'position-ip-label',
];
const ROAD_LINE_LAYERS = [
  'rivers',
  'road-outline',
  'main-roads',
  'local-roads',
  'railways',
];
const LINE_BELOW_PLACE_LABELS = new Set([
  ...ROAD_LINE_LAYERS,
  'route-outline',
  'route-path',
  'route-access',
  'manual-track-outline',
  'manual-track-selection-edge',
  'manual-track-line',
  'guidance-outline',
  'guidance-path',
  'guidance-access',
  'route-gap-line',
]);
const PLACE_LABEL_LAYERS = new Set([
  'domestic-labels-map',
  'domestic-labels-image',
  'domestic-labels-terrain',
  'road-numbers',
  'road-names',
  'city-names',
  'town-names',
  'village-names',
  'neighborhood-names',
  'peak-names',
  'water-names',
]);

/** Keep geographic strokes below visible raster/vector labels; retain annotations above them. */
export function syncPlaceLabelLayerOrder(map: Map) {
  const layers = map.getStyle().layers;
  const present = layers.map((layer) => layer.id);
  const visibleLabels = layers.filter(
    (layer) => (PLACE_LABEL_LAYERS.has(layer.id) || layer.id.startsWith('shantu-user-map-ovmap-')) && layer.layout?.visibility !== 'none',
  );
  const anchor = visibleLabels.reduce<typeof visibleLabels[number] | undefined>(
    (first, layer) => !first || present.indexOf(layer.id) < present.indexOf(first.id) ? layer : first,
    undefined,
  );
  const lineLayers = [
    ...ROAD_LINE_LAYERS,
    ...overlayOrder.filter((id) => LINE_BELOW_PLACE_LABELS.has(id) && !ROAD_LINE_LAYERS.includes(id)),
  ].filter((id) => present.includes(id));
  const topOverlays = overlayOrder.filter(
    (id) => present.includes(id) && !LINE_BELOW_PLACE_LABELS.has(id),
  );

  if (anchor) {
    const index = present.indexOf(anchor.id);
    const immediatelyBefore = present.slice(Math.max(0, index - lineLayers.length), index);
    if (immediatelyBefore.length !== lineLayers.length || immediatelyBefore.some((id, i) => id !== lineLayers[i])) {
      for (const id of lineLayers) map.moveLayer(id, anchor.id);
    }
    const current = map.getStyle().layers.map((layer) => layer.id);
    const suffix = current.slice(-topOverlays.length);
    if (topOverlays.length && suffix.some((id, i) => id !== topOverlays[i]))
      for (const id of topOverlays) map.moveLayer(id);
    return;
  }

  // Without visible labels, preserve the established overlayOrder exactly;
  // base roads keep their style position and overlays remain above late roads.
  const desiredTop = overlayOrder.filter((id) => present.includes(id));
  const current = map.getStyle().layers.map((layer) => layer.id);
  const suffix = current.slice(-desiredTop.length);
  if (desiredTop.length && suffix.some((id, i) => id !== desiredTop[i]))
    for (const id of desiredTop) map.moveLayer(id);
}

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
  syncPlaceLabelLayerOrder(map);
  return changed;
}

/** The source was mutated outside syncOverlayData; force its next full baseline write. */
export function invalidateOverlayData(map: Map, id: string) {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  if (source) snapshots.delete(source);
}
