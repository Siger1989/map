import { RouteBuilder, importPoint } from './routeBuilder.ts';

export function parseGeoJson(value: unknown, filename: string) {
  const result=new RouteBuilder(filename);
  let count=0;
  const list=(v: unknown): unknown[]=>{if(!Array.isArray(v))throw new Error('GeoJSON坐标或集合无效');return v;};
  const point=(v: unknown)=>{const a=list(v);if(a.length<2||a.length>3||a.some(n=>typeof n!=='number'))throw new Error('GeoJSON坐标必须为经度、纬度及可选高程');return importPoint(a[0],a[1],a[2]);};
  const line=(v: unknown)=>list(v).map(point);
  const visit=(v: unknown,name?:unknown,depth=0):void=>{
    if(depth>32||++count>10000)throw new Error('GeoJSON层级或对象过多');
    if(!v||typeof v!=='object')throw new Error('GeoJSON对象无效');
    const obj=v as Record<string,unknown>;
    if(obj.crs!==undefined){
      const crs=obj.crs as {properties?:{name?:string}};
      if(!['urn:ogc:def:crs:OGC:1.3:CRS84','urn:ogc:def:crs:EPSG::4326','EPSG:4326'].includes(crs?.properties?.name??''))throw new Error('GeoJSON坐标系尚未转换为WGS84');
    }
    switch(obj.type){
      case 'FeatureCollection':for(const f of list(obj.features))visit(f,name,depth+1);break;
      case 'Feature':{
        const props=obj.properties as Record<string,unknown>|null;
        if(obj.geometry===null)throw new Error('GeoJSON对象没有几何，未部分导入');
        visit(obj.geometry,props?.name??props?.title??name,depth+1);break;
      }
      case 'GeometryCollection':for(const g of list(obj.geometries))visit(g,name,depth+1);break;
      case 'Point':result.pin(name,point(obj.coordinates));break;
      case 'MultiPoint':for(const p of list(obj.coordinates))result.pin(name,point(p));break;
      case 'LineString':result.track(name,[line(obj.coordinates)]);break;
      case 'MultiLineString':result.track(name,list(obj.coordinates).map(line));break;
      case 'Polygon':case 'MultiPolygon':{
        const polygons=obj.type==='Polygon'?[obj.coordinates]:list(obj.coordinates);
        for(const polygon of polygons){const rings=list(polygon);if(rings.length!==1)throw new Error('带内洞的区域暂不能无损保存');result.area(name,line(rings[0]));}break;
      }
      default:throw new Error('GeoJSON几何类型无法识别');
    }
  };
  visit(value);return result.finish();
}
