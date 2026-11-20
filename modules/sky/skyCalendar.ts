import type { SkyTimeInterval } from './astronomy.ts';

export function skyCalendarDate(time:number, timeZone:string) {
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone,calendar:'gregory',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit',
  }).formatToParts(time);
  return ['year','month','day'].map(type=>parts.find(p=>p.type===type)!.value).join('-');
}

/** Keep the observer's wall-clock time when changing dates across DST. A skipped hour rolls forward. */
export function skyTimeOnDay(time:number, day:SkyTimeInterval, zone:string) {
  const format=new Intl.DateTimeFormat('en-GB',{timeZone:zone,numberingSystem:'latn',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const minute=(instant:number)=>{
    const parts=format.formatToParts(instant);
    return Number(parts.find(p=>p.type==='hour')!.value)*60+Number(parts.find(p=>p.type==='minute')!.value);
  };
  const wanted=minute(time);
  const bound=(t:number)=>Math.max(day.startMs,Math.min(day.endMs-1,t));
  const floor=day.startMs+(time%60000+60000)%60000;
  // Offset difference is measured at local noon, away from ordinary DST transitions.
  const probe=day.startMs+Math.min(12*3600000, day.endMs-day.startMs-1);
  const nominal=floor+wanted*60000;
  const offsets=[nominal, nominal+(720-minute(probe))*60000];
  for(const t of offsets)if(t>=day.startMs&&t<day.endMs&&minute(t)===wanted)return t;
  return bound(nominal);
}
