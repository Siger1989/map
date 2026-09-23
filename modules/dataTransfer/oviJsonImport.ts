import { RouteBuilder, importPoint } from './routeBuilder.ts';
import { importCoordinate, type ImportCoordinates } from './coordinateSystem.ts';

export function parseOviJson(value: unknown, filename: string, system: ImportCoordinates) {
  const result=new RouteBuilder(filename);
  const root=value as {ObjItems?:unknown};
  if(!Array.isArray(root?.ObjItems))throw new Error('OVJSN缺少ObjItems对象列表');
  for(const item of root.ObjItems){
    const obj=item?.Object,detail=obj?.ObjectDetail,type=obj?.Type??item?.Type;
    if(!obj||!detail||![7,8,13].includes(type))throw new Error('此OVJSN含尚未识别的对象结构，未部分导入');
    const selected:ImportCoordinates=system!=='auto'?system:detail.Gcj02===1?'gcj02':detail.Gcj02===0?'cgcs2000':'auto';
    const p=(lat:unknown,lng:unknown,alt?:unknown)=>{const point=importPoint(lng,lat,alt);point.coordinates=importCoordinate(point.coordinates,selected);return point;};
    if(type===7)result.pin(obj.Name,p(detail.Lat,detail.Lng,detail.Altitude),typeof obj.Comment==='string'?obj.Comment:'');
    else{
      if(!Array.isArray(detail.Latlng)||detail.Latlng.length%2)throw new Error('OVJSN经纬度数组不完整');
      const points=[];for(let i=0;i<detail.Latlng.length;i+=2)points.push(p(detail.Latlng[i],detail.Latlng[i+1]));
      if(type===8)result.track(obj.Name,[points]);else result.area(obj.Name,points,typeof obj.Comment==='string'?obj.Comment:'');
    }
  }
  return result.finish();
}
