import type { Map } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import type { TrackOverlay } from './TrackLayer';
import { DRAFT_ID, moveSegmentsNode } from './editing.ts';
import { selectedEdges } from './selectionDetails.ts';
import { normalizeTrackStyle } from './style.ts';
import { syncOverlayData } from '../map/overlayData.ts';
import { routeLineOpacityExpression, routeLineWidthExpression } from '../map/zoomLineWidth.ts';

const SELECTION_GREEN = '#20b978';

/** Geographic edges let MapLibre drape selection on the same terrain as the route. */
export function selectedEdgeData(state: TrackOverlay): FeatureCollection {
  const selection = state.nodeSelection;
  const track = selection?.trackId === DRAFT_ID
    ? { segments: state.draft, style: state.style }
    : state.saved.find(track => track.id === selection?.trackId);
  if (!state.visible || !state.editing || !selection || !track) return { type: 'FeatureCollection', features: [] };
  const edges = selectedEdges(track.segments, selection.points).map(({ a, b }) => [a, b]);
  const coordinates = state.preview?.node.trackId === selection.trackId
    ? moveSegmentsNode(edges, state.preview.node.coordinate, state.preview.coordinate)
    : edges;
  return {
    type: 'FeatureCollection',
    features: coordinates.length ? [{
      id: 'manual-track-selected-edge',
      type: 'Feature', properties: { width: normalizeTrackStyle(track.style).width, color: SELECTION_GREEN, opacity: 1 },
      geometry: { type: 'MultiLineString', coordinates },
    }] : [],
  };
}

export function syncSelectedEdges(map: Map, state: TrackOverlay) {
  const id = 'manual-track-selection-edge';
  if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const lineLayer = (layerId: string, widthOffset: number, opacity: number) => ({
    id: layerId, type: 'line' as const, source: id,
    layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
    paint: {
      'line-color': SELECTION_GREEN,
      'line-width': routeLineWidthExpression(['+', ['get', 'width'], widthOffset]),
      'line-opacity': routeLineOpacityExpression(opacity),
    },
  });
  if (!map.getLayer(`${id}-halo-outer`)) map.addLayer(lineLayer(`${id}-halo-outer`, 9, 0.16), map.getLayer(id) ? id : undefined);
  if (!map.getLayer(`${id}-halo-inner`)) map.addLayer(lineLayer(`${id}-halo-inner`, 5, 0.3), map.getLayer(id) ? id : undefined);
  if (!map.getLayer(id)) map.addLayer(lineLayer(id, 2.5, 1));
  syncOverlayData(map, id, selectedEdgeData(state));
}
