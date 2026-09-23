import type { Coordinate } from '../navigation/types.ts';
import { trackAlternatives } from './alternatives.ts';

/** Array boundaries are not route ends: a joined vertex or branch junction must never say end. */
export function routeEndpoints(segments: Coordinate[][]): [Coordinate | null, Coordinate | null] {
  const neighbours = new Map<string, Set<string>>();
  for (const line of segments) for (let i = 1; i < line.length; i++) {
    const a = line[i - 1].join(','), b = line[i].join(',');
    if (a === b) continue;
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    if (!neighbours.has(b)) neighbours.set(b, new Set());
    neighbours.get(a)!.add(b); neighbours.get(b)!.add(a);
  }
  const main = trackAlternatives(segments)[0]?.coordinates ?? [];
  const terminal = (p?: Coordinate) => p && neighbours.get(p.join(','))?.size === 1 ? p : null;
  return [terminal(main[0]), terminal(main.at(-1))];
}
