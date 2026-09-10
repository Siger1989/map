import type { Map as MapLibreMap } from 'maplibre-gl';
import { alternativeLineParts, trackAlternatives } from './alternatives';
import { syncOverlayData } from '../map/overlayData';
import type { FeatureCollection } from 'geojson';
import type { Coordinate } from '../navigation/types';
import type { ManualTrack, ScreenPoint } from './drawing';
import { normalizeTrackStyle, type TrackStyle } from './style';
import { pickLinePoint, type TrackLinePoint } from './linePoint';
import {
  coloredLineParts,
  edgeColorIndex,
  type TrackEdgeColors,
} from './edgeColors';
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
  draftEdgeColors?: TrackEdgeColors;
  visible: boolean;
  style: TrackStyle;
  nodes: Coordinate[];
  selectedId?: string | null;
  drawing?: boolean;
  connecting?: boolean;
  editing?: boolean;
  snapTargets?: boolean;
  movableTrackId?: string | null;
  alternativeId?: string;
  activeNode?: TrackNode | null;
  linePoint?: TrackLinePoint | null;
  preview?: { node: TrackNode; coordinate: Coordinate } | null;
};
export class TrackLayer {
  private state: TrackOverlay | null = null;
  constructor(private map: MapLibreMap) {}
  pickLine(point: ScreenPoint): TrackLinePoint | null {
    const id = this.pickTrack(point),
      state = this.state;
    if (!id || !state?.visible || id === 'live-recording') return null;
    const segments =
      id === DRAFT_ID
        ? state.draft
        : state.saved.find((t) => t.id === id)?.segments;
    return segments
      ? pickLinePoint(id, segments, point, (p) => this.map.project(p))
      : null;
  }
  pickNode(
    point: ScreenPoint,
    accept?: (node: TrackNode) => boolean,
    radius = 22,
  ): TrackNode | null {
    if (!this.map.getLayer('manual-track-node')) return null;
    const hits = this.map
      .queryRenderedFeatures(
        [
          [point.x - 22, point.y - 22],
          [point.x + 22, point.y + 22],
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
      .filter((hit) => hit.distance <= radius && (!accept || accept(hit)))
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
    this.state = state;
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
          'line-opacity': ['*', 0.65, ['get', 'opacity']],
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
          'line-opacity': ['get', 'opacity'],
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
      m.addLayer({
        id: 'manual-track-selected-node',
        type: 'circle',
        source: 'manual-tracks',
        filter: [
          'all',
          ['==', ['geometry-type'], 'Point'],
          ['==', ['get', 'active'], true],
        ],
        paint: {
          'circle-radius': 12,
          'circle-color': '#9de8c4',
          'circle-opacity': 0.14,
          'circle-stroke-color': '#aaffd8',
          'circle-stroke-width': 3,
        },
      });
      m.addLayer({
        id: 'manual-track-endpoint-label',
        type: 'symbol',
        source: 'manual-tracks',
        filter: ['has', 'endpointLabel'],
        layout: {
          'text-field': ['get', 'endpointLabel'],
          'text-size': 12,
          'text-font': ['Noto Sans Regular'],
          'text-anchor': 'bottom',
          'text-offset': [0, -1],
          'text-max-width': 12,
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#fff5cf',
          'text-halo-color': '#163c3c',
          'text-halo-width': 2,
        },
      });
    }
    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features: state.visible
        ? [
            ...state.saved.map((track) => ({
              segments: track.segments,
              edgeColors: track.edgeColors,
              trackId: track.id,
              draft: false,
              style: normalizeTrackStyle(track.style),
            })),
            {
              segments: state.draft,
              edgeColors: state.draftEdgeColors,
              trackId: DRAFT_ID,
              draft: true,
              style: normalizeTrackStyle(state.style),
            },
          ]
            .filter((t) => t.segments.length)
            .flatMap((t) => {
              const colors = t.edgeColors
                ? edgeColorIndex({
                    segments: t.segments,
                    edgeColors: t.edgeColors,
                  })
                : new Map();
              return alternativeLineParts(
                t.segments,
                t.trackId === state.selectedId ? state.alternativeId : 'main',
                t.style.color,
              )
                .flatMap((part) =>
                  coloredLineParts(
                    part.coordinates,
                    colors,
                    part.color ?? t.style.color,
                  ).map((piece) => ({ ...part, ...piece })),
                )
                .map((part) => ({
                  type: 'Feature',
                  properties: {
                    trackId: t.trackId,
                    selected: t.trackId === state.selectedId,
                    draft: t.draft,
                    ...t.style,
                    color: part.color ?? t.style.color,
                    opacity: (t.style.opacity ?? 1) * (part.muted ? 0.3 : 1),
                  },
                  geometry: {
                    type: 'MultiLineString',
                    coordinates: (state.preview?.node.trackId === t.trackId
                      ? moveSegmentsNode(
                          [part.coordinates],
                          state.preview.node.coordinate,
                          state.preview.coordinate,
                        )
                      : [part.coordinates]
                    ).filter((line) => line.length >= 2),
                  },
                }));
            })
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
        const snapTarget =
          state.snapTargets &&
          track.id !== DRAFT_ID &&
          !('hidden' in track && track.hidden) &&
          !('source' in track && track.source === 'recorded') &&
          !('samples' in track && track.samples !== undefined);
        if (
          state.editing === false ||
          (state.editing &&
            track.id !== state.selectedId &&
            !state.connecting &&
            !snapTarget)
        )
          continue;
        const color = normalizeTrackStyle(track.style).color;
        const branchColors = new Map(
          trackAlternatives(track.segments, color)
            .slice(1)
            .reverse()
            .flatMap((v) =>
              v.detour.slice(1, -1).map((p) => [p.join(','), v.color] as const),
            ),
        );
        const selected = track.id === state.selectedId;
        const positions = nodeHandles(
          track.segments,
          track.nodes ?? [],
          selected || !!state.connecting || !!snapTarget,
          (point) => m.project(point),
        );
        if (
          state.activeNode?.trackId === track.id &&
          !positions.some((p) =>
            equalCoordinate(p, state.activeNode!.coordinate),
          ) &&
          track.segments.some((s) =>
            s.some((p) => equalCoordinate(p, state.activeNode!.coordinate)),
          )
        )
          positions.push(state.activeNode.coordinate);
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
                color: branchColors.get(point.join(',')) ?? color,
                selected,
                active:
                  state.activeNode?.trackId === track.id &&
                  equalCoordinate(point, state.activeNode.coordinate),
                trackId: track.id,
                ...(selected &&
                (equalCoordinate(point, track.segments[0][0]) ||
                  equalCoordinate(point, track.segments.at(-1)!.at(-1)!))
                  ? {
                      endpointLabel: equalCoordinate(
                        point,
                        track.segments[0][0],
                      )
                        ? 'sharedRoute' in track &&
                          track.sharedRoute?.stops[0].name
                          ? `起点 · ${track.sharedRoute.stops[0].name}`
                          : '起点'
                        : 'sharedRoute' in track &&
                            track.sharedRoute?.stops.at(-1)?.name
                          ? `终点 · ${track.sharedRoute.stops.at(-1)!.name}`
                          : '终点',
                    }
                  : {}),
                lng: coordinates[0],
                lat: coordinates[1],
              },
              geometry: { type: 'Point' as const, coordinates },
            };
          }),
        );
      }
    }
    syncOverlayData(m, 'manual-tracks', data);
    if (!m.getSource('track-line-selection'))
      m.addSource('track-line-selection', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    if (!m.getLayer('track-line-selection'))
      m.addLayer({
        id: 'track-line-selection',
        type: 'circle',
        source: 'track-line-selection',
        paint: {
          'circle-color': '#20dc84',
          'circle-radius': 7,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });
    syncOverlayData(m, 'track-line-selection', {
      type: 'FeatureCollection',
      features:
        state.visible && state.linePoint
          ? [
              {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'Point',
                  coordinates: state.linePoint.coordinate,
                },
              },
            ]
          : [],
    });
  }
}
