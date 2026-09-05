import type { Map, GeoJSONSource } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import type { Coordinate } from '../navigation/types';
import type { ManualTrack } from './drawing';
import { normalizeTrackStyle, type TrackStyle } from './style';
export type TrackOverlay = {
  saved: ManualTrack[];
  draft: Coordinate[][];
  visible: boolean;
  style: TrackStyle;
  nodes: Coordinate[];
};
export class TrackLayer {
  constructor(private map: Map) {}
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
          'line-color': '#10212b',
          'line-opacity': 0.65,
          'line-width': ['+', ['get', 'width'], 1],
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
          'circle-radius': 3,
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
              draft: false,
              style: normalizeTrackStyle(track.style),
            })),
            {
              segments: state.draft,
              draft: true,
              style: normalizeTrackStyle(state.style),
            },
          ]
            .filter((t) => t.segments.length)
            .map((t) => ({
              type: 'Feature',
              properties: { draft: t.draft, ...t.style },
              geometry: {
                type: 'MultiLineString',
                coordinates: t.segments.filter((line) => line.length >= 2),
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
      for (const track of state.saved) {
        const color = normalizeTrackStyle(track.style).color;
        const positions = [
          ...(track.nodes ?? []),
          ...track.segments.flatMap((line) => [line[0], line.at(-1)!]),
        ];
        data.features.push(
          ...positions.map((coordinates) => ({
            type: 'Feature' as const,
            properties: { color },
            geometry: { type: 'Point' as const, coordinates },
          })),
        );
      }
      const nodes = [
        ...state.nodes,
        ...state.draft.flatMap((line) =>
          line.length ? [line[0], line.at(-1)!] : [],
        ),
      ];
      data.features.push(
        ...nodes.map((coordinates) => ({
          type: 'Feature' as const,
          properties: { color: state.style.color },
          geometry: { type: 'Point' as const, coordinates },
        })),
      );
    }
    (m.getSource('manual-tracks') as GeoJSONSource).setData(data);
    m.moveLayer('manual-track-outline');
    m.moveLayer('manual-track-line');
    m.moveLayer('manual-track-node');
  }
}
