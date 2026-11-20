import type { ConstellationFrame } from './constellations.ts';
import type { DeviceSkyOptics, DeviceSkyPose } from './deviceSkyCamera.ts';
import { dot, skyAxes } from './constellationsCamera.ts';
import survey from './constellations.galactic-light.json' with { type: 'json' };

interface BandSurface {
  image: ImageData;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  key?: string;
  frame?: ConstellationFrame;
  horizon?: (azimuth:number)=>number|null;
}
const layers = new WeakMap<CanvasRenderingContext2D, BandSurface>();
const rad = Math.PI/180;

function surface(ctx:CanvasRenderingContext2D,width:number,height:number) {
  const scale = Math.min(1, 256/Math.max(width,height));
  const w = Math.max(2,Math.round(width*scale)), h = Math.max(2,Math.round(height*scale));
  const cached=layers.get(ctx);
  if (cached && cached.canvas.width === w && cached.canvas.height === h) return cached;
  const canvas=ctx.canvas.ownerDocument.createElement('canvas');
  canvas.width=w;canvas.height=h;
  const context=canvas.getContext('2d');
  if (!context) return null;
  const layer:BandSurface={canvas,context,image:context.createImageData(w,h)};
  layers.set(ctx,layer);
  return layer;
}

let texture: { light: string; warmth: string } | undefined;

/** NASA SVS/Gaia DR2 stellar-density background, without its bright-star layer. */
export function drawGalacticBand(ctx:CanvasRenderingContext2D,width:number,height:number,pose:DeviceSkyPose,
  optics:DeviceSkyOptics,frame:ConstellationFrame,night:number,horizonAt?: (azimuth:number)=>number|null) {
  const strength = Math.max(0,(night-.26)/.74);
  if (!strength) return;
  const layer=surface(ctx,width,height);
  if (!layer) return;
  const key=[pose.azimuth,pose.altitude,pose.roll,optics.horizontalFov,optics.verticalFov,strength].join('/');
  ctx.globalAlpha=1;
  ctx.imageSmoothingEnabled=true;
  if(layer.frame===frame && layer.horizon===horizonAt && layer.key===key) {
    ctx.drawImage(layer.canvas,0,0,width,height);
    return;
  }
  layer.frame=frame;layer.horizon=horizonAt;layer.key=key;
  texture??={light:atob(survey.light),warmth:atob(survey.warmth)};
  const axis=skyAxes(pose,optics), {canvas,context,image}=layer;
  const horizontal=[axis.forward,axis.right,axis.up];
  const pole=horizontal.map(a=>dot(frame.galacticPole,a));
  const zero=horizontal.map(a=>dot(frame.galacticZero,a)),east=horizontal.map(a=>dot(frame.galacticEast,a));
  const texW=survey.width,texH=survey.height;
  const pixels=image.data,w=canvas.width,h=canvas.height;
  for (let y=0; y<h; y++) {
    const py=(1-2*(y+.5)/h)*axis.ty;
    for(let x=0; x<w; x++) {
      const px=(2*(x+.5)/w-1)*axis.tx;
      const inv=1/Math.sqrt(1+px*px+py*py), at=(y*w+x)*4;
      const up=(axis.forward[2]+px*axis.right[2]+py*axis.up[2])*inv;
      const sinB=(pole[0]+px*pole[1]+py*pole[2])*inv;
      pixels[at+3]=0;
      if(up<=0 || Math.abs(sinB)>.55)continue;
      if(horizonAt){
        const east=axis.forward[0]+px*axis.right[0]+py*axis.up[0];
        const north=axis.forward[1]+px*axis.right[1]+py*axis.up[1];
        const az=(Math.atan2(east,north)/rad+360)%360;
        if(up<Math.sin(Math.max(0,horizonAt(az)??0)*rad))continue;
      }
      // Plate carrée in Galactic coordinates; l=0 is at center, l increases toward the left.
      const longitude=Math.atan2(east[0]+px*east[1]+py*east[2],zero[0]+px*zero[1]+py*zero[2]);
      const u=((.5-longitude/(2*Math.PI))*texW+texW-.5)%texW;
      const v=Math.max(0,Math.min(texH-1,(.5-Math.asin(sinB)/Math.PI)*survey.fullHeight-survey.top-.5));
      const ix=Math.floor(u), iy=Math.floor(v), ix1=(ix+1)%texW, iy1=Math.min(iy+1,texH-1);
      const fu=u-ix,fv=v-iy, a=iy*texW,b=iy1*texW, tex=texture.light;
      const light=(1-fv)*((1-fu)*tex.charCodeAt(a+ix)+fu*tex.charCodeAt(a+ix1))+
        fv*((1-fu)*tex.charCodeAt(b+ix)+fu*tex.charCodeAt(b+ix1));
      const warmth=(texture.warmth.charCodeAt((iy>>2)*(texW>>2)+(ix>>2))-128)*.5;
      const fade=Math.min(1,(.55-Math.abs(sinB))/.12);
      pixels[at]=201+warmth*.70;pixels[at+1]=213-warmth*.16;pixels[at+2]=231-warmth*.85;
      pixels[at+3]=Math.max(0,(light-14)*1.05)*strength*fade;
    }
  }
  context.putImageData(image,0,0);
  ctx.drawImage(canvas,0,0,width,height);
}
