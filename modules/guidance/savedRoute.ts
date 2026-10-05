import { resolvedRouteTerminals, routeHasFork, type ManualTrack } from '../tracks/drawing.ts';
import { routeForkNodes } from '../tracks/routeTerminals.ts';
import { hasLoosePoints, joinSegments } from '../tracks/snapping.ts';
import {
  coordinate,
  type Coordinate,
  type TravelMode,
} from '../navigation/types.ts';
import type { RouteFavorite } from '../navigation/favorites';
import { pathOf, project } from './geometry.ts';
import { connectedNetwork, networkPath } from './network.ts';
import { trackAlternatives } from '../tracks/alternatives.ts';
import { preferredPath } from './preferredPath.ts';
import { routeGap, type RouteGap } from '../tracks/routeInfo.ts';
import { connectTrackGaps, trackConnectionSegments, type TrackConnection } from './trackConnections.ts';

export class RouteEndpointRequiredError extends Error {
  readonly target: Coordinate;
  readonly targetKind: 'fork' | 'candidate';
  constructor(target: Coordinate, targetKind: 'fork' | 'candidate') {
    super('分叉终点未指定，请在线路编辑中点选一个节点并设为终点。');
    this.name = 'RouteEndpointRequiredError';
    this.target = target;
    this.targetKind = targetKind;
  }
}

export class RouteDisconnectedError extends Error {
  readonly gap: RouteGap | null;
  constructor(gap: RouteGap | null) {
    super('轨迹含不相接的线段，请先连接成连续路线再导航。');
    this.name = 'RouteDisconnectedError';
    this.gap = gap;
  }
}

/** Adapt saved geometry without requesting a replacement road route or editing the archive. */
export function trackNavigation(
  track: ManualTrack,
  now = Date.now(),
  mode: TravelMode = track.navigationMode ?? 'pedestrian',
  tracks: ManualTrack[] = [],
  alternativeId = 'main',
  reversed = false,
  allowGapConnections = false,
): RouteFavorite {
  if (!track.segments.every((line) => line.every(coordinate)))
    throw new Error('轨迹坐标无效，无法导航。');
  const lines = joinSegments(track.segments);
  const gap = routeGap(track);
  if ((!lines.length && !gap) || (!allowGapConnections && hasLoosePoints(track.segments) && gap))
    throw new RouteDisconnectedError(gap);
  let trackNetwork: ReturnType<typeof connectedNetwork>;
  let connections: TrackConnection[] = [];
  try {
    trackNetwork = connectedNetwork({ ...track, segments: allowGapConnections ? [...lines, ...track.segments.filter(line => line.length === 1)] : lines }, tracks);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('不相接的线段')) throw error;
    if (!allowGapConnections) throw new RouteDisconnectedError(routeGap(track));
    const connected = connectTrackGaps(track.segments);
    connections = connected.connections;
    trackNetwork = connectedNetwork({ ...track, segments: connected.segments }, tracks);
  }
  const variants = trackAlternatives(
    lines.length === 1 ? lines : track.segments,
  );
  const preferred = (
    variants.find((v) => v.id === alternativeId) ?? variants[0]
  )?.coordinates;
  const defaultPath = connections.length
    ? networkPath(trackNetwork, track.segments.find(line => line.length)![0], track.segments.filter(line => line.length).at(-1)!.at(-1)!).coordinates
    : (
    preferred?.length
      ? preferred
      : lines.length === 1
        ? lines[0]
        : networkPath(trackNetwork, lines[0][0], lines[0].at(-1)!).coordinates
  );
  const [chosenStart, chosenEnd] = resolvedRouteTerminals(track);
  // Newly edited tracks carry explicit terminal metadata. If their end was
  // removed, require another choice instead of promoting a branch tip.
  if (!chosenEnd && (track.routeTerminals || routeHasFork(track.segments))) {
    const forks = routeForkNodes(track.segments);
    if (forks.length) throw new RouteEndpointRequiredError(forks[0], 'fork');
    // The absent value is the original route end even when navigation runs in reverse.
    const candidate = track.segments.at(-1)?.at(-1);
    if (candidate) throw new RouteEndpointRequiredError(candidate, 'candidate');
    throw new Error('分叉终点未指定，请在线路编辑中点选一个节点并设为终点。');
  }
  const coordinates = (track.routeTerminals && chosenEnd
    ? preferredPath(trackNetwork, defaultPath, reversed ? chosenEnd : chosenStart ?? defaultPath[0], reversed ? chosenStart ?? defaultPath[0] : chosenEnd)
    : reversed ? defaultPath.slice().reverse() : defaultPath
  ).map((p) => [...p] as Coordinate);
  const distance = pathOf(coordinates).length;
  if (distance < 20) throw new Error('轨迹不足20米，请延长后再导航。');
  const stops = track.routeTerminals ? undefined : track.sharedRoute?.stops ? (reversed ? [...track.sharedRoute.stops].reverse() : track.sharedRoute.stops) : undefined;
  const start = stops?.[0] ?? {
    name: `${track.name} · 起点`,
    coordinates: coordinates[0],
  };
  const end = stops?.at(-1) ?? {
    name: `${track.name} · 终点`,
    coordinates: coordinates.at(-1)!,
  };
  let floor = 0;
  const routeStops = stops ?? [start, end],
    path = pathOf(coordinates);
  const snapped = routeStops.map((s, i) => {
    if (i === 0) return coordinates[0];
    if (i === routeStops.length - 1) return coordinates.at(-1)!;
    const p = project(path, s.coordinates, floor);
    floor = p.distance;
    return p.point;
  });
  return {
    id: track.id,
    name: track.name,
    savedAt: now,
    start,
    end,
    route: {
      mode,
      geometryKind: 'track',
      displayOpacity: track.style?.opacity,
      ...(connections.length ? { trackConnections: connections, segments: trackConnectionSegments(coordinates, connections) } : {}),
      trackNetwork,
      preferredTrackPath: coordinates,
      coordinates,
      distance,
      duration:
        distance /
        ({ pedestrian: 4000, bicycle: 15000, auto: 40000 }[mode] / 3600),
      steps: [],
      snapped,
      stops: routeStops,
      createdAt: now,
    },
  };
}
