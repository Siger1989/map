import { RouteBuilder, importPoint } from './routeBuilder.ts';
import { importCoordinate, type ImportCoordinates } from './coordinateSystem.ts';

/** OviO v105 object frames; independently decoded against paired OVOBJ/OVJSN samples.
 * No coordinate scanning: frame lengths, body revisions, point count and exact end must agree.
 * Delta header: signs in bits 7/6, payload byte count in bits 5..2, leading payload bits 1..0.
 * Payload packs latitude/longitude magnitudes into equal (4*n+1)-bit halves, big endian.
 */
export function parseOvobj(bytes: Uint8Array, filename: string, system: ImportCoordinates) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const result=new RouteBuilder(filename);
  const fail=()=>new Error('此 OVOBJ 的版本或对象结构尚未支持，或文件已截断；未部分导入');
  const check=(offset:number,size:number,end=bytes.length)=>{if(offset<0||size<0||offset+size>end)throw fail();};
  const u32=(offset:number,end=bytes.length)=>{check(offset,4,end);return view.getUint32(offset,true);};
  const integer64=(offset:number,end:number)=>{check(offset,8,end);const n=Number(view.getBigInt64(offset,true));if(!Number.isSafeInteger(n))throw fail();return n;};
  check(0,264);
  if(String.fromCharCode(...bytes.subarray(0,4))!=='OviO'||u32(12)!==105||integer64(24,bytes.length)!==bytes.length)throw fail();
  const datum=system==='auto'?'cgcs2000':system;
  const point=(lat:number,lng:number,alt?:number)=>{const p=importPoint(lng,lat,alt);p.coordinates=importCoordinate(p.coordinates,datum);return p;};
  let objects=0;
  const object=(start:number,end:number)=>{
    if(++objects>2100)throw new Error('OVOBJ对象过多');
    check(start,64,end);
    const length=u32(start+16,end),type=u32(start+20,end),body=start+64;
    if(body+length!==end)throw fail();
    const revision=u32(body,end);
    if(type===7){
      // v104 nameless point frame is known from an independent three-point export.
      // Other layouts are rejected instead of guessing offsets or losing their geometry.
      if(revision!==104||length!==101||bytes.subarray(body+96,end).some(b=>b!==0))throw fail();
      result.pin(undefined,point(view.getFloat64(body+64,true),view.getFloat64(body+72,true)));
      return;
    }
    if(!((type===8&&revision===103)||(type===13&&revision===104)))throw fail();
    let at=body+(type===8?100:200);
    const text=()=>{check(at,1,end);const size=bytes[at++];if(size===255)throw fail();check(at,size,end);let value:string;
      try{value=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(at,at+size));}catch{throw fail();}at+=size;return value;};
    const name=text(),note=text();
    // Extended point attributes are not silently discarded; known geometry-only frames use zero.
    if(u32(at,end)!==0)throw fail();at+=4;
    const count=integer64(at,end);at+=8;
    if(count<1||count>6000)throw new Error('OVOBJ点数无效或超过6000点');
    let lat=integer64(at,end),lng=integer64(at+8,end);at+=16;
    const points=[point(lat/1e8,lng/1e8)];
    for(let i=1;i<count;i++){
      check(at,1,end);const header=bytes[at++],n=(header>>2)&15;
      if(n>9)throw fail();check(at,n,end);
      let value=BigInt(header&3);for(let j=0;j<n;j++)value=(value<<BigInt(8))|BigInt(bytes[at++]);
      const bits=BigInt(n*4+1),dx=Number(value>>bits),dy=Number(value&((BigInt(1)<<bits)-BigInt(1)));
      lat+=(header&128)?-dx:dx;lng+=(header&64)?-dy:dy;
      points.push(point(lat/1e8,lng/1e8));
    }
    if(at!==end)throw fail();
    if(type===8)result.track(name,[points]);else result.area(name,points,note);
  };
  const kind=u32(244),length=integer64(248,bytes.length),start=264;
  if(start+length!==bytes.length)throw fail();
  if(kind===31)object(start,bytes.length);
  else if(kind===100){
    let at=start;
    while(at<bytes.length){const length=u32(at),type=u32(at+4);at+=8;if(type!==31)throw fail();check(at,length);object(at,at+length);at+=length;}
  }else throw fail();
  if(system==='auto')result.data.importWarnings=['OVOBJ 坐标基准未确认，暂按 WGS84；如有偏移，可在上方坐标设置中更改。'];
  return result.finish();
}
