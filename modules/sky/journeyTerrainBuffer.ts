import { getJourneyPlaybackFrame, type JourneyPlaybackModel } from './journeyPlayback.ts';
import { JOURNEY_CAMERA_LAG_M, journeyCameraAzimuth, journeyDestination } from './journeyCamera.ts';
import { mercator, type Tile } from './satelliteTerrainGeometry.ts';
import { routeImageryFocus } from './journeyRouteOverlay.ts';

export interface JourneyTerrainBuffer {
  status: 'loading' | 'ready' | 'degraded' | 'unavailable';
  loaded: number;
  total: number;
  frameReady: boolean;
  throughDistanceM: number;
  readyThroughDistanceM: number | null;
  detailLoaded: number;
  detailTotal: number;
  minDetailZoom: number;
  frameDegraded: boolean;
  frameTerrainOnly?: boolean;
  frameHasImagery?: boolean;
  unavailableTiles: number;
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
  checkpoints: { distanceM: number; tiles: Tile[] }[];
}

const maxAhead = 9000;
// Compressed images for the route can outlive their decoded GPU meshes.
const maxCorridorTiles = 320;

/** Bounding rectangle of a short ground footprint. Unwrap around the camera at
 * the antimeridian so the loop stays local on international itineraries. */
function footprint(points: readonly (readonly [number,number])[], z:number, marginM = 0) {
  const period=2**z;
  const locations=points.map(([lng,lat])=>mercator(lng,lat,z));
  const origin=locations[0][0];
  let left=origin, right=origin, top=locations[0][1], bottom=top;
  for (const [x,y] of locations) {
    const dx=((x-origin+period*.5+period)%period)-period*.5;
    left=Math.min(left,origin+dx); right=Math.max(right,origin+dx);
    top=Math.min(top,y); bottom=Math.max(bottom,y);
  }
  const margin=marginM*period/(40_075_017*Math.cos(points[0][1]*Math.PI/180));
  const result:Tile[]=[];
  for(let col=Math.floor(left-margin);col<=Math.floor(right+margin);col++){
    const x=(col+period)%period;
    for(let y=Math.max(0,Math.floor(top-margin));y<=Math.min(period-1,Math.floor(bottom+margin));y++)
      result.push({z,x,y,key:`${z}/${x}/${y}`});
  }
  return result;
}

export function journeyGroundFootprint(route: Parameters<typeof routeImageryFocus>[0], horizontalFov:number, marginM=0) {
  const {frame}=route, eye=frame.cameraCoordinates;
  const bearing=frame.cameraMotion ? journeyCameraAzimuth(frame,eye,horizontalFov) : frame.cameraHeadingDeg ?? frame.headingDeg ?? 0;
  const half=Math.min(72,Math.max(8,horizontalFov/2));
  const corners=(ahead:number) => {
    const spread=ahead/Math.cos(half*Math.PI/180);
    return [eye,journeyDestination(eye,bearing-half,spread),journeyDestination(eye,bearing+half,spread)] as const;
  };
  // Preserve the foreground's physical pixel size at high latitudes.
  const latitudeOffset=Math.max(0,Math.floor(Math.log2(.85/Math.cos(eye[1]*Math.PI/180))));
  const detailZoom=17-latitudeOffset;
  const foreground = 200 + Math.max(0, frame.cameraLagM - JOURNEY_CAMERA_LAG_M);
  const detail=uniqueTiles([footprint([...corners(foreground),frame.coordinates],detailZoom,marginM),
    routeImageryFocus(route).map(([x,y])=>tileAt(x,y,detailZoom))]);
  const middle=footprint(corners(640),Math.max(9,15-latitudeOffset),marginM);
  const horizon=footprint(corners(3200),Math.max(9,12-latitudeOffset),marginM);
  return {detail,middle,horizon};
}

/** Promote compressed tiles to GPU memory ahead of the moving camera. */
type ViewSettings=Parameters<typeof getJourneyPlaybackFrame>[2];
export function journeyGpuLookahead(model:JourneyPlaybackModel, distance:number, fov:number,settings?:ViewSettings) {
  const groups:Tile[][]=[];
  const step=100, end=Math.min(model.totalDistanceM,distance+1500);
  for(let d=distance;d<end+step;d+=step){
    const frame=getJourneyPlaybackFrame(model,Math.min(d,end),settings);
    if(frame){
      const {detail,middle,horizon}=journeyGroundFootprint({model,frame},fov,20);
      groups.push(detail,middle,horizon);
    }
    if(d>=end)break;
  }
  return uniqueTiles(groups);
}

/** Make the displayed quadtree reach every required cell. Drawing only the generic
 * eye-centred tree can skip a preloaded z17 road tile when the road turns. */
export function refineJourneyLeaves(base:Tile[],targets:readonly Tile[]) {
  const split=new Set<string>();
  for(const t of targets) for(let z=t.z-1;z>=9;z--)split.add(ancestor(t,z).key);
  const leaves:Tile[]=[];
  function visit(t:Tile){
    if(!split.has(t.key)){leaves.push(t);return;}
    const z=t.z+1;
    for(const dx of [0,1])for(const dy of [0,1]){
      const x=t.x*2+dx,y=t.y*2+dy;
      visit({z,x,y,key:`${z}/${x}/${y}`});
    }
  }
  for(const t of base)visit(t);
  return leaves;
}

/** Sample actual route and camera positions. A finite GPU budget shortens the lookahead
 * at high latitudes or on fragmented routes rather than silently dropping their coverage. */
export function planJourneyWindow(model: JourneyPlaybackModel, distanceM: number, horizontalFov=42,settings?:ViewSettings): JourneyWindow {
  const start = Math.max(0, Math.min(distanceM,model.totalDistanceM));
  const limit = Math.min(start + maxAhead, model.totalDistanceM);
  const overview = new Map<string,Tile>(), detail = new Map<string,Tile>(), startup = new Map<string,Tile>();
  const checkpoints: JourneyWindow['checkpoints'] = [];
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
    const frame = getJourneyPlaybackFrame(model,distance,settings);
    if (!frame) continue;
    const {detail:nearby,middle,horizon}=journeyGroundFootprint({model,frame},horizontalFov,45);
    const regional = uniqueTiles([middle,horizon]);
    const additions = [...new Set([...nearby,...regional].map(tile => tile.key))]
      .filter(key => !detail.has(key) && !overview.has(key)).length;
    if (end > start && detail.size + overview.size + additions > maxCorridorTiles) break;
    for (const tile of regional) overview.set(tile.key,tile);
    for (const tile of nearby) detail.set(tile.key,tile);
    checkpoints.push({distanceM:distance,tiles:uniqueTiles([nearby,regional])});
    end = distance;
  }
  const surroundings = new Map<string, Tile>();
  const count = Math.min(32, Math.max(1, Math.ceil((end - start) / 450)));
  for (let i = 0; i <= count; i++) {
    const frame = getJourneyPlaybackFrame(model, start + (end - start) * i / count,settings);
    if (!frame) continue;
    const root=tileAt(...frame.cameraCoordinates,9);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
      const x=(root.x+dx+512)%512,y=root.y+dy;
      if(y<0||y>=512)continue;
      const key=`9/${x}/${y}`;
      surroundings.set(key,{z:9,x,y,key});
    }
  }
  // Prefer regional coverage when the corridor crosses several base tiles.
  const backdrop = [...surroundings.values()];
  for(const t of [...detail.values(),...overview.values(),...backdrop])startup.set(t.key,t);
  return { start, end, overview:[...overview.values()], detail:[...detail.values()], surroundings: backdrop, startup:[...startup.values()], checkpoints };
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
