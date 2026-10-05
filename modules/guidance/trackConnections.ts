import { coordinate, metresBetween, type Coordinate, type PlannedRoute, type RoutePlace, type TravelMode } from '../navigation/types.ts';
import { routeGap } from '../tracks/routeInfo.ts';
import { pathOf, project } from './geometry.ts';

export type TrackConnection = { coordinates: Coordinate[]; routing: 'direct' | 'road' };
const key = (p: Coordinate) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
const edgeKey = (a: Coordinate, b: Coordinate) => [key(a), key(b)].sort().join('|');

/** A navigation-only spanning connection. Never edits the archived strokes. */
export function connectTrackGaps(lines: Coordinate[][]) {
  const segments = lines.filter(line => line.length).map(line => line.map(p => [...p] as Coordinate));
  const connections: TrackConnection[] = [];
  let gap = routeGap({ segments });
  while (gap) {
    if (connections.length >= 64) throw new Error('断开路段过多，请分段导航或先整理路线。');
    const coordinates = [gap.from, gap.to];
    connections.push({ coordinates, routing: 'direct' });
    segments.push(coordinates);
    gap = routeGap({ segments });
  }
  return { segments, connections };
}

/** Classify the current direction/path, including a nearest-entry partial edge. */
export function trackConnectionSegments(coordinates: Coordinate[], connections: TrackConnection[]) {
  const edges = new Set(connections.flatMap(c => c.coordinates.slice(1).map((p, i) => edgeKey(c.coordinates[i], p))));
  const paths = connections.map(c => pathOf(c.coordinates));
  const segments: NonNullable<PlannedRoute['segments']> = [];
  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1], b = coordinates[i];
    const partial = (i === 1 || i === coordinates.length - 1) && paths.some(path =>
      project(path, a).offset < 0.1 && project(path, b).offset < 0.1);
    const kind = edges.has(edgeKey(a, b)) || partial ? 'access' : 'road';
    const last = segments.at(-1);
    if (last?.kind === kind) last.coordinates.push(b);
    else segments.push({ kind, coordinates: [a, b] });
  }
  return segments;
}

type Planner = (start: RoutePlace, end: RoutePlace, mode: TravelMode, signal: AbortSignal) => Promise<PlannedRoute>;
const abortError = () => new DOMException('Aborted', 'AbortError');

/** Bound all gap planning to one deadline; failed/no-road gaps remain straight and dashed. */
export async function resolveTrackConnections(route: PlannedRoute, planner: Planner, signal: AbortSignal, timeout = 6000): Promise<PlannedRoute> {
  if (!route.trackConnections?.length) return route;
  if (signal.aborted) throw abortError();
  const controller = new AbortController();
  let stop!: () => void;
  const interrupted = new Promise<null>(resolve => { stop = () => { controller.abort(); resolve(null); }; });
  signal.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, timeout);
  const connections = route.trackConnections.map(c => ({ ...c }));
  let cursor = 0;
  const worker = async () => {
    while (!controller.signal.aborted && cursor < connections.length) {
      const index = cursor++, current = connections[index];
      if (current.routing === 'road') continue;
      // Only plan missing pieces used by this itinerary, not remote unused branches.
      const selected = trackConnectionSegments(route.coordinates, [current]).find(s => s.kind === 'access');
      if (!selected) continue;
      const forward = key(selected.coordinates[0]) === key(current.coordinates[0]);
      const from = forward ? current.coordinates[0] : current.coordinates.at(-1)!, to = forward ? current.coordinates.at(-1)! : current.coordinates[0];
      try {
        const planned = await Promise.race([planner({ name: '断开起点', coordinates: from }, { name: '断开终点', coordinates: to }, route.mode, controller.signal), interrupted]);
        if (controller.signal.aborted || !planned) break;
        if (!planned.coordinates.every(coordinate) || planned.coordinates.length < 2 || planned.coordinates.length > 100000) continue;
        if (planned.segments?.length && planned.segments.every(s => s.kind === 'access')) continue;
        // Whole-trip planning allows distant road access. A missing track piece
        // needs roads near BOTH breakpoints, not a many-kilometre access detour.
        const accessLimit = Math.max(50, Math.min(300, metresBetween(from, to) / 2));
        if (planned.snapped?.length >= 2 && (metresBetween(from, planned.snapped[0]) > accessLimit || metresBetween(to, planned.snapped.at(-1)!) > accessLimit)) continue;
        // A provider can snap ends onto a road. Retain the exact track junctions.
        const points = [from, ...planned.coordinates, to].filter((p, i, all) => !i || metresBetween(p, all[i - 1]) > 0.001);
        connections[index] = { coordinates: forward ? points : points.reverse(), routing: 'road' };
      } catch { if (signal.aborted) break; }
    }
  };
  try {
    await Promise.all([worker(), worker()]);
    if (signal.aborted) throw abortError();
    const replace = (line: Coordinate[]) => {
      const result: Coordinate[] = [line[0]];
      for (let i = 1; i < line.length; i++) {
        const index = route.trackConnections!.findIndex(c => c.coordinates.length === 2 && edgeKey(c.coordinates[0], c.coordinates[1]) === edgeKey(line[i - 1], line[i]));
        const replacement = index < 0 ? null : connections[index];
        if (replacement?.routing === 'road') {
          const points = key(replacement.coordinates[0]) === key(line[i - 1]) ? replacement.coordinates : replacement.coordinates.slice().reverse();
          result.push(...points.slice(1));
        } else result.push(line[i]);
      }
      return result;
    };
    const coordinates = replace(route.coordinates), distance = pathOf(coordinates).length;
    return { ...route, coordinates, trackConnections: connections,
      trackNetwork: route.trackNetwork?.map(replace), preferredTrackPath: route.preferredTrackPath && replace(route.preferredTrackPath),
      segments: trackConnectionSegments(coordinates, connections), distance,
      duration: distance / ({ pedestrian: 4000, bicycle: 15000, auto: 40000 }[route.mode] / 3600) };
  } finally { clearTimeout(timer); signal.removeEventListener('abort', stop); controller.abort(); }
}
