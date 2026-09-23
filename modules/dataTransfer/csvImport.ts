import { RouteBuilder, importPoint, type ImportPoint } from './routeBuilder.ts';

/** RFC4180 quoting, comma/semicolon/tab; columns must identify coordinates. */
export function parseCsv(text: string, filename: string) {
  const headerLine=text.split(/\r?\n/)[0];
  const delimiter=headerLine.includes('\t')?'\t':headerLine.includes(';')?';':',';
  const rows:string[][]=[];let row:string[]=[],value='',quoted=false,closed=false;
  for(let i=0;i<=text.length;i++){
    const c=text[i]??'\n';
    if(quoted){if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=c;continue;}
    if(c==='"'){if(value||closed)throw new Error('CSV引号格式无效');quoted=true;}
    else if(c===delimiter||c==='\n'||c==='\r'){
      row.push(value.trim());value='';closed=false;
      if(c!==delimiter){if(row.some(Boolean))rows.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++;}
    }else {if(closed&&c.trim())throw new Error('CSV引号后有无效字符');value+=c;}
  }
  if(quoted)throw new Error('CSV引号未闭合');
  const header=rows.shift()?.map(s=>s.toLowerCase().replace(/[\s_（）()]/g,''))??[];
  const column=(names:string[])=>{const matches=header.map((h,i)=>names.includes(h)?i:-1).filter(i=>i>=0);if(matches.length>1)throw new Error('CSV坐标字段重复');return matches[0]??-1;};
  const lng=column(['longitude','lon','lng','经度','经度°']),lat=column(['latitude','lat','纬度','纬度°']);
  if(lng<0||lat<0)throw new Error('CSV需包含经度/纬度列（longitude/latitude或lon/lat），不猜测X/Y或无表头坐标');
  const alt=column(['altitude','elevation','ele','海拔','高程','海拔m','高程m']);
  const time=column(['time','timestamp','时间']),name=column(['name','名称','路线名称']),segment=column(['segment','segmentid','分段']);
  const crs=column(['crs','坐标系']),kind=column(['type','类型']);
  const result=new RouteBuilder(filename);const tracks=new Map<string,ImportPoint[][]>();
  let previousName='',previousSegment='';
  for(const r of rows){
    if(r.length!==header.length)throw new Error('CSV列数与表头不一致');
    if(crs>=0&&!['wgs84','epsg:4326',''].includes(r[crs].toLowerCase().replace(/\s/g,'')))throw new Error('CSV当前需WGS84经纬度');
    const p=importPoint(r[lng],r[lat],alt<0?undefined:r[alt],time<0?undefined:r[time]);
    const label=name<0?result.fallback:r[name]||result.fallback;
    const type=kind<0?'track':r[kind].toLowerCase();
    if(['point','waypoint','标记','点'].includes(type)){result.pin(label,p);previousName='';continue;}
    if(!['track','route','轨迹','路线',''].includes(type))throw new Error('CSV类型需为track/point或路线/标记');
    let parts=tracks.get(label);if(!parts){parts=[];tracks.set(label,parts);}
    const s=segment<0?'':r[segment];
    if(!parts.length||previousName!==label||previousSegment!==s)parts.push([]);
    parts.at(-1)!.push(p);previousName=label;previousSegment=s;
  }
  for(const [name,parts] of tracks)result.track(name,parts);
  return result.finish();
}
