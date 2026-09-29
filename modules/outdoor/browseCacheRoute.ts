import {
  pruneBrowseCache,
  setBrowseCachePriority,
  setBrowseCacheWritePolicy,
  type BrowseTile,
} from './browseCache.ts';
import { makeRouteTilePriority } from './routeCachePolicy.ts';
import { readBrowseCacheSettings } from './browseCachePreferences.ts';
import { parseSavedTracks, TRACK_STORAGE, type ManualTrack } from '../tracks/drawing.ts';

export const CACHE_ROUTE_CHANGED = 'shantu:cache-route';
export type CacheRoute = Pick<ManualTrack, 'id' | 'segments'>;
export type RouteSegments = readonly (readonly (readonly number[])[])[];
type RouteState = { saved: Map<string, RouteSegments>; draft?: RouteSegments };
type Priority = (tile:BrowseTile)=>boolean;

let routes:RouteState={saved:new Map()};
let previous: RouteState | undefined;
let latestRetentionPriority:Priority=()=>false;
const priorityCache=new WeakMap<object,Map<number,Priority>>();

// Until storage has been read and routes supplied, a tile write is never eligible.
setBrowseCachePriority(() => false);
setBrowseCacheWritePolicy(() => false);

export function cacheRoutePoints() {
  const lines=[...([...routes.saved.values()].flatMap(value=>value)),...(routes.draft??[])];
  const result:(readonly number[])[]=[];
  for(const line of lines){if(result.length)result.push([NaN,NaN]);for(const point of line)result.push(point);}
  return result;
}

function hasPoints(segments:RouteSegments) { return segments.some(line => line.length > 0); }
function routePriority(segments:RouteSegments,bufferKm:number):Priority {
  const key=segments as object;
  let byBuffer=priorityCache.get(key);
  if(!byBuffer){byBuffer=new Map();priorityCache.set(key,byBuffer);}
  let cached=byBuffer.get(bufferKm);
  if(cached)return cached;
  const result:(readonly number[])[]=[];
  for(const line of segments){if(result.length)result.push([NaN,NaN]);for(const point of line)result.push(point);}
  cached=makeRouteTilePriority(result,bufferKm);
  byBuffer.set(bufferKm,cached);
  return cached;
}
function combinePriority(predicates:readonly Priority[]):Priority {
  return tile=>!!tile&&predicates.some(predicate=>predicate(tile));
}
function sameSaved(a:Map<string,RouteSegments>,b:Map<string,RouteSegments>) {
  return a.size===b.size&&[...a].every(([id,segments])=>b.get(id)===segments);
}
function settingsBuffer() {
  try { return readBrowseCacheSettings().bufferKm; } catch { return 1; }
}
function fireChanged() {
  if(typeof window!=='undefined')window.dispatchEvent(new Event(CACHE_ROUTE_CHANGED));
}

/** Synchronizes passive cache eligibility across every saved route and the current draft. */
export function syncBrowseCacheRoutes(saved:readonly CacheRoute[],draft:RouteSegments) {
  const bufferKm=settingsBuffer();
  const nextSaved=new Map(saved.map(track=>[track.id,track.segments]));
  const nextDraft=hasPoints(draft)?draft:undefined;
  const retentionParts=[...saved.map(track=>routePriority(track.segments,2)),...(nextDraft?[routePriority(nextDraft,2)]:[])];
  const activeParts=[...saved.map(track=>routePriority(track.segments,bufferKm)),...(nextDraft?[routePriority(nextDraft,bufferKm)]:[])];
  const nextPriority=combinePriority(activeParts);
  const nextRetentionPriority=combinePriority(retentionParts);
  const identical=previous&&sameSaved(previous.saved,nextSaved)&&previous.draft===nextDraft;
  routes={saved:nextSaved,draft:nextDraft};
  latestRetentionPriority=nextRetentionPriority;
  setBrowseCachePriority(nextPriority);
  setBrowseCacheWritePolicy((tile?:BrowseTile)=>{
    try { return !!tile&&readBrowseCacheSettings().enabled&&nextPriority(tile); }
    catch { return false; }
  });

  const removed:RouteSegments[]=[];
  if(previous&&!identical){
    for(const [id,segments] of previous.saved)if(!nextSaved.has(id))removed.push(segments);
    if(previous.draft&&!nextDraft)removed.push(previous.draft);
  }
  if(previous&&removed.length){
    const removedPredicates=removed.map(segments=>routePriority(segments,2));
    const removedPriority=combinePriority(removedPredicates);
    // Resolve overlap at execution time so a newly added route protects its tiles.
    void pruneBrowseCache((tile?:BrowseTile)=>!!tile&&removedPriority(tile)&&!latestRetentionPriority(tile)).catch(()=>undefined);
  }
  previous={saved:nextSaved,draft:nextDraft};
  fireChanged();
}

/** Reads the persisted archive without treating storage or parse failures as an empty archive. */
export function persistedCacheRoutes(storage?:Pick<Storage,'getItem'>):{ok:true;tracks:ManualTrack[]}|{ok:false} {
  try {
    const source=storage??(typeof localStorage!=='undefined'?localStorage:undefined);
    if(!source)return {ok:false};
    return {ok:true,tracks:parseSavedTracks(source.getItem(TRACK_STORAGE))};
  } catch { return {ok:false}; }
}
