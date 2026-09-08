import type { Coordinate } from '../navigation/types';
import { trackDistance } from './drawing.ts';

export type TrackAlternative = {
  id: string;
  label: string;
  color: string;
  coordinates: Coordinate[];
  detour: Coordinate[];
  distance: number;
};
const key = (p: Coordinate) => p.join(',');
export const trackEdgeKey = (a: Coordinate, b: Coordinate) =>
  [key(a), key(b)].sort().join('|');
const colors = ['#55d6ff', '#c99bff', '#ff637c', '#e7bf55'];
const cache = new WeakMap<Coordinate[][], TrackAlternative[]>();

/** Preserve the first saved route's order. A detour replaces only the interval
 * between two real shared vertices; crossings and dangling branches do not qualify. */
export function trackAlternatives(
  segments: Coordinate[][],
  primaryColor?: string,
): TrackAlternative[] {
  if (primaryColor) {
    const palette = colors.filter(
      (color) => color.toLowerCase() !== primaryColor.toLowerCase(),
    );
    return trackAlternatives(segments).map((choice, i) => ({
      ...choice,
      color: i ? palette[(i - 1) % palette.length] : primaryColor,
    }));
  }
  const cached = cache.get(segments);
  if (cached) return cached;
  const first = segments.findIndex((line) => line.length >= 2);
  if (first < 0) return [];
  let primary = [...segments[first]];
  const used = new Set([first]);
  // Older drawings may store the main route as several consecutive strokes.
  let extended = true;
  while (extended) {
    extended = false;
    const present = new Set(primary.map(key));
    for (let i = first + 1; i < segments.length; i++) {
      if (used.has(i) || segments[i].length < 2) continue;
      const line = segments[i];
      const forward = key(line[0]) === key(primary.at(-1)!);
      const reverse = key(line.at(-1)!) === key(primary.at(-1)!);
      if (!forward && !reverse) continue;
      const tail = (forward ? line : line.slice().reverse()).slice(1);
      if (tail.some((p) => present.has(key(p)))) continue;
      primary.push(...tail);
      used.add(i);
      extended = true;
      break;
    }
  }
  const choices: TrackAlternative[] = [
    {
      id: 'main',
      label: '原路',
      color: '#ffb477',
      coordinates: primary,
      detour: [],
      distance: trackDistance([primary]),
    },
  ];
  const mainIndex = new Map(primary.map((p, i) => [key(p), i]));
  const mainEdges = new Set(
    primary.slice(1).map((p, i) => trackEdgeKey(primary[i], p)),
  );
  const nodes = new Map<string, Coordinate>(),
    graph = new Map<string, Set<string>>();
  for (const line of segments)
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1],
        b = line[i];
      if (mainEdges.has(trackEdgeKey(a, b)) || key(a) === key(b)) continue;
      const ka = key(a),
        kb = key(b);
      nodes.set(ka, a);
      nodes.set(kb, b);
      if (!graph.has(ka)) graph.set(ka, new Set());
      if (!graph.has(kb)) graph.set(kb, new Set());
      graph.get(ka)!.add(kb);
      graph.get(kb)!.add(ka);
    }
  const seenPaths = new Set<string>();
  let work = 0;
  outer: for (const [start, startIndex] of mainIndex) {
    for (const neighbour of graph.get(start) ?? []) {
      const parents = new Map<string, string | null>([
        [start, null],
        [neighbour, start],
      ]);
      const queue = [neighbour];
      for (let cursor = 0; cursor < queue.length; cursor++) {
        if (++work > 100000 || choices.length >= 9) break outer;
        const current = queue[cursor],
          endIndex = mainIndex.get(current);
        if (endIndex !== undefined) {
          if (endIndex <= startIndex) continue;
          const route: string[] = [];
          let p: string | null = current;
          while (p !== null) {
            route.push(p);
            p = parents.get(p) ?? null;
          }
          route.reverse();
          const signature = route.join(';');
          if (seenPaths.has(signature)) continue;
          seenPaths.add(signature);
          const detour = route.map((p) => nodes.get(p)!);
          const coordinates = [
            ...primary.slice(0, startIndex),
            ...detour,
            ...primary.slice(endIndex + 1),
          ];
          choices.push({
            id: `detour-${choices.length}`,
            label: `备选${choices.length}`,
            color: colors[(choices.length - 1) % colors.length],
            coordinates,
            detour,
            distance: trackDistance([coordinates]),
          });
          continue;
        }
        for (const next of graph.get(current) ?? [])
          if (!parents.has(next)) {
            parents.set(next, current);
            queue.push(next);
          }
      }
    }
  }
  cache.set(segments, choices);
  return choices;
}

/** Split only when branch color or the active route changes; do not duplicate distance. */
export function alternativeLineParts(
  segments: Coordinate[][],
  activeId = 'main',
  primaryColor?: string,
) {
  const variants = trackAlternatives(segments, primaryColor);
  const active = variants.find((v) => v.id === activeId) ?? variants[0];
  const colorsByEdge = new Map<string, string>();
  for (const variant of variants.slice(1).reverse())
    variant.detour
      .slice(1)
      .forEach((p, i) =>
        colorsByEdge.set(trackEdgeKey(variant.detour[i], p), variant.color),
      );
  const activeEdges = new Set(
    active?.coordinates
      .slice(1)
      .map((p, i) => trackEdgeKey(active.coordinates[i], p)),
  );
  const parts: { coordinates: Coordinate[]; color?: string; muted: boolean }[] =
    [];
  for (const line of segments) {
    let part: (typeof parts)[number] | undefined;
    for (let i = 1; i < line.length; i++) {
      const edge = trackEdgeKey(line[i - 1], line[i]),
        color = colorsByEdge.get(edge);
      const muted = activeId !== 'main' && !activeEdges.has(edge);
      if (!part || part.color !== color || part.muted !== muted) {
        part = { coordinates: [line[i - 1], line[i]], color, muted };
        parts.push(part);
      } else part.coordinates.push(line[i]);
    }
  }
  return parts;
}
