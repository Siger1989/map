import {getLocalDayBounds} from './astronomy';

export function localMinute(timeMs:number, zone:string) {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(timeMs);
  const part=(kind:string)=>parts.find(p=>p.type===kind)!.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

// HTML datetime-local has no offset. Select the first occurrence on a fall-back day.
export function journeyInstant(value:string,zone:string) {
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value))return null;
  try {
    const day=getLocalDayBounds(value.slice(0,10),zone);
    const hours=Number(value.slice(11,13)), minutes=Number(value.slice(14,16));
    if(hours>23||minutes>59)return null;
    const guess=day.startMs+(hours*60+minutes)*60000;
    // Most dates have no offset transition.
    if(day.endMs-day.startMs===86400000 && localMinute(guess,zone)===value)return guess;
    const clock=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    for(let time=day.startMs;time<day.endMs;time+=60000)if(clock.format(time)===value.slice(11))return time;
  }catch{ /* Invalid or skipped calendar date in the departure zone. */ }
  return null;
}
