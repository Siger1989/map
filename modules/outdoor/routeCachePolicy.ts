export type TileCoordinate = { z: number; x: number; y: number };

type Segment = { ax:number; ay:number; bx:number; by:number; minX:number; maxX:number; minY:number; maxY:number };
type Node = { minX:number; maxX:number; minY:number; maxY:number; left?:Node; right?:Node; items?:Segment[] };
const MAX_ZOOM=24, MAX_PREFETCH_ZOOM=20, MAX_ROUTE_CANDIDATES=12000, CAMERA_RADIUS_KM=25;
const finiteCoord=(p:readonly number[])=>p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;
const clampLat=(lat:number)=>Math.max(-85.05112878,Math.min(85.05112878,lat));
const wrapLon=(lon:number)=>((lon+180)%360+360)%360-180;
const mercY=(lat:number)=>{const r=clampLat(lat)*Math.PI/180;return (1-Math.asinh(Math.tan(r))/Math.PI)/2;};
const invMercY=(y:number)=>Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI;
const tileKey=(t:TileCoordinate)=>`${t.z}/${t.x}/${t.y}`;

function buildSegments(points:readonly (readonly number[])[]):Segment[] {
  const result:Segment[]=[]; let prev:readonly number[]|undefined;
  for(const p of points){
    if(!finiteCoord(p)){prev=undefined;continue;}
    if(prev){const ax=prev[0], bx=ax+(((p[0]-ax+540)%360)-180), ay=clampLat(prev[1]), by=clampLat(p[1]);
      result.push({ax,ay,bx,by,minX:Math.min(ax,bx),maxX:Math.max(ax,bx),minY:Math.min(ay,by),maxY:Math.max(ay,by)});
    }
    prev=p;
  }
  return result;
}
function buildTree(items:Segment[]):Node|undefined {
  if(!items.length)return undefined;
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const s of items){minX=Math.min(minX,s.minX);maxX=Math.max(maxX,s.maxX);minY=Math.min(minY,s.minY);maxY=Math.max(maxY,s.maxY);}
  const node:Node={minX,maxX,minY,maxY};
  if(items.length<=12){node.items=items;return node;}
  const axis=(maxX-minX)>((maxY-minY)*2)?'x':'y';
  items.sort((a,b)=>axis==='x'?((a.minX+a.maxX)-(b.minX+b.maxX)):((a.minY+a.maxY)-(b.minY+b.maxY)));
  const mid=items.length>>1;node.left=buildTree(items.slice(0,mid));node.right=buildTree(items.slice(mid));return node;
}
function nearSegment(s:Segment,lon:number,lat:number,bufferKm:number):boolean {
  const cos=Math.max(0.01,Math.cos(lat*Math.PI/180)), scaleX=111.32*cos, scaleY=110.574;
  const ax=(s.ax-lon)*scaleX, ay=(s.ay-lat)*scaleY, bx=(s.bx-lon)*scaleX, by=(s.by-lat)*scaleY;
  const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
  const t=den?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/den)):0;
  return Math.hypot(ax+t*dx,ay+t*dy)<=bufferKm;
}

/** Builds a route-corridor predicate. It indexes route segments once, then prunes by bounds per tile. */
export function makeRouteTilePriority(points:readonly (readonly number[])[],bufferKm=1):(tile:TileCoordinate)=>boolean {
  const tree=buildTree(buildSegments(points)), buffer=Math.max(0,Number.isFinite(bufferKm)?bufferKm:1);
  return tile=>{
    if(!tree||!Number.isInteger(tile.z)||tile.z<0||tile.z>MAX_ZOOM||!Number.isInteger(tile.x)||!Number.isInteger(tile.y))return false;
    const n=2**tile.z;if(tile.x<0||tile.x>=n||tile.y<0||tile.y>=n)return false;
    const lon=tile.x/n*360-180+180/n, lat=invMercY((tile.y+0.5)/n);
    const halfTileKm=Math.hypot(20037.5/n*Math.max(.01,Math.cos(lat*Math.PI/180)),20037.5/n);
    const effectiveBuffer=buffer+halfTileKm;
    const dLat=effectiveBuffer/110.574+180/n, dLon=effectiveBuffer/(111.32*Math.max(.01,Math.cos(lat*Math.PI/180)))+180/n;
    const tileSouth=invMercY((tile.y+1)/n),tileNorth=invMercY(tile.y/n);
    const overlaps=(node:Node,shift:number)=>node.maxX+shift>=lon-dLon&&node.minX+shift<=lon+dLon&&node.maxY>=tileSouth-buffer/110.574&&node.minY<=tileNorth+buffer/110.574;
    const visit=(node:Node,shift:number):boolean=>{
      if(!overlaps(node,shift))return false;
      if(node.items)return node.items.some(s=>nearSegment(s,lon-shift,lat,effectiveBuffer));
      return (!!node.left&&visit(node.left,shift))|| (!!node.right&&visit(node.right,shift));
    };
    return visit(tree,-360)||visit(tree,0)||visit(tree,360);
  };
}

/** Returns at most `limit` route-adjacent tiles near the camera for bounded idle warmup. */
export function routeCacheTiles(points:readonly (readonly number[])[],center:[number,number],zoom:number,bufferKm=1,limit=48):TileCoordinate[] {
  if(!finiteCoord(center)||!Number.isFinite(zoom)||limit<=0)return [];
  const z=Math.max(0,Math.min(MAX_PREFETCH_ZOOM,Math.floor(zoom))),n=2**z,buf=Math.max(0,Number.isFinite(bufferKm)?bufferKm:1);
  const cameraLon=center[0],cameraLat=clampLat(center[1]),radius=CAMERA_RADIUS_KM+buf;
  const routePriority=makeRouteTilePriority(points,buf);
  const metersPerTileX=40075016.686/n*Math.max(.01,Math.cos(cameraLat*Math.PI/180));
  const metersPerTileY=40075016.686/n;
  const stepTiles=Math.max(.15,Math.min(.45,Math.sqrt(Math.max(1,buf*1000)/metersPerTileX)));
  const radiusX=(radius*1000)/metersPerTileX+1, radiusY=(radius*1000)/metersPerTileY+1;
  const found=new Map<string,{tile:TileCoordinate;distance:number}>();let work=0;
  const addAt=(lon:number,lat:number)=>{
    const wrapped=wrapLon(lon), xFloat=(wrapped+180)/360*n, yFloat=mercY(lat)*n;
    const cx=Math.floor(xFloat),cy=Math.floor(yFloat);
    const rx=Math.ceil(buf*1000/metersPerTileX)+1,ry=Math.ceil(buf*1000/metersPerTileY)+1;
    for(let dy=-ry;dy<=ry;dy++)for(let dx=-rx;dx<=rx;dx++){
      if(++work>MAX_ROUTE_CANDIDATES)return;
      const x=((cx+dx)%n+n)%n,y=cy+dy;if(y<0||y>=n)continue;
      const tileCenterLon=(x+.5)/n*360-180,tileCenterLat=invMercY((y+.5)/n);
      const dlat=(tileCenterLat-cameraLat)*110.574, dlon=(((tileCenterLon-cameraLon+540)%360)-180)*111.32*Math.cos(cameraLat*Math.PI/180);
      if(Math.hypot(dlat,dlon)>radius)continue;
      const tile={z,x,y};if(routePriority(tile))found.set(tileKey(tile),{tile,distance:Math.hypot(dlat,dlon)});
    }
  };
  const segments=buildSegments(points);
  for(const s of segments){
    if(work>=MAX_ROUTE_CANDIDATES)break;
    // Clip each segment to the camera circle before densifying, even for continent-scale routes.
    const scaleX=111.32*Math.max(.01,Math.cos(cameraLat*Math.PI/180)),scaleY=110.574;
    const ax=(s.ax-cameraLon)*scaleX,ay=(s.ay-cameraLat)*scaleY;
    const bx=(s.bx-cameraLon)*scaleX,by=(s.by-cameraLat)*scaleY,dx=bx-ax,dy=by-ay;
    const aa=dx*dx+dy*dy,bb=2*(ax*dx+ay*dy),cc=ax*ax+ay*ay-radius*radius;
    const disc=bb*bb-4*aa*cc;if(!aa||disc<0)continue;
    const root=Math.sqrt(disc),t0=Math.max(0,(-bb-root)/(2*aa)),t1=Math.min(1,(-bb+root)/(2*aa));
    if(t0>t1)continue;
    const lonAt=(t:number)=>s.ax+(s.bx-s.ax)*t,latAt=(t:number)=>s.ay+(s.by-s.ay)*t;
    const startLon=lonAt(t0),endLon=lonAt(t1),startLat=latAt(t0),endLat=latAt(t1);
    const clippedAx=(startLon-cameraLon)*scaleX,clippedAy=(startLat-cameraLat)*scaleY;
    const clippedBx=(endLon-cameraLon)*scaleX,clippedBy=(endLat-cameraLat)*scaleY;
    const clippedDx=clippedBx-clippedAx,clippedDy=clippedBy-clippedAy;
    const lengthTiles=Math.hypot((endLon-startLon)*n/360,(mercY(endLat)-mercY(startLat))*n);
    const steps=Math.max(1,Math.ceil(lengthTiles/stepTiles));
    const nearestT=Math.max(0,Math.min(1,-(clippedAx*clippedDx+clippedAy*clippedDy)/Math.max(1e-12,clippedDx*clippedDx+clippedDy*clippedDy)));
    const nearestIndex=Math.round(nearestT*steps);
    // Visit closest samples first so a bounded global work budget favors camera-adjacent tiles.
    for(let offset=0;offset<=steps&&work<MAX_ROUTE_CANDIDATES;offset++){
      const indices=offset===0?[nearestIndex]:[nearestIndex+offset,nearestIndex-offset];
      for(const i of indices){if(i<0||i>steps||work>=MAX_ROUTE_CANDIDATES)continue;const t=i/steps;addAt(startLon+(endLon-startLon)*t,startLat+(endLat-startLat)*t);}
    }
  }
  return [...found.values()].sort((a,b)=>a.distance-b.distance).slice(0,Math.min(48,Math.floor(limit))).map(v=>v.tile);
}

/** Extracts only tile URL layouts whose coordinate order is known. */
export function tileFromUrl(raw:string):TileCoordinate|undefined {
  let url:URL;try{url=new URL(raw,'https://tile.invalid');}catch{return undefined;}
  const params=url.searchParams, matrix=params.get('TILEMATRIX'),col=params.get('TILECOL'),row=params.get('TILEROW');
  if(matrix!==null&&col!==null&&row!==null){const t={z:Number(matrix),x:Number(col),y:Number(row)};return validTile(t)?t:undefined;}
  let path:string;try{path=decodeURIComponent(url.pathname).replace(/\/+$/,'');}catch{return undefined;}
  const terrain=path.match(/\/api\/terrain\/(\d+)\/(\d+)\/(\d+)\.png$/i);
  if(terrain){const t={z:+terrain[1],x:+terrain[2],y:+terrain[3]};return validTile(t)?t:undefined;}
  const eox=path.match(/\/GoogleMapsCompatible\/(\d+)\/(\d+)\/(\d+)\.(?:jpg|jpeg|png|webp)$/i);
  if(eox){const t={z:+eox[1],x:+eox[3],y:+eox[2]};return validTile(t)?t:undefined;}
  const nasa=path.match(/\/GoogleMapsCompatible_Level\d+\/(\d+)\/(\d+)\/(\d+)\.(?:jpg|jpeg|png|webp)$/i);
  if(nasa){const t={z:+nasa[1],x:+nasa[3],y:+nasa[2]};return validTile(t)?t:undefined;}
  const xyz=path.match(/\/(\d+)\/(\d+)\/(\d+)\.[a-z0-9]+$/i);
  if(xyz){const t={z:+xyz[1],x:+xyz[2],y:+xyz[3]};return validTile(t)?t:undefined;}
  return undefined;
}
function validTile(t:TileCoordinate){if(!Number.isInteger(t.z)||t.z<0||t.z>MAX_ZOOM)return false;const n=2**t.z;return Number.isInteger(t.x)&&Number.isInteger(t.y)&&t.x>=0&&t.x<n&&t.y>=0&&t.y<n;}
