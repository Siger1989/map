import type { Map } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import type { TrackOverlay } from './TrackLayer';
import { DRAFT_ID, moveSegmentsNode } from './editing.ts';
import { selectedEdges } from './selectionDetails.ts';
import { normalizeTrackStyle } from './style.ts';
import { syncOverlayData } from '../map/overlayData.ts';

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
      type: 'Feature', properties: { width: normalizeTrackStyle(track.style).width + 2.5 },
      geometry: { type: 'MultiLineString', coordinates },
    }] : [],
  };
}

export function syncSelectedEdges(map: Map, state: TrackOverlay) {
  const id = 'manual-track-selection-edge';
  if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  if (!map.getLayer(id)) map.addLayer({
    id, type: 'line', source: id,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#fff3a0', 'line-width': ['get', 'width'] },
  });
  syncOverlayData(map, id, selectedEdgeData(state));
}
