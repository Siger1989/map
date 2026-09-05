import type { Map, GeoJSONSource } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import type { Coordinate } from '../navigation/types';
import type { ManualTrack, ScreenPoint } from './drawing';
import { normalizeTrackStyle, type TrackStyle } from './style';
import {
  DRAFT_ID,
  moveSegmentsNode,
  nodeHandles,
  equalCoordinate,
  type TrackNode,
} from './editing';
export type TrackOverlay = {
  saved: ManualTrack[];
  draft: Coordinate[][];
  visible: boolean;
  style: TrackStyle;
  nodes: Coordinate[];
  selectedId?: string | null;
  preview?: { node: TrackNode; coordinate: Coordinate } | null;
};
export class TrackLayer {
  constructor(private map: Map) {}
  pickNode(point: ScreenPoint): TrackNode | null {
    if (!this.map.getLayer('manual-track-node')) return null;
    const hits = this.map
      .queryRenderedFeatures(
        [
          [point.x - 14, point.y - 14],
          [point.x + 14, point.y + 14],
        ],
        { layers: ['manual-track-node'] },
      )
      .map((feature) => {
        const p = feature.properties;
        const coordinate: Coordinate = [Number(p.lng), Number(p.lat)];
        const screen = this.map.project(coordinate);
        return {
          trackId: String(p.trackId),
          coordinate,
          distance: Math.hypot(screen.x - point.x, screen.y - point.y),
        };
      })
      .filter((hit) => hit.distance <= 14)
      .sort((a, b) => a.distance - b.distance);
    return hits[0] ?? null;
  }
  pickTrack(point: ScreenPoint): string | null {
    const node = this.pickNode(point);
    if (node) return node.trackId;
    if (!this.map.getLayer('manual-track-line')) return null;
    const hits = this.map.queryRenderedFeatures(
      [
        [point.x - 10, point.y - 10],
        [point.x + 10, point.y + 10],
      ],
      { layers: ['manual-track-line'] },
    );
    return hits[0]?.properties.trackId ?? null;
  }
  sync(state: TrackOverlay) {
    const m = this.map;
    if (!m.getSource('manual-tracks'))
      m.addSource('manual-tracks', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    if (!m.getLayer('manual-track-line')) {
      m.addLayer({
        id: 'manual-track-outline',
        type: 'line',
        source: 'manual-tracks',
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['case', ['get', 'selected'], '#ffffff', '#10212b'],
          'line-opacity': 0.65,
          'line-width': [
            '+',
            ['get', 'width'],
            ['case', ['get', 'selected'], 5, 1],
          ],
        },
      });
      m.addLayer({
        id: 'manual-track-line',
        type: 'line',
        source: 'manual-tracks',
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['get', 'width'],
        },
      });
      m.addLayer({
        id: 'manual-track-node',
        type: 'circle',
        source: 'manual-tracks',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 5, 3],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
        },
      });
    }
    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features: state.visible
        ? [
            ...state.saved.map((track) => ({
              segments: track.segments,
              trackId: track.id,
              draft: false,
              style: normalizeTrackStyle(track.style),
            })),
            {
              segments: state.draft,
              trackId: DRAFT_ID,
              draft: true,
              style: normalizeTrackStyle(state.style),
            },
          ]
            .filter((t) => t.segments.length)
            .map((t) => ({
              type: 'Feature',
              properties: {
                trackId: t.trackId,
                selected: t.trackId === state.selectedId,
                draft: t.draft,
                ...t.style,
              },
              geometry: {
                type: 'MultiLineString',
                coordinates: (state.preview?.node.trackId === t.trackId
                  ? moveSegmentsNode(
                      t.segments,
                      state.preview.node.coordinate,
                      state.preview.coordinate,
                    )
                  : t.segments
                ).filter((line) => line.length >= 2),
              },
            }))
        : [],
    };
    data.features = data.features.filter(
      (f) =>
        f.geometry.type !== 'MultiLineString' ||
        f.geometry.coordinates.length > 0,
    );
    if (state.visible) {
      for (const track of [
        ...state.saved,
        {
          id: DRAFT_ID,
          style: state.style,
          segments: state.draft,
          nodes: state.nodes,
        },
      ]) {
        const color = normalizeTrackStyle(track.style).color;
        const selected = track.id === state.selectedId;
        const positions = nodeHandles(
          track.segments,
          track.nodes ?? [],
          selected,
          (point) => m.project(point),
        );
        data.features.push(
          ...positions.map((point) => {
            const coordinates =
              state.preview?.node.trackId === track.id &&
              equalCoordinate(point, state.preview.node.coordinate)
                ? state.preview.coordinate
                : point;
            return {
              type: 'Feature' as const,
              properties: {
                color,
                selected,
                trackId: track.id,
                lng: coordinates[0],
                lat: coordinates[1],
              },
              geometry: { type: 'Point' as const, coordinates },
            };
          }),
        );
      }
    }
    (m.getSource('manual-tracks') as GeoJSONSource).setData(data);
    m.moveLayer('manual-track-outline');
    m.moveLayer('manual-track-line');
    m.moveLayer('manual-track-node');
  }
}
