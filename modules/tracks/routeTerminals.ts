import { coordinate, type Coordinate } from '../navigation/types.ts';
import type { ManualTrack } from './drawing.ts';
import { equalCoordinate } from './editing.ts';

export type RouteTerminals = { start?: Coordinate; end?: Coordinate };

const contains = (segments: Coordinate[][], point: Coordinate) =>
  segments.some(line => line.some(vertex => equalCoordinate(vertex, point)));

function neighboursOf(segments: Coordinate[][]) {
  const neighbours=new Map<string,Set<string>>();
  for(const line of segments) for(let i=1;i<line.length;i++) {
    const a=line[i-1].join(','),b=line[i].join(','); if(a===b)continue;
    if(!neighbours.has(a))neighbours.set(a,new Set());
    if(!neighbours.has(b))neighbours.set(b,new Set());
    neighbours.get(a)!.add(b);neighbours.get(b)!.add(a);
  }
  return neighbours;
}

export function routeHasFork(segments:Coordinate[][]) {
  return [...neighboursOf(segments).values()].some(set=>set.size>2);
}

/** Stored manual choices take precedence. Older paths keep their familiar ends unless they branch. */
export function resolvedRouteTerminals(track: Pick<ManualTrack,'segments'|'routeTerminals'|'sharedRoute'>): [Coordinate | null, Coordinate | null] {
  const {segments,routeTerminals,sharedRoute}=track;
  const existing = (point: Coordinate | undefined) => point && contains(segments,point) ? point : null;
  if(routeTerminals) return [existing(routeTerminals.start),existing(routeTerminals.end)];
  const planned=sharedRoute?.stops;
  // Planner stops may retain sub-metre precision or lie just off a snapped road.
  if(planned?.length) return [planned[0].coordinates,planned.length > 1 ? planned.at(-1)!.coordinates : null];
  const neighbours=neighboursOf(segments);
  const first=segments[0]?.[0],last=segments.at(-1)?.at(-1);
  const terminal=(point:Coordinate|undefined)=>point && neighbours.get(point.join(','))?.size===1 ? point : null;
  return [terminal(first),[...neighbours.values()].some(set=>set.size>2) ? null : terminal(last)];
}

export function validRouteTerminals(value:unknown,segments:Coordinate[][]):value is RouteTerminals {
  if(!value || typeof value!=='object' || Array.isArray(value))return false;
  const entry=value as Record<string,unknown>;
  if(Object.keys(entry).some(key=>key!=='start' && key!=='end'))return false;
  return ['start','end'].every(key=>entry[key]===undefined || coordinate(entry[key]) && contains(segments,entry[key] as Coordinate));
}
