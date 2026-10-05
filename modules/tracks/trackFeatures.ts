import type { FeatureCollection } from 'geojson';
import type { ManualTrack } from './drawing';
import type { TrackEdgeColors } from './edgeColors';
import { coloredLineParts, edgeColorIndex } from './edgeColors';
import { alternativeLineParts } from './alternatives';
import { metricLineParts } from '../routeAnalysis/metrics';
import { displayedNodeColors } from './displayColors';
import { resolvedRouteTerminals } from './routeTerminals';
import { normalizeTrackStyle, type TrackStyle } from './style';
import { DRAFT_ID, equalCoordinate } from './editing';
import type { Coordinate } from '../navigation/types';
import type { TrackOverlay } from './TrackLayer';

export type TrackRenderItem = {
  track: ManualTrack;
  draft: boolean;
  style: TrackStyle;
  edgeColors?: TrackEdgeColors;
  samples?: ManualTrack['samples'];
};

const lineFeatureCache = new WeakMap<ManualTrack, {
  style: string;
  edgeColors: TrackRenderItem['edgeColors'];
  samples: TrackRenderItem['samples'];
  analysis: TrackOverlay['analysisParts'];
  selected: boolean;
  editing: boolean;
  alternativeId: string | undefined;
  draft: boolean;
  features: FeatureCollection['features'];
}>();
// Each map owns its feature/property wrappers; geometry comes from an immutable
// route snapshot just like the original route coordinates.
const copyLineFeatures = (features: FeatureCollection['features']) => features.map(feature => ({
  ...feature, properties: { ...feature.properties }, geometry: { ...feature.geometry },
}));

export function savedTrackRenderItem(track: ManualTrack): TrackRenderItem {
  return { track, draft: false, style: normalizeTrackStyle(track.style), edgeColors: track.edgeColors, samples: track.samples };
}

export function draftTrackRenderItem(state: TrackOverlay): TrackRenderItem {
  return {
    track: {
      id: DRAFT_ID,
      name: '',
      createdAt: 0,
      segments: state.draft,
      nodes: state.nodes,
      style: state.style,
      edgeColors: state.draftEdgeColors,
    },
    draft: true,
    style: normalizeTrackStyle(state.style),
    edgeColors: state.draftEdgeColors,
  };
}

export function trackLineFeatures(item: TrackRenderItem, state: TrackOverlay): FeatureCollection['features'] {
  const { track, style } = item;
  if (!track.segments.length) return [];
  const selected = track.id === state.selectedId;
  const editing = !!state.editing && selected;
  const alternativeId = selected ? state.alternativeId : 'main';
  const analysis = state.analysisParts?.trackId === track.id ? state.analysisParts : undefined;
  const styleKey = JSON.stringify(style);
  const cached = lineFeatureCache.get(track);
  if (cached && cached.style === styleKey && cached.edgeColors === item.edgeColors &&
      cached.samples === item.samples && cached.analysis === analysis && cached.selected === selected &&
      cached.editing === editing && cached.alternativeId === alternativeId && cached.draft === item.draft)
    return copyLineFeatures(cached.features);
  const colors = item.edgeColors
    ? edgeColorIndex({ segments: track.segments, edgeColors: item.edgeColors })
    : new Map();
  const metricTrack = { ...track, style, edgeColors: item.edgeColors, samples: item.samples };
  const analysisParts = state.analysisParts?.trackId === track.id &&
    (!state.analysisParts.sourceSegments || state.analysisParts.sourceSegments === track.segments)
    ? state.analysisParts.parts
    : undefined;
  const parts: ReturnType<typeof metricLineParts> = analysisParts
    ? analysisParts
    : style.colorMode && style.colorMode !== 'solid'
      ? metricLineParts(metricTrack, style.colorMode)
      : alternativeLineParts(
          track.segments,
          track.id === state.selectedId ? state.alternativeId : 'main',
          style.color,
        ).flatMap((part) =>
          coloredLineParts(part.coordinates, colors, part.color ?? style.color)
            .map((piece) => ({ ...part, ...piece })),
        );
  // During editing a node drag patches only its neighbouring chunks. Keep every
  // original edge, including the shared boundary vertex, without simplification.
  const renderParts = state.editing && track.id === state.selectedId
    ? parts.flatMap(part => {
        // Translucent round caps overlap at a split vertex. Keep their original
        // feature to preserve opacity rather than introducing darker joints.
        if ((style.opacity ?? 1) < 1 || part.muted) return [part];
        const chunks = [];
        for (let start = 0; start < part.coordinates.length - 1; start += 127)
          chunks.push({ ...part, coordinates: part.coordinates.slice(start, start + 128) });
        return chunks;
      })
    : parts;
  const features = renderParts.map((part) => ({
    type: 'Feature' as const,
    properties: {
      trackId: track.id,
      selected: track.id === state.selectedId,
      draft: item.draft,
      ...style,
      color: part.color ?? style.color,
      opacity: (style.opacity ?? 1) * (part.muted ? 0.3 : 1),
    },
    geometry: {
      type: 'MultiLineString' as const,
      coordinates: [part.coordinates].filter((line) => line.length >= 2),
    },
  })).filter((feature) => feature.geometry.type === 'MultiLineString' && feature.geometry.coordinates.length > 0);
  lineFeatureCache.set(track, { style: styleKey, edgeColors: item.edgeColors, samples: item.samples,
    analysis, selected, editing, alternativeId, draft: item.draft, features });
  return copyLineFeatures(features);
}

export function trackNodeFeatures(
  item: TrackRenderItem,
  state: TrackOverlay,
  positions: Coordinate[],
): FeatureCollection['features'] {
  const { track, style } = item;
  const nodeColors = displayedNodeColors({ ...track, style, edgeColors: item.edgeColors });
  const selected = track.id === state.selectedId;
  const [routeStart, routeEnd] = resolvedRouteTerminals(track);
  return positions.map((point) => ({
    type: 'Feature' as const,
    properties: {
      color: nodeColors.get(point.join(',')) ?? style.color,
      pointSize: style.pointSize ?? 8,
      selected,
      active: state.activeNode?.trackId === track.id && equalCoordinate(point, state.activeNode.coordinate),
      trackId: track.id,
      ...(selected && ((routeStart && equalCoordinate(point, routeStart)) || (routeEnd && equalCoordinate(point, routeEnd)))
        ? {
            endpointLabel: routeStart && equalCoordinate(point, routeStart)
              ? track.sharedRoute?.stops[0]?.name ? `起点 · ${track.sharedRoute.stops[0].name}` : '起点'
              : track.sharedRoute?.stops.at(-1)?.name ? `终点 · ${track.sharedRoute.stops.at(-1)!.name}` : '终点',
          }
        : {}),
      lng: point[0],
      lat: point[1],
      nodeLng: point[0],
      nodeLat: point[1],
    },
    geometry: { type: 'Point' as const, coordinates: point },
  }));
}

export function trackRendersNodes(item: TrackRenderItem, state: TrackOverlay) {
  const track = item.track;
  const snapTarget = state.snapTargets && track.id !== DRAFT_ID && !track.hidden && track.source !== 'recorded' && track.samples === undefined;
  return state.visible && state.editing !== false &&
    (state.editing === undefined || track.id === state.selectedId || !!state.connecting || !!snapTarget);
}
