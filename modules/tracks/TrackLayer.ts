import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { resolvedRouteTerminals } from './routeTerminals';
import { selectedEdgeData, syncSelectedEdges } from './selectedEdgeLayer';
import { syncTrackNotes } from './trackNotes';
import { invalidateOverlayData, syncOverlayData } from '../map/overlayData';
import {
  syncRouteWarnings,
  type RouteWarning,
} from '../routeDisplay/RouteWarnings';
import type { FeatureCollection } from 'geojson';
import type { Coordinate } from '../navigation/types';
import type { ManualTrack, ScreenPoint } from './drawing';
import type { TrackStyle } from './style';
import { metricLineParts } from '../routeAnalysis/metrics';
import { pickLinePoint, type TrackLinePoint } from './linePoint';
import type { TrackEdgeColors } from './edgeColors';
import {
  DRAFT_ID,
  nodeHandles,
  equalCoordinate,
  type TrackNode,
} from './editing';
import {
  draftTrackRenderItem,
  savedTrackRenderItem,
  trackLineFeatures,
  trackNodeFeatures,
  trackRendersNodes,
} from './trackFeatures';
export type TrackOverlay = {
  analysisMarkers?: RouteWarning[];
  analysisParts?: {
    trackId: string;
    parts: ReturnType<typeof metricLineParts>;
  };
  saved: ManualTrack[];
  draft: Coordinate[][];
  draftEdgeColors?: TrackEdgeColors;
  visible: boolean;
  style: TrackStyle;
  nodes: Coordinate[];
  selectedId?: string | null;
  reversed?: boolean;
  drawing?: boolean;
  connecting?: boolean;
  editing?: boolean;
  snapTargets?: boolean;
  movableTrackId?: string | null;
  alternativeId?: string;
  activeNode?: TrackNode | null;
  nodeSelection?: { trackId: string; points: Coordinate[] };
  linePoint?: TrackLinePoint | null;
  preview?: { node: TrackNode; coordinate: Coordinate } | null;
};
const EMPTY_NODE_COORDINATES: Coordinate[] = [];
const TRACK_LAYER_IDS = [
  'manual-track-outline',
  'manual-track-line',
  'manual-track-node',
  'manual-track-selected-node',
  'manual-track-endpoint-label',
  'track-line-selection-halo',
  'track-line-selection',
];
export class TrackLayer {
  private state: TrackOverlay | null = null;
  private baselineSource: GeoJSONSource | null = null;
  private baselineFeatures = new Map<string | number, FeatureCollection['features'][number]>();
  private trackFeatureIds = new Map<string, Set<string | number>>();
  private nodeFeatures = new Map<string, Set<string | number>>();
  private lineFeatures = new Map<string, Set<string | number>>();
  private activePreview: TrackOverlay['preview'] = null;
  private selectedEdgeSource: GeoJSONSource | null = null;
  private selectedEdgeTrackId: string | null = null;
  private selectedEdgeGeometry: FeatureCollection['features'][number]['geometry'] | null = null;
  private selectedEdgeBaseline: FeatureCollection | null = null;
  private previewRevision = 0;
  private projectionValid = false;
  private projectionEpoch = 0;
  private handleCache = new Map<string, {
    segments: Coordinate[][];
    explicit: Coordinate[];
    expanded: boolean;
    epoch: number;
    positions: Coordinate[];
  }>();
  constructor(private map: MapLibreMap) {
    // Handle visibility is selected by screen-space spacing, so camera movement
    // invalidates the result even when route geometry itself has not changed.
    map.on?.('movestart', () => {
      this.projectionValid = false;
      this.projectionEpoch++;
    });
    map.on?.('styledata', () => {
      const source = map.getSource('manual-tracks');
      if (
        source !== this.baselineSource ||
        TRACK_LAYER_IDS.some((id) => !map.getLayer(id))
      ) this.invalidateProjectedHandles();
    });
    map.on?.('webglcontextlost', () => this.invalidateProjectedHandles());
    map.on?.('webglcontextrestored', () => this.invalidateProjectedHandles());
    map.on?.('terrain', () => this.invalidateProjectedHandles());
    map.on?.('resize', () => this.invalidateProjectedHandles());
    map.on?.('sourcedata', (event) => {
      const terrainSource = map.getTerrain()?.source;
      if (terrainSource && event.sourceId === terrainSource) this.invalidateProjectedHandles();
    });
  }
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
        const coordinate: Coordinate = [Number(p.nodeLng ?? p.lng), Number(p.nodeLat ?? p.lat)];
        const screen = this.map.project([Number(p.lng), Number(p.lat)]);
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
    const previous = this.state;
    const hadActivePreview = !!this.activePreview;
    if (hadActivePreview) this.preview(null);
    if (
      !hadActivePreview &&
      previous &&
      this.projectionValid &&
      !this.map.isMoving?.() &&
      this.canPatchActiveNode(previous, state)
    ) {
      const source = this.map.getSource('manual-tracks') as GeoJSONSource | undefined;
      const layersIntact = TRACK_LAYER_IDS.every((id) => this.map.getLayer(id));
      if (source && source === this.baselineSource && layersIntact && typeof source.updateData === 'function') {
        this.state = state;
        if (this.patchActiveNode(source, previous.activeNode, state.activeNode)) {
          // Selection geometry is independent, but syncing it here preserves
          // correctness if its source was replaced between layer syncs.
          syncSelectedEdges(this.map, state);
          const selectedEdges = selectedEdgeData(state);
          this.selectedEdgeBaseline = selectedEdges;
          this.selectedEdgeSource = this.map.getSource('manual-track-selection-edge') as GeoJSONSource | undefined ?? null;
          this.selectedEdgeTrackId = state.nodeSelection?.trackId ?? null;
          this.selectedEdgeGeometry = selectedEdges.features[0]?.geometry ?? null;
          return;
        }
      }
    }
    if (
      !hadActivePreview && previous && this.projectionValid && !this.map.isMoving?.() &&
      this.canPatchSingleTrack(previous, state)
    ) {
      const source = this.map.getSource('manual-tracks') as GeoJSONSource | undefined;
      if (source && source === this.baselineSource && TRACK_LAYER_IDS.every((id) => this.map.getLayer(id)) && typeof source.updateData === 'function' && this.patchSingleTrack(source, previous, state)) return;
    }
    syncRouteWarnings(this.map, state.analysisMarkers ?? []);
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
            ['case', ['get', 'selected'], 2, 1],
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
          'circle-radius': ['/', ['coalesce', ['get', 'pointSize'], 8], 2],
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
          'circle-radius': ['/', ['coalesce', ['get', 'pointSize'], 8], 2],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-pitch-alignment': 'viewport',
          'circle-pitch-scale': 'viewport',
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
    const renderItems = state.visible
      ? [...state.saved.map(savedTrackRenderItem), draftTrackRenderItem(state)]
      : [];
    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features: renderItems.flatMap((item) => trackLineFeatures(item, state)),
    };
    if (state.visible) {
      // Endpoint labels also belong to selection mode, not only editable node handles.
      if (state.editing === false && state.selectedId) {
        const selected = state.selectedId === DRAFT_ID ? { id:DRAFT_ID, segments:state.draft } : state.saved.find(t => t.id === state.selectedId);
        if (selected) {
          const ends = resolvedRouteTerminals(selected);
          if (state.reversed) ends.reverse();
          ends.forEach((coordinates, i) => { if (coordinates) data.features.push({type:'Feature', properties:{ trackId:selected.id, selected:true, color:i ? '#db7829' : '#16824b', endpointLabel:i ? '终点' : '起点', lng:coordinates[0], lat:coordinates[1] }, geometry:{type:'Point', coordinates}}); });
        }
      }
      for (const item of renderItems) {
        if (!trackRendersNodes(item, state)) continue;
        const track = item.track;
        const [routeStart, routeEnd] = resolvedRouteTerminals(track);
        const positions = this.routeHandles(
          String(track.id),
          track.segments,
          track.nodes ?? EMPTY_NODE_COORDINATES,
          track.id === state.selectedId || !!state.connecting ||
            (!!state.snapTargets && track.id !== DRAFT_ID && !track.hidden && track.source !== 'recorded' && track.samples === undefined),
        );
        for(const terminal of [routeStart,routeEnd]) if(terminal && !positions.some(point=>equalCoordinate(point,terminal)))positions.push(terminal);
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
        data.features.push(...trackNodeFeatures(item, state, positions));
      }
    }
    // Stable per-track IDs let a one-route edit add/remove only that route's features.
    const baselineFeatures = new Map<string | number, FeatureCollection['features'][number]>();
    const nodeFeatures = new Map<string, Set<string | number>>();
    const lineFeatures = new Map<string, Set<string | number>>();
    const trackFeatureIds = new Map<string, Set<string | number>>();
    assignTrackFeatureIds(data.features);
    for (const feature of data.features) indexFeature(feature, baselineFeatures, trackFeatureIds, nodeFeatures, lineFeatures);
    this.baselineFeatures = baselineFeatures;
    this.trackFeatureIds = trackFeatureIds;
    this.nodeFeatures = nodeFeatures;
    this.lineFeatures = lineFeatures;
    syncSelectedEdges(m, state);
    const selectedEdges = selectedEdgeData(state);
    this.selectedEdgeBaseline = selectedEdges;
    this.selectedEdgeSource = m.getSource('manual-track-selection-edge') as GeoJSONSource | undefined ?? null;
    this.selectedEdgeTrackId = state.nodeSelection?.trackId ?? null;
    this.selectedEdgeGeometry = selectedEdges.features[0]?.geometry ?? null;
    syncTrackNotes(m, state.visible ? state.saved : []);
    syncOverlayData(m, 'manual-tracks', data);
    this.baselineSource = m.getSource('manual-tracks') as GeoJSONSource | undefined ?? null;
    if (!m.getSource('track-line-selection'))
      m.addSource('track-line-selection', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    if (!m.getLayer('track-line-selection-halo'))
      m.addLayer({
        id: 'track-line-selection-halo', type: 'circle', source: 'track-line-selection',
        paint: {
          'circle-radius': 10, 'circle-color': '#20b978', 'circle-opacity': 0.25,
          'circle-blur': 0.35, 'circle-pitch-alignment': 'viewport', 'circle-pitch-scale': 'viewport',
        },
      });
    if (!m.getLayer('track-line-selection'))
      m.addLayer({
        id: 'track-line-selection',
        type: 'circle',
        source: 'track-line-selection',
        paint: {
          'circle-color': '#20dc84',
          'circle-radius': 5,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-pitch-alignment': 'viewport',
          'circle-pitch-scale': 'viewport',
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
    const currentTrackIds = new Set(state.saved.map((track) => String(track.id)));
    currentTrackIds.add(DRAFT_ID);
    for (const id of this.handleCache.keys()) {
      if (!currentTrackIds.has(id)) this.handleCache.delete(id);
    }
    this.projectionValid = !this.map.isMoving?.();
  }

  private invalidateProjectedHandles() {
    this.projectionValid = false;
    this.projectionEpoch++;
  }

  private routeHandles(
    trackId: string,
    segments: Coordinate[][],
    explicit: Coordinate[],
    expanded: boolean,
  ) {
    const moving = this.map.isMoving?.() ?? false;
    const cached = this.handleCache.get(trackId);
    if (
      !moving &&
      cached?.segments === segments &&
      cached.explicit === explicit &&
      cached.expanded === expanded &&
      cached.epoch === this.projectionEpoch
    ) return cached.positions.slice();
    const positions = nodeHandles(segments, explicit, expanded, (point) => this.map.project(point));
    if (!moving) this.handleCache.set(trackId, { segments, explicit, expanded, epoch: this.projectionEpoch, positions });
    else this.handleCache.delete(trackId);
    return positions.slice();
  }

  private canPatchActiveNode(previous: TrackOverlay, next: TrackOverlay) {
    if (
      previous.visible !== next.visible ||
      !sameDraft(previous.draft, next.draft) ||
      previous.draftEdgeColors !== next.draftEdgeColors ||
      previous.style !== next.style ||
      previous.nodes !== next.nodes ||
      previous.selectedId !== next.selectedId ||
      previous.reversed !== next.reversed ||
      previous.drawing !== next.drawing ||
      previous.connecting !== next.connecting ||
      previous.editing !== next.editing ||
      previous.snapTargets !== next.snapTargets ||
      previous.movableTrackId !== next.movableTrackId ||
      previous.alternativeId !== next.alternativeId ||
      previous.analysisMarkers !== next.analysisMarkers ||
      previous.analysisParts !== next.analysisParts ||
      previous.linePoint !== next.linePoint ||
      previous.preview !== next.preview ||
      previous.saved.length !== next.saved.length
    ) return false;
    for (let i = 0; i < previous.saved.length; i++) {
      if (previous.saved[i] !== next.saved[i]) return false;
    }
    return !sameTrackNode(previous.activeNode, next.activeNode);
  }

  private canPatchSingleTrack(previous: TrackOverlay, next: TrackOverlay) {
    if (!previous.visible || !next.visible || previous.editing !== true || next.editing !== true ||
      previous.visible !== next.visible || previous.selectedId !== next.selectedId ||
      previous.reversed !== next.reversed || previous.drawing !== next.drawing || previous.connecting !== next.connecting ||
      previous.editing !== next.editing || previous.snapTargets !== next.snapTargets || previous.movableTrackId !== next.movableTrackId ||
      previous.alternativeId !== next.alternativeId || previous.analysisMarkers !== next.analysisMarkers ||
      previous.analysisParts !== next.analysisParts || previous.linePoint !== next.linePoint || previous.preview !== next.preview ||
      previous.saved.length !== next.saved.length || this.activePreview || this.map.isMoving?.()) return false;
    const emptyDraft = previous.draft.length === 0 && next.draft.length === 0;
    if (!sameDraft(previous.draft, next.draft)) return false;
    // For a saved-route edit, composeTrackOverlay creates a fresh empty draft
    // and mirrors the edited track's style/nodes at the overlay level. Those
    // fields render only the empty draft; the changed saved track carries its
    // own authoritative style and nodes into buildTrackFeatures.
    if (!emptyDraft && (previous.draftEdgeColors !== next.draftEdgeColors || previous.style !== next.style || previous.nodes !== next.nodes)) return false;
    let changed = -1;
    for (let i = 0; i < previous.saved.length; i++) {
      if (previous.saved[i]?.id !== next.saved[i]?.id) return false;
      if (previous.saved[i] !== next.saved[i]) {
        if (changed !== -1) return false;
        changed = i;
      }
    }
    if (changed < 0) return false;
    const id = String(next.saved[changed].id);
    if (previous.activeNode?.trackId !== undefined && previous.activeNode.trackId !== id) return false;
    if (next.activeNode?.trackId !== undefined && next.activeNode.trackId !== id) return false;
    return true;
  }

  private patchSingleTrack(source: GeoJSONSource, previous: TrackOverlay, next: TrackOverlay) {
    if (typeof source.updateData !== 'function') return false;
    const changedIndex = previous.saved.findIndex((track, index) => track !== next.saved[index]);
    if (changedIndex < 0) return false;
    const id = String(next.saved[changedIndex].id);
    const replacement = this.buildTrackFeatures(next.saved[changedIndex], next);
    const oldIds = [...(this.trackFeatureIds.get(id) ?? [])];
    const remove = oldIds;
    const add = replacement;
    // Invalidate the complete-collection snapshot before mutating the live source.
    invalidateOverlayData(this.map, 'manual-tracks');
    try {
      void source.updateData({ remove, add }).catch((error) => {
        if (this.map.getSource('manual-tracks') !== source) return;
        this.restoreCanonicalBaseline(source, 'Could not restore route edit baseline');
        console.warn('Could not patch edited route', error);
      });
    } catch {
      return false;
    }
    for (const featureId of oldIds) {
      const feature = this.baselineFeatures.get(featureId);
      if (feature) unindexFeature(feature, this.nodeFeatures, this.lineFeatures);
      this.baselineFeatures.delete(featureId);
    }
    this.trackFeatureIds.delete(id);
    for (const feature of replacement) indexFeature(feature, this.baselineFeatures, this.trackFeatureIds, this.nodeFeatures, this.lineFeatures);
    this.state = next;
    syncSelectedEdges(this.map, next);
    const selectedEdges = selectedEdgeData(next);
    this.selectedEdgeBaseline = selectedEdges;
    this.selectedEdgeSource = this.map.getSource('manual-track-selection-edge') as GeoJSONSource | undefined ?? null;
    this.selectedEdgeTrackId = next.nodeSelection?.trackId ?? null;
    this.selectedEdgeGeometry = selectedEdges.features[0]?.geometry ?? null;
    syncTrackNotes(this.map, next.saved);
    return true;
  }

  private buildTrackFeatures(track: ManualTrack, state: TrackOverlay) {
    const item = savedTrackRenderItem(track);
    const features = trackLineFeatures(item, state);
    if (trackRendersNodes(item, state)) {
      const [routeStart, routeEnd] = resolvedRouteTerminals(track);
      const positions = this.routeHandles(String(track.id), track.segments, track.nodes ?? EMPTY_NODE_COORDINATES,
        track.id === state.selectedId || !!state.connecting || (!!state.snapTargets && !track.hidden && track.source !== 'recorded' && track.samples === undefined));
      for (const terminal of [routeStart, routeEnd]) if (terminal && !positions.some((point) => equalCoordinate(point, terminal))) positions.push(terminal);
      if (state.activeNode?.trackId === track.id && !positions.some((point) => equalCoordinate(point, state.activeNode!.coordinate)) && track.segments.some((segment) => segment.some((point) => equalCoordinate(point, state.activeNode!.coordinate)))) positions.push(state.activeNode.coordinate);
      features.push(...trackNodeFeatures(item, state, positions));
    }
    assignTrackFeatureIds(features);
    return features;
  }

  private patchActiveNode(
    source: GeoJSONSource,
    previous: TrackOverlay['activeNode'],
    next: TrackOverlay['activeNode'],
  ) {
    const updates = new Map<string | number, boolean>();
    const mark = (node: TrackOverlay['activeNode'], active: boolean) => {
      if (!node) return;
      const ids = this.nodeFeatures.get(nodeKey(node.trackId, node.coordinate));
      if (!ids?.size) return;
      for (const id of ids) updates.set(id, active);
    };
    mark(previous, false);
    mark(next, true);
    // A missing new index means the full renderer may need to add a handle.
    if (next && !this.nodeFeatures.has(nodeKey(next.trackId, next.coordinate))) return false;
    if (!updates.size) return true;
    invalidateOverlayData(this.map, 'manual-tracks');
    const patch = [...updates].map(([id, active]) => {
      const feature = this.baselineFeatures.get(id);
      if (feature) feature.properties = { ...feature.properties, active };
      return { id, addOrUpdateProperties: [{ key: 'active', value: active }] };
    });
    void source.updateData({ update: patch }).catch((error) => {
      if (this.map.getSource('manual-tracks') !== source) return;
      this.restoreCanonicalBaseline(source, 'Could not restore active route node');
      console.warn('Could not patch active route node', error);
    });
    return true;
  }

  private restoreCanonicalBaseline(source: GeoJSONSource, warning: string) {
    invalidateOverlayData(this.map, 'manual-tracks');
    void source.setData({ type: 'FeatureCollection', features: [...this.baselineFeatures.values()] })
      .then(() => {
        if (this.map.getSource('manual-tracks') !== source) return;
        // setData replaces preview-mutated source data with canonical data.
        // Reapply whichever preview is current when the restore completes.
        const currentPreview = this.activePreview;
        if (currentPreview) this.preview(currentPreview, false);
      })
      .catch((error) => console.warn(warning, error));
  }

  /** Update only the currently dragged node's line and point features. */
  preview(preview: TrackOverlay['preview'], retryAfterRestore = true) {
    const revision = ++this.previewRevision;
    const source = this.map.getSource('manual-tracks') as GeoJSONSource | undefined;
    if (!source || source !== this.baselineSource || typeof source.updateData !== 'function') {
      this.activePreview = null;
      return;
    }
    const previous = this.activePreview;
    if (!previous && !preview) return;
    const targets = new Map<string, TrackOverlay['preview']>();
    if (previous) targets.set(nodeKey(previous.node.trackId, previous.node.coordinate), null);
    if (preview) targets.set(nodeKey(preview.node.trackId, preview.node.coordinate), preview);
    const updates = new Map<string | number, {
      id: string | number;
      newGeometry?: FeatureCollection['features'][number]['geometry'];
      addOrUpdateProperties?: Array<{ key: string; value: unknown }>;
    }>();
    for (const [key, current] of targets) {
      const coordinate = current?.coordinate;
      for (const id of this.lineFeatures.get(key) ?? []) {
        const feature = this.baselineFeatures.get(id);
        if (!feature || feature.geometry.type !== 'MultiLineString') continue;
        updates.set(id, {
          id,
          newGeometry: coordinate
            ? moveGeometryCoordinate(feature.geometry, current!.node.coordinate, coordinate)
            : feature.geometry,
        });
      }
      for (const id of this.nodeFeatures.get(key) ?? []) {
        const feature = this.baselineFeatures.get(id);
        if (!feature || feature.geometry.type !== 'Point') continue;
        const point = coordinate
          ? moveCoordinate(feature.geometry.coordinates as Coordinate, current!.node.coordinate, coordinate)
          : feature.geometry.coordinates as Coordinate;
        updates.set(id, {
          id,
          newGeometry: { type: 'Point', coordinates: point },
          addOrUpdateProperties: [
            { key: 'lng', value: point[0] },
            { key: 'lat', value: point[1] },
          ],
        });
      }
    }
    this.activePreview = preview;
    if (updates.size) {
      void source.updateData({ update: [...updates.values()] }).catch(() => {
        if (this.map.getSource('manual-tracks') !== source) return;
        if (revision === this.previewRevision) this.activePreview = null;
        if (!retryAfterRestore) return;
        this.restoreCanonicalBaseline(source, 'Could not restore route preview baseline');
        const edgeSource = this.map.getSource('manual-track-selection-edge') as GeoJSONSource | undefined;
        if (edgeSource && edgeSource === this.selectedEdgeSource && this.selectedEdgeBaseline) {
          void edgeSource.setData(this.selectedEdgeBaseline)
            .catch((error) => console.warn('Could not restore selected-edge preview baseline', error));
        }
      });
    }
    this.previewSelectedEdge(preview, revision);
  }

  private previewSelectedEdge(preview: TrackOverlay['preview'], revision: number) {
    const trackId = this.selectedEdgeTrackId,
      source = this.map.getSource('manual-track-selection-edge') as GeoJSONSource | undefined;
    if (
      !trackId ||
      !source ||
      source !== this.selectedEdgeSource ||
      !this.selectedEdgeGeometry ||
      this.selectedEdgeGeometry.type !== 'MultiLineString' ||
      typeof source.updateData !== 'function'
    ) return;
    const node = preview?.node.trackId === trackId ? preview.node : null;
    const baseCoordinates = this.selectedEdgeGeometry.coordinates as Coordinate[][];
    const containsNode = node && baseCoordinates.some((line) => line.some((point) => equalCoordinate(point as Coordinate, node.coordinate)));
    const geometry = containsNode
      ? moveGeometryCoordinate(this.selectedEdgeGeometry as Extract<FeatureCollection['features'][number]['geometry'], { type: 'MultiLineString' }>, node!.coordinate, preview!.coordinate)
      : this.selectedEdgeGeometry;
    void source.updateData({
      update: [{ id: 'manual-track-selected-edge', newGeometry: geometry }],
    }).catch(() => {
      if (revision !== this.previewRevision || this.map.getSource('manual-track-selection-edge') !== source) return;
      if (this.selectedEdgeBaseline) {
        void source.setData(this.selectedEdgeBaseline)
          .catch((error) => console.warn('Could not restore selected-edge preview baseline', error));
      }
    });
  }
}

function nodeKey(trackId: string, coordinate: Coordinate) {
  return `${trackId}\u0000${coordinate[0]}\u0000${coordinate[1]}`;
}

function sameTrackNode(a: TrackOverlay['activeNode'], b: TrackOverlay['activeNode']) {
  return a === b || (!!a && !!b && a.trackId === b.trackId && equalCoordinate(a.coordinate, b.coordinate));
}

function sameDraft(a: Coordinate[][], b: Coordinate[][]) {
  return a === b || (a.length === 0 && b.length === 0);
}

function addIndexed(index: Map<string, Set<string | number>>, key: string, id: string | number) {
  let ids = index.get(key);
  if (!ids) index.set(key, (ids = new Set()));
  ids.add(id);
}

function removeIndexed(index: Map<string, Set<string | number>>, key: string, id: string | number) {
  const ids = index.get(key);
  if (!ids) return;
  ids.delete(id);
  if (!ids.size) index.delete(key);
}

function assignTrackFeatureIds(features: FeatureCollection['features']) {
  const ordinals = new Map<string, number>();
  for (const feature of features) {
    const trackId = String(feature.properties?.trackId ?? 'unknown');
    const kind = feature.geometry.type === 'Point' ? 'node' : 'line';
    const key = `${trackId}\u0000${kind}`;
    const ordinal = ordinals.get(key) ?? 0;
    ordinals.set(key, ordinal + 1);
    feature.id = `manual-track:${encodeURIComponent(trackId)}:${kind}:${ordinal}`;
  }
}

function indexFeature(
  feature: FeatureCollection['features'][number],
  baseline: Map<string | number, FeatureCollection['features'][number]>,
  tracks: Map<string, Set<string | number>>,
  nodes: Map<string, Set<string | number>>,
  lines: Map<string, Set<string | number>>,
) {
  const id = feature.id;
  const trackId = String(feature.properties?.trackId ?? 'unknown');
  if (id === undefined) return;
  baseline.set(id, feature);
  addIndexed(tracks, trackId, id);
  if (feature.geometry.type === 'Point') {
    const p = feature.properties ?? {};
    addIndexed(nodes, nodeKey(trackId, [Number(p.nodeLng ?? p.lng), Number(p.nodeLat ?? p.lat)]), id);
  } else if (feature.geometry.type === 'MultiLineString') {
    for (const line of feature.geometry.coordinates) for (const point of line) addIndexed(lines, nodeKey(trackId, point as Coordinate), id);
  }
}

function unindexFeature(
  feature: FeatureCollection['features'][number],
  nodes: Map<string, Set<string | number>>,
  lines: Map<string, Set<string | number>>,
) {
  const id = feature.id;
  const trackId = String(feature.properties?.trackId ?? 'unknown');
  if (id === undefined) return;
  if (feature.geometry.type === 'Point') {
    const p = feature.properties ?? {};
    removeIndexed(nodes, nodeKey(trackId, [Number(p.nodeLng ?? p.lng), Number(p.nodeLat ?? p.lat)]), id);
  } else if (feature.geometry.type === 'MultiLineString') {
    for (const line of feature.geometry.coordinates) for (const point of line) removeIndexed(lines, nodeKey(trackId, point as Coordinate), id);
  }
}

function moveCoordinate(from: Coordinate, source: Coordinate, target: Coordinate): Coordinate {
  return equalCoordinate(from, source)
    ? [target[0], target[1]]
    : from;
}

function moveGeometryCoordinate(
  geometry: Extract<FeatureCollection['features'][number]['geometry'], { type: 'MultiLineString' }>,
  source: Coordinate,
  target: Coordinate,
) {
  return {
    type: 'MultiLineString' as const,
    coordinates: geometry.coordinates.map((line) => line.map((point) => moveCoordinate(point as Coordinate, source, target))),
  };
}
