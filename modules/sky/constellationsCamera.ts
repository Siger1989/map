import type { DeviceSkyOptics, DeviceSkyPose } from './deviceSkyCamera.ts';
import type { StarVector } from './constellations.ts';

const radians = Math.PI / 180;

export function skyAxes(pose: DeviceSkyPose, optics: DeviceSkyOptics) {
  const az = pose.azimuth*radians, alt = pose.altitude*radians, roll=pose.roll*radians;
  const sa=Math.sin(az),ca=Math.cos(az),sh=Math.sin(alt),ch=Math.cos(alt),sr=Math.sin(roll),cr=Math.cos(roll);
  const forward: StarVector=[ch*sa,ch*ca,sh];
  const right: StarVector=[ca*cr-sa*sh*sr,-sa*cr-ca*sh*sr,ch*sr];
  const up: StarVector=[-sa*sh*cr-ca*sr,-ca*sh*cr+sa*sr,ch*cr];
  return {forward,right,up,tx:Math.tan(optics.horizontalFov*radians/2),ty:Math.tan(optics.verticalFov*radians/2)};
}

export function dot(a: StarVector, b: StarVector) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }

export function projectSkyNodes(vectors: readonly StarVector[], axes: ReturnType<typeof skyAxes>, width: number, height:number, indices?:readonly number[]) {
  const project=(v:StarVector)=>{
    const z=dot(v,axes.forward), x=dot(v,axes.right)/axes.tx, y=dot(v,axes.up)/axes.ty;
    // The same five pinhole clipping planes as the existing solar/lunar track projector.
    const code=(z<.01?1:0)|(x < -z?2:0)|(x>z?4:0)|(y < -z?8:0)|(y>z?16:0);
    return {code,point:code?null:{x:width*(1+x/z)/2,y:height*(1-y/z)/2}};
  };
  if(!indices)return vectors.map(project);
  const result=new Array<ReturnType<typeof project>>(vectors.length);
  for(const i of indices)result[i]=project(vectors[i]);
  return result;
}
