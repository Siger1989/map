import type { Feature, FeatureCollection, Position } from 'geojson';
import type { TerrainMapProps } from '../TerrainMap';
import { draftTrackRenderItem, savedTrackRenderItem, trackLineFeatures, trackNodeFeatures, trackRendersNodes } from '../../tracks/trackFeatures.ts';
import { trackNoteFeatures } from '../../tracks/trackNotes.ts';
import { selectedEdgeData } from '../../tracks/selectedEdgeLayer.ts';
import { moveSegmentsNode } from '../../tracks/editing.ts';
import { createNavigationCueData } from '../../guidance/navigationCueGeometry.ts';
import type { TrackOverlay } from '../../tracks/TrackLayer';
import { createNativeRouteGeometry } from './routes.ts';
import { trackOutlineFeature } from './overlayStyle.ts';

type Properties = Record<string, unknown>;
export type NativeSceneGeometry = { routes: FeatureCollection; tracks: FeatureCollection; guidance: FeatureCollection };
const feature = (geometry: Feature['geometry'], properties: Properties): Feature => ({ type: 'Feature', geometry, properties });

/** Reuse the original geometry/color/notes algorithms; the native side only draws their result. */
export function createNativeSceneGeometry(props: Pick<TerrainMapProps, 'trackOverlay' | 'guidanceOverlay' | 'navigationCues' | 'routeOverlay' | 'position' | 'positionNavigating'>): NativeSceneGeometry {
  const state = props.trackOverlay;
  const tracks: Feature[] = [];
  if (state.visible) {
    const items = [...state.saved.filter(t => !t.hidden).map(savedTrackRenderItem), draftTrackRenderItem(state)];
    for (let item of items) {
      if (state.preview?.node.trackId === item.track.id) item = { ...item, track: { ...item.track,
        segments: moveSegmentsNode(item.track.segments, state.preview.node.coordinate, state.preview.coordinate) } };
      const lines = trackLineFeatures(item, state);
      tracks.push(...lines.map(f => {
        const halo = trackOutlineFeature(f);
        return { ...halo, properties: { ...halo.properties, nativePick: { kind: 'track', trackId: item.track.id } } };
      }));
      tracks.push(...lines.map(f => ({ ...f, properties: { ...f.properties,
        nativePick: { kind: 'track', trackId: item.track.id }, role: 'track' } })));
      if (trackRendersNodes(item, state)) {
        const positions = uniqueCoordinates(item.track.nodes?.length ? item.track.nodes.map(point =>
          state.preview?.node.trackId === item.track.id && point[0] === state.preview.node.coordinate[0] && point[1] === state.preview.node.coordinate[1]
            ? state.preview.coordinate : point) : item.track.segments.flat());
        tracks.push(...trackNodeFeatures(item, state, positions).map(f => ({ ...f, properties: { ...f.properties,
          nativePick: { kind: 'trackNode', trackId: item.track.id, coordinate: f.geometry.type === 'Point' ? f.geometry.coordinates : undefined },
          role: 'trackNode', label: f.properties?.endpointLabel } })));
      }
    }
    const noteTracks = items.map(item => item.track);
    tracks.push(...trackNoteFeatures(noteTracks).features.map(f => ({ ...f, properties: { ...f.properties,
      role: 'note', label: f.properties?.note, color: '#fff4cd', minZoom: 10,
      nativePick: { kind: 'track', trackId: f.properties?.trackId } } })));
    tracks.push(...selectedEdgeData(state).features.map(f => ({ ...f, properties: { ...f.properties,
      role: 'selectedEdge', color: '#fff3a0', nativePick: { kind: 'track', trackId: state.nodeSelection?.trackId } } })));
    for (const warning of state.analysisMarkers ?? []) tracks.push(feature({ type: 'Point', coordinates: warning.coordinate },
      { role: 'warning', color: '#d84240', pointSize: 10, label: warning.label }));
    if (state.linePoint) tracks.push(feature({ type: 'Point', coordinates: state.linePoint.coordinate },
      { role: 'linePoint', color: '#fff3a0', pointSize: 12 }));
  }
  const guidance: Feature[] = [];
  if (props.guidanceOverlay) {
    const overlay = props.guidanceOverlay;
    for (const segment of overlay.segments ?? [{ kind: 'road', coordinates: overlay.coordinates }])
      guidance.push(feature({ type: 'LineString', coordinates: segment.coordinates },
        { role: 'guidance', color: segment.kind === 'access' ? '#ffcb65' : '#ffb052', width: segment.kind === 'access' ? 4 : 5, dash: [3, 2] }));
    guidance.push(feature({ type: 'Point', coordinates: overlay.target }, { role: 'guidanceTarget', color: '#ffb052', pointSize: 14 }));
  }
  const cues = createNavigationCueData(props.navigationCues ?? null).data;
  for (const cue of cues.features) {
    const p = cue.properties;
    if (p.role === 'ribbon' && (props.navigationCues?.kind !== 'route' || props.navigationCues.cameraMode === 'top')) continue;
    const color = p.role === 'offset-reference' ? '#ffd34f' : p.role === 'ribbon' ? '#39c878' : p.kind === 'rejoin' ? '#ffd08a' : '#ffffff';
    guidance.push({ ...cue, properties: { ...p, minZoom: 14, color,
      width: p.closeView ? 14 : 4, opacity: p.role === 'route-projection' ? 0.25 : 0.98,
      pointSize: p.role === 'lead' ? 24 : p.role === 'route-projection' ? 10 : 16,
      arrow: ['chevron', 'rejoin', 'lead'].includes(p.role), rotation: p.bearing,
    } });
  }
  const routes = createNativeRouteGeometry(props.routeOverlay ?? { route: null, start: null, end: null },
    props.positionNavigating ? props.position?.coordinates ?? null : null);
  return { routes, tracks: { type: 'FeatureCollection', features: tracks }, guidance: { type: 'FeatureCollection', features: guidance } };
}

function uniqueCoordinates(points: Position[]): [number, number][] {
  const seen = new Set<string>();
  return points.filter(p => { const key = p.join(','); if (seen.has(key)) return false; seen.add(key); return true; }) as [number, number][];
}
