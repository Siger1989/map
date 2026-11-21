import type { JourneyPlaybackFrame, JourneyPlaybackModel } from './journeyPlayback';
import { earthAxis, earthPosition, type Vec3 } from './satelliteTerrainGeometry.ts';

export interface JourneyTerrainRoute { model: JourneyPlaybackModel; frame: JourneyPlaybackFrame }
export type HeightAt = (lng: number, lat: number) => number | null;
export interface RouteProjection {
  eye: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  tanX: number;
  tanY: number;
  near: number;
  far: number;
  width: number;
  height: number;
}
type Point = readonly [number, number];
const nearHistory = 180;
const nearFuture = 520;
const maxSamples = 192;

function interpolate(a: Point, b: Point, fraction: number): Point {
  const dx = (b[0] - a[0] + 540) % 360 - 180;
  return [((a[0] + dx * fraction + 540) % 360) - 180, a[1] + (b[1] - a[1]) * fraction];
}

/** A short route corridor for imagery refinement, without crossing a segment break. */
export function routeImageryFocus({ model, frame }: JourneyTerrainRoute): Point[] {
  const segment = model.segments[frame.segmentIndex];
  if (!segment || segment.points.length < 2) return [frame.coordinates];
  const { points, endDistanceM } = segment;
  const ahead = [...new Set([100, 180].map(distance => Math.min(endDistanceM, frame.distanceM + distance)))];
  return [frame.coordinates, ...ahead.filter(distance => distance > frame.distanceM).map(distance => {
    let left = 0, right = points.length - 1;
    while (right - left > 1) {
      const middle = (left + right) >>> 1;
      if (points[middle].distanceM < distance) left = middle;
      else right = middle;
    }
    const a = points[left], b = points[right];
    const span = b.distanceM - a.distanceM;
    return span > 0 ? interpolate(a.coordinates, b.coordinates, (distance - a.distanceM) / span) : b.coordinates;
  })];
}

function project(world: Vec3, view: RouteProjection) {
  const relative = world.map((value, i) => value - view.eye[i]);
  const dot = (axis: Vec3) => relative[0] * axis[0] + relative[1] * axis[1] + relative[2] * axis[2];
  return { x: dot(view.right) / view.tanX, y: dot(view.up) / view.tanY, z: dot(view.forward) };
}

function ndc(p: ReturnType<typeof project>, { near, far }: RouteProjection): Vec3 {
  return [p.x / p.z, p.y / p.z, (far + near) / (far - near) - 2 * near * far / ((far - near) * p.z)];
}

function clipNear(a: ReturnType<typeof project>, b: ReturnType<typeof project>, near: number) {
  if (a.z < near && b.z < near) return null;
  const clamp = (p: typeof a, q: typeof a) => {
    if (p.z >= near) return p;
    const t = (near - p.z) / (q.z - p.z);
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: near };
  };
  return [clamp(a, b), clamp(b, a)] as const;
}

function strip(vertices: number[], a: Vec3, b: Vec3, width: number, view: RouteProjection) {
  const dx = (b[0] - a[0]) * view.width;
  const dy = (b[1] - a[1]) * view.height;
  const length = Math.hypot(dx, dy);
  if (length < .001) return;
  const x = -dy / length * width / view.width;
  const y = dx / length * width / view.height;
  vertices.push(a[0]+x,a[1]+y,a[2], a[0]-x,a[1]-y,a[2], b[0]+x,b[1]+y,b[2],
    b[0]+x,b[1]+y,b[2], a[0]-x,a[1]-y,a[2], b[0]-x,b[1]-y,b[2]);
}

/** Resample just the active segment, using a binary window start and retaining its corners. */
export function routeSamples({ model, frame }: JourneyTerrainRoute) {
  const segment = model.segments[frame.segmentIndex];
  if (!segment || segment.points.length < 2) return [];
  const { points } = segment;
  const low = Math.max(segment.startDistanceM, frame.distanceM - nearHistory);
  const high = Math.min(segment.endDistanceM, frame.distanceM + nearFuture);
  let start = 0, end = points.length;
  while (start < end) {
    const middle = (start + end) >>> 1;
    if (points[middle].distanceM < low) start = middle + 1;
    else end = middle;
  }
  const step = Math.max(5, (high - low) / 128);
  const distances = [low, frame.distanceM, high];
  for (let d = low + step; d < high; d += step) distances.push(d);
  // Densely sampled tracks already contribute regular samples. Limit scanning
  // and retained corner points so a long track cannot dominate a rendered frame.
  for (let i = start; i < Math.min(start + maxSamples, points.length) && points[i].distanceM < high; i++) {
    if (distances.length >= maxSamples) break;
    distances.push(points[i].distanceM);
  }
  let right = Math.min(points.length - 1, Math.max(1, start));
  return [...new Set(distances)].sort((a,b)=>a-b).map(distance => {
    while (right + 1 < points.length && points[right].distanceM < distance) {
      // Large clusters of points can occur thousands at a time on older recordings.
      let lower=right+1, upper=points.length-1;
      while(lower<upper){
        const middle=(lower+upper)>>>1;
        if(points[middle].distanceM<distance)lower=middle+1;else upper=middle;
      }
      right=lower;
    }
    if (distance === frame.distanceM) return { distance, coordinate: frame.coordinates as Point };
    const a = points[right-1], b = points[right];
    const span = b.distanceM - a.distanceM;
    return {distance, coordinate: interpolate(a.coordinates,b.coordinates,span>0?Math.max(0,Math.min(1,(distance-a.distanceM)/span)):0)};
  });
}

export function buildJourneyRouteOverlay(route: JourneyTerrainRoute, view: RouteProjection, heightAt: HeightAt, subjectAltitude: number | null) {
  const past: number[] = [], future: number[] = [], casing: number[] = [];
  let previous: ReturnType<typeof project> | null = null;
  for (const { coordinate: [lng,lat], distance } of routeSamples(route)) {
    const ground = heightAt(lng,lat);
    const current = ground === null ? null : project(earthPosition(lng,lat,ground+1.25),view);
    if (previous && current) {
      const endpoints=clipNear(previous,current,view.near);
      if(endpoints){
        const a=ndc(endpoints[0],view), b=ndc(endpoints[1],view);
        strip(casing,a,b,8,view);
        strip(distance<=route.frame.distanceM?past:future,a,b,4.5,view);
      }
    }
    previous=current;
  }
  let outline: number[] = [], arrow: number[] = [];
  if(subjectAltitude!==null){
    const [lng,lat]=route.frame.coordinates;
    const world=earthPosition(lng,lat,subjectAltitude+2.5);
    const heading=earthAxis(lng,lat,route.frame.arrowHeadingDeg??0,0);
    const tip=world.map((value,i)=>value+heading[i]*8) as Vec3;
    const center=project(world,view), ahead=project(tip,view);
    if(center.z>view.near && ahead.z>view.near){
      const [x,y,z]=ndc(center,view);
      const end=ndc(ahead,view);
      const dx=(end[0]-x)*view.width,dy=(end[1]-y)*view.height;
      const length=Math.hypot(dx,dy);
      const ux=length>0.01?dx/length:0,uy=length>0.01?dy/length:1;
      const shape=(size:number)=>{
        const point=(along:number,across:number)=>[x+(ux*along-uy*across)*size/view.width,y+(uy*along+ux*across)*size/view.height,z];
        const top=point(1,0),left=point(-.7,-.7),right=point(-.7,.7),notch=point(-.22,0);
        return [...top,...left,...notch,...top,...notch,...right];
      };
      if(Math.abs(x)<1.08 && Math.abs(y)<1.08){outline=shape(41);arrow=shape(33);}
    }
  }
  return { past, future, casing, outline, arrow };
}
