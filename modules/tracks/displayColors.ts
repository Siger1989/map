import type { Coordinate } from '../navigation/types.ts';
import type { ManualTrack } from './drawing.ts';
import { alternativeLineParts, trackAlternatives, trackEdgeKey } from './alternatives.ts';
import { explicitNodeColors } from './selectionDetails.ts';
import { normalizeTrackStyle } from './style.ts';
type ColoredTrack = Pick<ManualTrack,'segments'|'style'|'edgeColors'|'pointDetails'>;
export function displayedEdgeColors(track: ColoredTrack) {
  const fallback=normalizeTrackStyle(track.style).color, colors=new Map<string,string>();
  for(const part of alternativeLineParts(track.segments,'main',fallback))part.coordinates.slice(1).forEach((b,i)=>colors.set(trackEdgeKey(part.coordinates[i],b),part.color ?? fallback));
  track.segments.forEach((line,i)=>line.slice(1).forEach((b,j)=>{const color=track.edgeColors?.[i]?.[j];if(color)colors.set(trackEdgeKey(line[j],b),color);}));
  return colors;
}
/** The inspector and map must resolve point color by the same precedence. */
export function displayedNodeColors(track: ColoredTrack) {
  const fallback=normalizeTrackStyle(track.style).color;
  const colors=new Map(trackAlternatives(track.segments,fallback).slice(1).reverse().flatMap(v=>v.detour.slice(1,-1).map(p=>[p.join(','),v.color] as const)));
  for(const [key,color] of explicitNodeColors(track))colors.set(key,color);
  return colors;
}
export function displayedPointColor(track: ColoredTrack, point: Coordinate) {
  return displayedNodeColors(track).get(point.join(',')) ?? normalizeTrackStyle(track.style).color;
}
export function moveSelectedPoints(points: Coordinate[], from: Coordinate, to: Coordinate) {
  const key=from.join(',');
  return points.some(p=>p.join(',')===key)
    ? [...new Map(points.map(p=>p.join(',')===key?to:p).map(p=>[p.join(','),p])).values()]
    : [to];
}
