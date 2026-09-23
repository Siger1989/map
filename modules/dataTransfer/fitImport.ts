import { RouteBuilder, importPoint, type ImportPoint } from './routeBuilder.ts';

export async function parseFit(bytes: Uint8Array, filename: string) {
  // The lightweight raw reader validates CRC/framing without loading the full sensor profile.
  const {readFitMessages,readFitUnsignedField,readFitStringField,fitTimestampToUnixMilliseconds}=await import('fit-file-parser/raw');
  let data;
  try { data=readFitMessages(bytes,{messageNumbers:[0,20,21,31,32],maxInputBytes:8*1024*1024}); }
  catch { throw new Error('FIT内容截断、CRC校验失败或结构无效'); }
  if(data.issues.length)throw new Error('FIT时间字段无效，未部分导入');
  const result=new RouteBuilder(filename);
  let lastTime:number|null=null,part:ImportPoint[]=[],name=result.fallback;
  const parts:ImportPoint[][]=[];
  const cut=()=>{if(part.length)parts.push(part);part=[];};
  for(const message of data.messages){
    const field=(n:number)=>message.fields.find(f=>f.fieldNumber===n);
    const unsigned=(n:number,type:number,size:1|2|4)=>readFitUnsignedField(field(n),type,size,message.littleEndian);
    const coord=(n:number)=>{
      const f=field(n);if(!f)return undefined;
      if((f.baseType&31)!==5||f.size!==4)throw new Error('FIT坐标字段类型无效');
      const v=new DataView(f.bytes.buffer,f.bytes.byteOffset,4).getInt32(0,message.littleEndian);
      return v===0x7fffffff?undefined:v*180/2147483648;
    };
    if(message.globalMessageNumber===0){const type=unsigned(0,0,1);if(type!==4&&type!==6)throw new Error('FIT文件不是活动或路线文件');}
    if(message.globalMessageNumber===31)name=readFitStringField(field(5))||name;
    if(message.globalMessageNumber===21&&unsigned(0,0,1)===0&&[1,4,8,9].includes(unsigned(1,0,1)??-1))cut();
    if(message.globalMessageNumber!==20&&message.globalMessageNumber!==32)continue;
    const cp=message.globalMessageNumber===32;
    const lat=coord(cp?2:0),lng=coord(cp?3:1);
    if(lat===undefined||lng===undefined){if(!cp)cut();continue;}
    const elevation=cp?undefined:unsigned(78,6,4)??unsigned(2,4,2);
    const time=message.timestamp===undefined?undefined:fitTimestampToUnixMilliseconds(message.timestamp);
    const p=importPoint(lng,lat,elevation===undefined?undefined:elevation/5-500,time);
    if(cp){result.pin(readFitStringField(field(6)),p);continue;}
    if(p.time!==null&&lastTime!==null&&p.time<lastTime)cut();
    part.push(p);lastTime=p.time;
  }
  cut();if(parts.length)result.track(name,parts);
  return result.finish();
}
