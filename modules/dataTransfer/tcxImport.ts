import { RouteBuilder, importPoint, type ImportPoint } from './routeBuilder.ts';

export function parseTcx(doc: Document, filename: string) {
  const result=new RouteBuilder(filename);
  const elements=(el:Document|Element,name:string)=>Array.from(el.getElementsByTagNameNS('*',name));
  const text=(el:Element,name:string)=>elements(el,name)[0]?.textContent?.trim();
  const point=(el:Element)=>importPoint(text(el,'LongitudeDegrees'),text(el,'LatitudeDegrees'),text(el,'AltitudeMeters'),text(el,'Time'));
  const objects=[...elements(doc,'Course'),...elements(doc,'Activity')];
  for(const obj of objects){
    const name=text(obj,'Name')||text(obj,'Id')||result.fallback;
    const parts:ImportPoint[][]=[];
    for(const track of elements(obj,'Track')){
      let part:ImportPoint[]=[];
      for(const fix of elements(track,'Trackpoint')){
        if(!elements(fix,'Position').length){if(part.length)parts.push(part);part=[];continue;}
        part.push(point(fix));
      }
      if(part.length)parts.push(part);
    }
    if(parts.length)result.track(name,parts);
    for(const cp of elements(obj,'CoursePoint'))result.pin(text(cp,'Name')||name,point(cp),text(cp,'Notes')||'');
  }
  return result.finish();
}
