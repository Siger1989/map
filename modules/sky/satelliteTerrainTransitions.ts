import { coordinate, earthPosition, sampledSurfaceHeight, type Tile, type Vec3 } from './satelliteTerrainGeometry.ts';

interface Surface {
  tile:Tile; steps:number; samples:Float32Array; origin:Vec3; coarseDem:boolean;
}
type Point=[number,number,number];
interface Band { x:number; y:number; span:number; inset:number[]; triangles:number[]; bins:Map<number,number[]>; }
const period=131072;
const tileSpan=(z:number)=>2**(17-z);
const bin=(f:number)=>Math.min(15,Math.max(0,Math.floor(f*16)));
const sample=(mesh:Surface,x:number,y:number)=>{
  const span=tileSpan(mesh.tile.z), count=2**mesh.tile.z;
  let u=x/span-mesh.tile.x;
  if(u>count/2)u-=count;if(u< -count/2)u+=count;
  return sampledSurfaceHeight(mesh.samples,mesh.steps,u,y/span-mesh.tile.y);
};

export function sampleTransition(bands:Band[]|undefined,x:number,y:number) {
  if(!bands)return null;
  for(const b of bands) {
    const u=(x-b.x)/b.span,v=(y-b.y)/b.span;
    if(u<0||v<0||u>1||v>1||u>=b.inset[0]&&u<=1-b.inset[1]&&v>=b.inset[2]&&v<=1-b.inset[3])continue;
    const triangles=b.triangles;
    for(const i of b.bins.get(bin(v)*16+bin(u))??[]){
      const ax=triangles[i],ay=triangles[i+1],dx=u-ax,dy=v-ay;
      const ux=triangles[i+3]-ax,uy=triangles[i+4]-ay,vx=triangles[i+6]-ax,vy=triangles[i+7]-ay;
      const det=ux*vy-uy*vx;
      if(Math.abs(det)<1e-12)continue;
      const s=(dx*vy-dy*vx)/det,t=(ux*dy-uy*dx)/det;
      if(s>=-1e-7 && t>=-1e-7 && s+t<=1+1e-7)return triangles[i+2]*(1-s-t)+triangles[i+5]*s+triangles[i+8]*t;
    }
  }
  return null;
}

/** Replace the outer rows of the coarser patch with slope triangles. Their outside
 * edge follows the actual neighbouring grid, their inside edge follows the original
 * terrain and every vertex samples the image at its own geographic coordinate. */
export function buildTerrainTransitions<M extends Surface>(patches:{leaf:Tile;mesh:M}[]) {
  const rectangles=patches.map(p=>{
    const span=tileSpan(p.leaf.z);
    return {...p,span,x:p.leaf.x*span,y:p.leaf.y*span};
  });
  const sourceWins=(a:M,b:M)=>a.tile.z!==b.tile.z ? a.tile.z>b.tile.z :
    a.coarseDem!==b.coarseDem ? !a.coarseDem : a.tile.key>b.tile.key;
  const output:number[]=[], draws:{mesh:M;start:number;count:number}[]=[];
  const bands=new Map<M,Band[]>(), bounds=new Map<string,[number,number,number,number]>();
  const renderOrder=[...rectangles].sort((a,b)=>a.mesh.tile.key<b.mesh.tile.key?-1:a.mesh.tile.key>b.mesh.tile.key?1:0);
  for(const p of renderOrder){
    const m=p.mesh, sourceSpan=tileSpan(m.tile.z), step=sourceSpan/m.steps;
    const sides=Array.from({length:4},()=>({marks:new Set<number>([0,1]),neighbours:[] as {lo:number;hi:number;mesh:M}[],replace:false}));
    for(const q of rectangles){
      if(m===q.mesh)continue;
      let qx=q.x;if(qx-p.x>period/2)qx-=period;if(qx-p.x < -period/2)qx+=period;
      const side=qx+q.span===p.x ? 0 : qx===p.x+p.span ? 1 : q.y+q.span===p.y ? 2 : q.y===p.y+p.span ? 3 : -1;
      if(side<0)continue;
      const vertical=side<2, along=vertical?p.y:p.x, other=vertical?q.y:qx;
      const lo=Math.max(along,other),hi=Math.min(along+p.span,other+q.span);
      if(hi<=lo)continue;
      const data=sides[side],start=(lo-along)/p.span,end=(hi-along)/p.span;
      data.marks.add(start);data.marks.add(end);data.neighbours.push({lo:start,hi:end,mesh:q.mesh});
      if(!sourceWins(q.mesh,m))continue;
      // Equal-resolution meshes built from the same DEM already meet. Rebuild
      // an equal-level edge only if real samples on the two sides disagree.
      {
        const samples=Math.max(2,Math.ceil((hi-lo)/Math.min(step,tileSpan(q.mesh.tile.z)/q.mesh.steps)));
        let differs=false,valid=false;
        for(let n=0;n<=samples;n++){
          const coord=lo+(hi-lo)*n/samples;
          const x=vertical?(side===0?p.x:p.x+p.span):coord;
          const y=vertical?coord:(side===2?p.y:p.y+p.span);
          const delta=Math.abs(sample(m,x,y)-sample(q.mesh,x,y));
          if(Number.isFinite(delta))valid=true;
          if(delta>.06){differs=true;break;}
        }
        if(!valid || !differs && q.mesh.tile.z===m.tile.z)continue;
      }
      data.replace=true;
      const spacing=tileSpan(q.mesh.tile.z)/q.mesh.steps;
      for(let k=Math.floor(lo/spacing)+1;k*spacing<hi-1e-8;k++)data.marks.add((k*spacing-along)/p.span);
    }
    if(!sides.some(s=>s.replace))continue;
    // A transition has nonzero ground width, even when a parent covers a small leaf.
    // Two original rows give the coarser slope room to meet the neighbouring edge.
    const width=Math.min(.30,Math.max(.075,2*step/p.span));
    const inset=sides.map(s=>s.replace?width:0), [left,right,top,bottom]=inset;
    const sourceU=p.x/sourceSpan-m.tile.x,sourceV=p.y/sourceSpan-m.tile.y,scale=p.span/sourceSpan;
    const band:Band={x:p.x,y:p.y,span:p.span,inset,triangles:[],bins:new Map()};
    const corners=new Map<number,number>();
    const drawStart=output.length/5;
    const append=(a:Point,b:Point,c:Point,closure=false)=>{
      if(![a[2],b[2],c[2]].every(Number.isFinite))return;
      const index=band.triangles.length;
      const x0=bin(Math.min(a[0],b[0],c[0])),x1=bin(Math.max(a[0],b[0],c[0]));
      const y0=bin(Math.min(a[1],b[1],c[1])),y1=bin(Math.max(a[1],b[1],c[1]));
      for(let y=y0;!closure && y<=y1;y++)for(let x=x0;x<=x1;x++){
        const key=y*16+x, bucket=band.bins.get(key);
        if(bucket)bucket.push(index);else band.bins.set(key,[index]);
      }
      for(const v of [a,b,c]){
        const x=p.x+v[0]*p.span,y=p.y+v[1]*p.span,[lng,lat]=coordinate(x,y,17);
        const pos=earthPosition(lng,lat,v[2]);
        output.push(pos[0]-m.origin[0],pos[1]-m.origin[1],pos[2]-m.origin[2],x/sourceSpan-m.tile.x,y/sourceSpan-m.tile.y);
        if(!closure)band.triangles.push(...v);
      }
    };
    const latitude=coordinate(p.x+p.span/2,p.y+p.span/2,17)[1]*Math.PI/180;
    const spacingM=step*40_075_017*Math.cos(latitude)/period;
    const guard=Math.max(.6,Math.min(5,spacingM*.035));
    const closeEdge=(a:Point,b:Point)=>{
      // This lip descends only from the corrected physical surface. It closes
      // subpixel cracks without an intervening wall between two DEM heights.
      const lowA:Point=[a[0],a[1],a[2]-guard],lowB:Point=[b[0],b[1],b[2]-guard];
      append(a,lowA,b,true);append(b,lowA,lowB,true);
    };
    const height=(u:number,v:number,side:number,f:number,outer:boolean)=>{
      const x=p.x+u*p.span,y=p.y+v*p.span;
      let best=m;
      if(outer && (u===0||u===1) && (v===0||v===1)){
        const key=u+2*v,cached=corners.get(key);if(cached!==undefined)return cached;
        // Both side strips must meet at exactly the same height at a T-junction.
        // Include the diagonal participant when three or four resolutions meet.
        for(const q of rectangles){
          let qx=q.x;if(qx-x>period/2)qx-=period;if(qx-x < -period/2)qx+=period;
          if(x<qx||x>qx+q.span||y<q.y||y>q.y+q.span)continue;
          if(sourceWins(q.mesh,best))best=q.mesh;
        }
        const h=sample(best,x,y);corners.set(key,h);return h;
      }
      if(outer)for(const n of sides[side].neighbours){
        if(f>=n.lo-1e-8&&f<=n.hi+1e-8&&sourceWins(n.mesh,best))best=n.mesh;
      }
      return sample(best,x,y);
    };
    for(let side=0;side<4;side++){
      const data=sides[side];if(!data.replace)continue;
      const vertical=side<2, spacing=step/p.span;
      for(let f=spacing;f<1-1e-8;f+=spacing)data.marks.add(f);
      // The inside edge cuts through the source grid. Match both grid edges
      // and the native diagonal inside each quad, so the strip shares the
      // actual coarse polyline at its join with the unmodified core.
      const start=(vertical?p.y+top*p.span:p.x+left*p.span)/step;
      const span=(vertical?1-top-bottom:1-left-right)*p.span/step;
      const fixed=(vertical?p.x+(side===0?left:1-right)*p.span:p.y+(side===2?top:1-bottom)*p.span)/step;
      for(const offset of [start,start+fixed]){
        for(let k=Math.floor(offset)+1;k<offset+span-1e-8;k++)data.marks.add((k-offset)/span);
      }
      const marks=[...data.marks].sort((a,b)=>a-b);
      let oldOutside:Point|undefined,oldInside:Point|undefined;
      for(const f of marks){
        const ou=vertical?(side===0?0:1):f,ov=vertical?f:(side===2?0:1);
        const iu=vertical?(side===0?left:1-right):left+(1-left-right)*f;
        const iv=vertical?top+(1-top-bottom)*f:(side===2?top:1-bottom);
        const outside:Point=[ou,ov,height(ou,ov,side,f,true)],inside:Point=[iu,iv,height(iu,iv,side,f,false)];
        if(oldOutside&&oldInside){
          append(oldOutside,oldInside,outside);append(outside,oldInside,inside);
          if([oldOutside,oldInside,outside,inside].every(point=>Number.isFinite(point[2]))){
            closeEdge(oldOutside,outside);closeEdge(oldInside,inside);
          }
        }
        if(f===0||f===1)closeEdge(outside,inside);
        oldOutside=outside;oldInside=inside;
      }
    }
    if(output.length/5>drawStart){
      // The native triangles and transition meet in geographic space. Give
      // the clipped core a narrow overlap for ECEF and raster sample rounding.
      const overlap=.004;
      bounds.set(p.leaf.key,[sourceU+Math.max(0,left-overlap)*scale,sourceV+Math.max(0,top-overlap)*scale,
        sourceU+Math.min(1,1-right+overlap)*scale,sourceV+Math.min(1,1-bottom+overlap)*scale]);
      const count=output.length/5-drawStart,last=draws.at(-1);
      if(last?.mesh===m)last.count+=count;else draws.push({mesh:m,start:drawStart,count});
      const existing=bands.get(m);if(existing)existing.push(band);else bands.set(m,[band]);
    }
  }
  const visibleDraws=draws.map(draw=>{
    const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(let i=draw.start*5,end=(draw.start+draw.count)*5;i<end;i+=5){
      for(let c=0;c<3;c++){lo[c]=Math.min(lo[c],output[i+c]);hi[c]=Math.max(hi[c],output[i+c]);}
    }
    const center=lo.map((v,c)=>(v+hi[c])*.5+draw.mesh.origin[c]);
    const radius=Math.hypot(hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2])*.5+1;
    return {...draw,center,radius};
  });
  return {vertices:new Float32Array(output),draws:visibleDraws,bands,bounds};
}
