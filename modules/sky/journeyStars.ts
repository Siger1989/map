import type { SkyObserver } from './astronomy.ts';
import type { DeviceSkyOptics,DeviceSkyPose } from './deviceSkyCamera.ts';
import { createConstellationFrame,drawConstellations,type ConstellationFrame } from './constellations.ts';

export interface JourneyStarLayers {
  constellations: boolean;
  milkyWay: boolean;
  /** Empty or "all" selects the complete catalog; otherwise use the three-letter IAU abbreviation. */
  constellationId: string;
}
export interface JourneyStarFrame {
  time: number;
  observer: SkyObserver;
  pose: DeviceSkyPose;
  optics: DeviceSkyOptics;
  width: number;
  height: number;
  layers: JourneyStarLayers;
  sunAltitudeDeg: number;
}

/** Draw synchronously between the dated sky and the satellite terrain, and before encoding that same frame. */
export function createJourneyStars(canvas:HTMLCanvasElement, _onTextureReady:()=>void) {
  const ctx=canvas.getContext('2d',{alpha:true});
  if (!ctx) throw Error('当前设备无法绘制行程星空');
  let previous='',frameKey='',frame:ConstellationFrame|undefined,painted=false,disposed=false;
  return {
    draw(p:JourneyStarFrame):boolean {
      if(disposed || p.width<=0 || p.height<=0)return false;
      const scale=Math.min(canvas.ownerDocument.defaultView?.devicePixelRatio || 1,2,1440/Math.max(p.width,p.height));
      const w=Math.max(1,Math.round(p.width*scale)),h=Math.max(1,Math.round(p.height*scale));
      const resized=canvas.width!==w || canvas.height!==h;
      if(resized){canvas.width=w;canvas.height=h;painted=false;previous='';}
      ctx.setTransform(w/p.width,0,0,h/p.height,0,0);
      if((!p.layers.constellations && !p.layers.milkyWay) || p.sunAltitudeDeg>=-1) {
        if(painted)ctx.clearRect(0,0,p.width,p.height);
        painted=false;previous='';
        return true;
      }

      // Maximum chart drift from rounding is about 0.033° in time and 0.001° in location.
      // Compressing an entire day still needs just one astrometric rotation per distinct chart.
      const instant=Math.round(p.time/15000)*15000;
      const lat=Math.round(p.observer.latitude*500)/500,lon=Math.round(p.observer.longitude*500)/500;
      const skyKey=instant+'/'+lat+'/'+lon;
      if(!frame || skyKey!==frameKey){
        frame=createConstellationFrame(instant,{latitude:lat,longitude:lon});frameKey=skyKey;
      }
      const only=p.layers.constellations && p.layers.constellationId && p.layers.constellationId!=='all'
        ? p.layers.constellationId : undefined;
      const key=[skyKey,p.pose.azimuth,p.pose.altitude,p.pose.roll,p.optics.horizontalFov,p.optics.verticalFov,
        p.width,p.height,p.layers.constellations,p.layers.milkyWay,only,Math.round(p.sunAltitudeDeg*20)].join('/');
      if(painted && key===previous)return true;
      ctx.clearRect(0,0,p.width,p.height);
      drawConstellations(ctx,p.width,p.height,p.pose,p.optics,frame,{
        showConstellations:p.layers.constellations,showMilkyWay:p.layers.milkyWay,
        selected:only,onlyConstellation:only,sunAltitudeDeg:p.sunAltitudeDeg,
      });
      // The Galactic texture ships as local byte data. The first night frame is already complete.
      painted=true;previous=key;
      return true;
    },
    dispose(){
      disposed=true;frame=undefined;previous='';
      ctx.setTransform(1,0,0,1,0,0);
      ctx.clearRect(0,0,canvas.width,canvas.height);
    },
  };
}
