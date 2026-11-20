import { getJourneyPlaybackFrame, type JourneyPlaybackModel } from './journeyPlayback.ts';
import { journeyDestination } from './journeyCamera.ts';
import { mercator, planSatelliteTiles, type Tile } from './satelliteTerrainGeometry.ts';
import { routeImageryFocus } from './journeyRouteOverlay.ts';

export interface JourneyTerrainBuffer {
  status: 'loading' | 'ready' | 'degraded' | 'unavailable';
  loaded: number;
  total: number;
  frameReady: boolean;
  throughDistanceM: number;
}

export function tileAt(longitude: number, latitude: number, z: number): Tile {
  const [x,y] = mercator(longitude, latitude, z).map(Math.floor);
  return {z,x,y,key:`${z}/${x}/${y}`};
}

export function ancestor(tile: Tile, z: number): Tile {
  const x = tile.x >>> (tile.z - z), y = tile.y >>> (tile.z - z);
  return {z,x,y,key:`${z}/${x}/${y}`};
}

/** A fallback tile must geographically contain the missing leaf. */
export function closestLoadedTile<T>(leaf: Tile, loaded: ReadonlyMap<string,T>, minimumZoom = 8): T | undefined {
  for (let z=leaf.z; z>=minimumZoom; z--) {
    const hit = loaded.get(z===leaf.z ? leaf.key : ancestor(leaf,z).key);
    if (hit !== undefined) return hit;
  }
}

/** Merge complete groups of four fallback quadrants before sending their parent
 * to the GPU. The height sampler keeps using the original non-overlapping leaves. */
export function mergeTerrainPatches<T extends {tile: Tile}>(patches: {leaf:Tile; mesh:T}[]) {
  const indexed=new Map(patches.map(patch=>[patch.leaf.key,patch]));
  const parents=new Map<string,Tile>();
  for (const {leaf,mesh} of patches) {
    for(let z=leaf.z-1; z>=mesh.tile.z; z--) {
      const parent=ancestor(leaf,z);
      parents.set(parent.key,parent);
    }
  }
  for(const parent of [...parents.values()].sort((a,b)=>b.z-a.z)){
    const z=parent.z+1, x=parent.x*2, y=parent.y*2;
    const keys=[`${z}/${x}/${y}`,`${z}/${x+1}/${y}`,`${z}/${x}/${y+1}`,`${z}/${x+1}/${y+1}`];
    const mesh=indexed.get(keys[0])?.mesh;
    if (!mesh || mesh.tile.z>parent.z || !keys.every(key=>indexed.get(key)?.mesh===mesh)) continue;
    for(const key of keys) indexed.delete(key);
    indexed.set(parent.key,{leaf:parent,mesh});
  }
  return [...indexed.values()];
}

export interface JourneyWindow {
  start: number;
  end: number;
  overview: Tile[];
  detail: Tile[];
  surroundings: Tile[];
  startup: Tile[];
}

const maxAhead = 9000;
const maxCorridorTiles = 82;

/** Sample actual route and camera positions. A finite GPU budget shortens the lookahead
 * at high latitudes or on fragmented routes rather than silently dropping their coverage. */
export function planJourneyWindow(model: JourneyPlaybackModel, distanceM: number): JourneyWindow {
  const start = Math.max(0, Math.min(distanceM,model.totalDistanceM));
  const limit = Math.min(start + maxAhead, model.totalDistanceM);
  const overview = new Map<string,Tile>(), detail = new Map<string,Tile>(), startup = new Map<string,Tile>();
  const forwardTerrain = new Map<string,Tile>();
  let end = start;
  const distances = new Set<number>([start,limit]);
  for (let d = start + 65; d < limit; d += 65) distances.add(d);
  let from = 0, to = model.segments.length;
  while (from < to) {
    const mid = (from + to) >>> 1;
    if (model.segments[mid].endDistanceM < start) from = mid + 1;
    else to = mid;
  }
  for (let i = from; i < model.segments.length; i++) {
    const segment = model.segments[i];
    if (segment.startDistanceM > limit) break;
    if (segment.startDistanceM > start && segment.startDistanceM < limit)
      distances.add(Math.min(limit,segment.startDistanceM + .01));
    if (segment.endDistanceM >= start && segment.endDistanceM <= limit) distances.add(segment.endDistanceM);
    if (distances.size > 320) break;
  }
  for (const distance of [...distances].sort((a,b) => a-b)) {
    const frame = getJourneyPlaybackFrame(model,distance);
    if (!frame) continue;
    const centers = [frame.coordinates,frame.cameraCoordinates];
    const nearby = centers.map(([lng,lat]) => tileAt(lng,lat,17));
    const regional = nearby.flatMap(tile => [ancestor(tile,12),ancestor(tile,14),ancestor(tile,16)]);
    const backdrop = [-30,0,30].map(turn => {
      const point=journeyDestination(frame.cameraCoordinates,(frame.headingDeg ?? 0)+turn,1800);
      return tileAt(...point,12);
    });
    regional.push(...backdrop);
    const additions = [...new Set([...nearby,...regional].map(tile => tile.key))]
      .filter(key => !detail.has(key) && !overview.has(key)).length;
    if (end > start && detail.size + overview.size + additions > maxCorridorTiles) break;
    for (const tile of regional) overview.set(tile.key,tile);
    for (const tile of backdrop) forwardTerrain.set(tile.key,tile);
    for (const tile of nearby) detail.set(tile.key,tile);
    if (limit-start<=1400 || distance-start<=600) for (const tile of nearby) {
      const preview=limit-start<=1400 ? tile : ancestor(tile,16);
      startup.set(preview.key,preview);
    }
    end = distance;
  }
  const surroundings = new Map<string, Tile>();
  const closeRange = end - start <= 1400;
  const count = Math.min(18, Math.max(1, Math.ceil((end - start) / (closeRange ? 75 : 600))));
  for (let i = 0; i <= count; i++) {
    const frame = getJourneyPlaybackFrame(model, start + (end - start) * i / count);
    if (!frame) continue;
    const view = planSatelliteTiles(...frame.cameraCoordinates, 17, routeImageryFocus({model,frame}));
    for (const tile of [...view.map(t => ancestor(t,9)),...view]) {
      if (tile.z > 14 && !closeRange || detail.has(tile.key) || overview.has(tile.key)) continue;
      surroundings.set(tile.key, tile);
    }
  }
  // Prefer regional coverage when the corridor crosses several base tiles.
  const backdrop = [...surroundings.values()].sort((a,b) => a.z-b.z).slice(0, 48);
  // The full corridor needs regional imagery; the upcoming road also needs local
  // detail. Scenery outside this corridor can load after the clock starts.
  const entryTiles=uniqueTiles([[...overview.values()].filter(t=>t.z===14),[...forwardTerrain.values()],[...startup.values()]]);
  return { start, end, overview:[...overview.values()], detail:[...detail.values()], surroundings: backdrop, startup:entryTiles };
}

export function windowCovers(plan: JourneyWindow, distance: number, total: number) {
  const lead = Math.min(1200, (plan.end - plan.start) * .35);
  return distance >= plan.start && (plan.end >= total || distance <= plan.end - lead);
}

export function uniqueTiles(groups: readonly (readonly Tile[])[]) {
  const result = new Map<string,Tile>();
  for (const group of groups) for (const tile of group) {
    if (!result.has(tile.key)) result.set(tile.key, tile);
  }
  return [...result.values()];
}
