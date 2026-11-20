import { catalogStars, constellationFigures, equatorialNodes, type ConstellationFrame } from './constellations.ts';
import type { SkyDirection } from './astronomy.ts';
import type { DeviceSkyOptics, DeviceSkyPose } from './deviceSkyCamera.ts';
import { makeTrackProjector, type ScreenPoint } from './skyTrackGeometry.ts';
import { drawGalacticBand } from './constellationsGalaxy.ts';
import { dot, projectSkyNodes, skyAxes } from './constellationsCamera.ts';

export interface ConstellationDrawOptions {
  showConstellations: boolean;
  showMilkyWay: boolean;
  selected?: string | null;
  onlyConstellation?: string;
  sunAltitudeDeg: number;
  horizonAt?: (azimuthDeg: number) => number | null;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function nightStrength(sunAltitudeDeg: number) {
  const t = clamp01((-sunAltitudeDeg - 1) / 14);
  return t*t*(3 - 2*t);
}

function rim(point: SkyDirection, options: ConstellationDrawOptions) {
  return point.altitudeDeg - Math.max(0, options.horizonAt?.(point.azimuthDeg) ?? 0);
}

function between(a: SkyDirection, b: SkyDirection, t: number): SkyDirection {
  const delta = (b.azimuthDeg - a.azimuthDeg + 540) % 360 - 180;
  return {azimuthDeg: (a.azimuthDeg + delta*t + 360) % 360, altitudeDeg: a.altitudeDeg + (b.altitudeDeg-a.altitudeDeg)*t};
}

function crossing(a: SkyDirection, b: SkyDirection, visibleA: boolean, options: ConstellationDrawOptions) {
  let low = 0, high = 1;
  for (let i = 0; i < 7; i++) {
    const t = (low+high)/2;
    if ((rim(between(a,b,t), options) >= 0) === visibleA) low = t;
    else high = t;
  }
  return between(a,b,(low+high)/2);
}

/** For horizon masking, subdivided links follow their celestial great circle. */
export function clipConstellationLink(a: SkyDirection, b: SkyDirection, options: ConstellationDrawOptions): [SkyDirection, SkyDirection] | null {
  const va = rim(a, options) >= 0, vb = rim(b, options) >= 0;
  if (!va && !vb) return null;
  if (va && vb) return [a,b];
  const cut = crossing(a,b,va,options);
  return va ? [a,cut] : [cut,b];
}

function tag(ctx: CanvasRenderingContext2D, text: string, p: ScreenPoint, selected: boolean) {
  ctx.font = selected ? 'bold 13px sans-serif' : '11px sans-serif';
  ctx.lineWidth = 2.7;
  ctx.strokeStyle = 'rgba(10,16,27,.85)';
  ctx.fillStyle = selected ? '#ffdc88' : '#c3d5eb';
  ctx.strokeText(text, p.x+6,p.y-5);
  ctx.fillText(text, p.x+6,p.y-5);
}

export function drawConstellations(ctx: CanvasRenderingContext2D, width: number, height: number,
  pose: DeviceSkyPose, optics: DeviceSkyOptics, frame: ConstellationFrame, options: ConstellationDrawOptions) {
  const night = nightStrength(options.sunAltitudeDeg);
  if (width <= 0 || height <= 0 || night < .002 || (!options.showConstellations && !options.showMilkyWay)) return;
  const projector = makeTrackProjector(pose,optics,width,height);
  ctx.save();
  if (options.showMilkyWay) {
    drawGalacticBand(ctx,width,height,pose,optics,frame,night,options.horizonAt);
  }

  if (options.showConstellations || options.showMilkyWay) {
    // Cache the point projection for this pose. Most stars and links lie outside the field of view.
    const local=skyAxes(pose,optics);
    const axes={...local,forward:frame.equatorialAxis(local.forward),right:frame.equatorialAxis(local.right),up:frame.equatorialAxis(local.up)};
    const only=options.onlyConstellation ? constellationFigures.find(f=>f.id===options.onlyConstellation) : undefined;
    const screen = projectSkyNodes(equatorialNodes,axes,width,height,options.onlyConstellation ? (only?.nodeIndices ?? []) : undefined);
    const above=(i:number)=> options.horizonAt ? rim(frame.directionOf(i),options)>=0 : dot(equatorialNodes[i],frame.zenithEquatorial)>=0;
    const labels: {name:string; point:ScreenPoint; selected:boolean}[] = [];
    ctx.lineJoin = 'round';
    const figures=!options.showConstellations ? [] : options.onlyConstellation ? (only?[only]:[]) : constellationFigures;
    for (const figure of figures) {
      const chosen = figure.id === options.selected;
      ctx.lineWidth = chosen ? 1.6 : .8;
      ctx.strokeStyle = chosen ? '#ffd988' : '#a2c9f0';
      ctx.globalAlpha = (chosen ? .96 : .5)*night;
      ctx.beginPath();
      for (const path of figure.paths) for (let k = 1; k < path.length; k++) {
        const i = path[k-1], j = path[k];
        // Two offscreen neighbours can straddle a viewport corner.
        // Only near-edge links need full frustum clipping.
        if (screen[i].code & screen[j].code) continue;
        const pi=screen[i].point, pj=screen[j].point;
        if(pi && pj && above(i) && above(j)){
          ctx.moveTo(pi.x,pi.y);ctx.lineTo(pj.x,pj.y);
          continue;
        }
        const pair = clipConstellationLink(frame.directionOf(i),frame.directionOf(j),options);
        const projected = pair ? projector.segment(pair[0],pair[1]) : null;
        if (projected) {ctx.moveTo(projected[0].x, projected[0].y);ctx.lineTo(projected[1].x,projected[1].y);}
      }
      ctx.stroke();
      const p = screen[figure.anchor].point;
      if (p && above(figure.anchor)) labels.push({name:figure.name,point:p,selected:chosen});
    }
    const members=options.onlyConstellation ? (only?.members ?? []) : null;
    for (let n = 0; n < (members?.length ?? catalogStars.length); n++) {
      const i=members?members[n]:n;
      const p = screen[i].point, star = catalogStars[i];
      if (!p || !above(i)) continue;
      const strength=clamp01((6.0-star.magnitude)/6.5);
      const alpha=night*clamp01(.16+strength*(.45+.65*night));
      if(alpha<.035)continue;
      ctx.fillStyle=star.color;
      ctx.globalAlpha=alpha;
      if (star.magnitude>4.7) {
        ctx.fillRect(p.x-.45,p.y-.45,.9,.9);
        continue;
      }
      ctx.beginPath();
      ctx.arc(p.x,p.y,.48+1.25*strength,0,Math.PI*2);
      ctx.fill();
    }
    const placed: ScreenPoint[]=[];
    labels.sort((a,b)=>Number(b.selected)-Number(a.selected));
    for (const label of labels) {
      if (!label.selected && placed.some(p=>Math.abs(label.point.x-p.x)<52 && Math.abs(label.point.y-p.y)<15))continue;
      ctx.globalAlpha=night*(label.selected?1:.78);
      tag(ctx,label.name,label.point,label.selected);
      placed.push(label.point);
    }
  }
  if (options.showMilkyWay && rim(frame.galacticCenterDirection,options)>=0) {
    const p=projector.point(frame.galacticCenterDirection);
    if (p) {
      ctx.globalAlpha=night;
      ctx.strokeStyle='#ffe1ac';ctx.lineWidth=1.1;
      ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.stroke();
      if(options.selected!=='milky-way') tag(ctx,'银心',p,false);
    }
  }
  ctx.restore();
}
