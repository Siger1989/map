/** A bounded high-resolution centre: at most 144 tiles, even at world zoom. */
export function detailPatch(lng: number, lat: number, level: number, bounds?: [number,number,number,number]) {
  const n = 2 ** level, size = Math.min(12, n);
  const cx = Math.floor((lng + 180) / 360 * n);
  const cy = Math.floor((1 - Math.asinh(Math.tan(Math.max(-85.051, Math.min(85.051, lat)) * Math.PI / 180)) / Math.PI) / 2 * n);
  let left = Math.max(0, Math.min(n-size, cx-Math.floor(size/2))), top = Math.max(0, Math.min(n-size, cy-Math.floor(size/2)));
  let width=size,height=size,fullViewport=false;
  const tileY=(lat:number)=>Math.floor((1-Math.asinh(Math.tan(Math.max(-85.051,Math.min(85.051,lat))*Math.PI/180))/Math.PI)/2*n);
  if(bounds && bounds[2]>=bounds[0] && bounds[0]>=-180 && bounds[2]<=180) {
    const west=Math.max(0,Math.floor((bounds[0]+180)/360*n)),east=Math.min(n-1,Math.floor((bounds[2]+180)/360*n));
    const north=Math.max(0,tileY(bounds[3])),south=Math.min(n-1,tileY(bounds[1]));
    if(east>=west && south>=north && east-west+1<=16 && south-north+1<=16 && (east-west+1)*(south-north+1)<=144){fullViewport=true;left=west;top=north;width=east-west+1;height=south-north+1;}
  }
  const point = (x:number,y:number):[number,number] => [x/n*360-180, Math.atan(Math.sinh(Math.PI*(1-2*y/n)))*180/Math.PI];
  return { key:`${level}/${left}/${top}/${width}/${height}`, width,height,fullViewport, coordinates:[point(left,top),point(left+width,top),point(left+width,top+height),point(left,top+height)] as [[number,number],[number,number],[number,number],[number,number]],
    tiles:Array.from({length:width*height},(_,i)=>({x:left+i%width,y:top+Math.floor(i/width),z:level,col:i%width,row:Math.floor(i/width)})) };
}
