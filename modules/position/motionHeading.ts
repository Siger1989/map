import { coordinate, metresBetween, type Coordinate } from '../navigation/types.ts';
import { headingDelta, wrapHeading, type PositionFix } from './types.ts';

export function travelBearing(a: Coordinate, b: Coordinate) {
  const r=Math.PI/180, dl=(b[0]-a[0])*r, p=a[1]*r, q=b[1]*r;
  return wrapHeading(Math.atan2(Math.sin(dl)*Math.cos(q),Math.cos(p)*Math.sin(q)-Math.sin(p)*Math.cos(q)*Math.cos(dl))/r);
}
/** Acceleration alone cannot establish absolute course or distinguish rest from steady speed. */
export class MotionHeading {
  private anchor: PositionFix | null = null;
  private timestamp = 0;
  private heading: number | null = null;
  update(fix: PositionFix | null, now: number, accelerationQuiet = false) {
    const result=(status:string)=>({heading:this.heading,status});
    if(!fix || !coordinate(fix.coordinates) || !Number.isFinite(fix.timestamp) || !Number.isFinite(fix.accuracy) || fix.accuracy<0 || now-fix.timestamp>10000 || fix.timestamp>now+3000) return result('等待新定位，运动方向保持不变');
    if(fix.source==='network'||fix.accuracy>30){this.anchor=null;return result('等待较准确的GPS定位');}
    if(fix.timestamp<=this.timestamp)return result(this.heading===null?'移动一段距离后确定运动方向':'');
    this.timestamp=fix.timestamp;
    if(fix.speed!==undefined && fix.speed<0.5){this.anchor=fix;return result('已减速或停下，保持运动方向');}
    let course:number|null=null;
    if(fix.heading!==undefined && Number.isFinite(fix.heading) && fix.heading>=0 && fix.heading<360 && fix.speed!==undefined && fix.speed>=1 && fix.speed<=80 && (fix.headingAccuracy??0)<=35)course=fix.heading;
    else if(this.anchor){
      const seconds=(fix.timestamp-this.anchor.timestamp)/1000;
      const distance=metresBetween(this.anchor.coordinates,fix.coordinates);
      if(seconds>30 || seconds<=0 || distance/seconds>80){this.anchor=fix;return result('重新确认运动方向');}
      // Quiet acceleration only raises the drift threshold; it never invents a heading.
      const threshold=Math.max(6,(this.anchor.accuracy+fix.accuracy)*(accelerationQuiet?1.2:0.8));
      if(distance>=threshold && distance/seconds>=0.6)course=travelBearing(this.anchor.coordinates,fix.coordinates);
    }
    if(!this.anchor)this.anchor=fix;
    if(course===null)return result(this.heading===null?'移动一段距离后确定运动方向':'');
    this.anchor=fix;
    this.heading=this.heading===null?wrapHeading(course):wrapHeading(this.heading+headingDelta(this.heading,course)*0.4);
    return result('');
  }
}
