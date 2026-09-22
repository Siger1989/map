import type { Map as LibreMap, ImageSource, RasterTileSource } from 'maplibre-gl';
import { cachedMapFetch } from '../outdoor/tileCache';
import { detailPatch } from './detailPatch';
const ID = 'shantu-fixed-detail';
const report=(message:string)=>window.dispatchEvent(new CustomEvent('shantu-raster-detail',{detail:message}));
/** Same-provider overview plus a bounded exact-level centre, draped by the existing map. */
export class RasterDetailPatch {
  private sourceId = '';
  private level: number | null = null;
  private key = '';
  private abort: AbortController | null = null;
  private disposed = false;
  constructor(private map: LibreMap) { map.on('moveend', this.update); }
  sync(sourceId:string, level:number|null) {
    if(sourceId===this.sourceId && level===this.level) return;
    this.clear(); report(''); this.sourceId=sourceId; this.level=level; void this.update();
  }
  private clear() {
    this.abort?.abort(); this.abort=null; this.key='';
    if(this.map.getLayer(ID))this.map.removeLayer(ID);
    if(this.map.getSource(ID))this.map.removeSource(ID);
  }
  private update = async () => {
    if(this.disposed || this.level===null || !this.sourceId)return;
    const source=this.map.getSource(this.sourceId) as RasterTileSource|undefined;
    const template=source?.tiles?.[0]; if(!source || !template)return;
    const center=this.map.getCenter(), bounds=this.map.getBounds(), patch=detailPatch(center.lng,center.lat,this.level,[bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()]);
    const key=`${this.sourceId}/${patch.key}/${template}`;
    if(this.key===key)return;
    this.abort?.abort(); const controller=new AbortController();this.abort=controller;this.key=key;
    const canvas=document.createElement('canvas');canvas.width=patch.width*256;canvas.height=patch.height*256;
    const context=canvas.getContext('2d');if(!context)return;
    report('正在加载固定级别影像…');
    let cursor=0, completed=0;
    try {
      await Promise.all(Array.from({length:2},async()=>{
        while(cursor<patch.tiles.length && !controller.signal.aborted) {
          const tile=patch.tiles[cursor++];
          const url=template.replace('{z}',String(tile.z)).replace('{x}',String(tile.x)).replace('{y}',String(source.scheme==='tms'?2**tile.z-tile.y-1:tile.y)).replace('{ratio}','');
          const response=await cachedMapFetch(url,controller.signal);if(!response.ok)throw Error('高清瓦片暂缺');
          const bitmap=await createImageBitmap(await response.blob());
          try {context.drawImage(bitmap,tile.col*256,tile.row*256,256,256);completed++;} finally {bitmap.close();}
        }
      }));
      if(controller.signal.aborted || this.disposed || completed!==patch.tiles.length)return;
      const url=canvas.toDataURL('image/png');
      const image=this.map.getSource(ID) as ImageSource|undefined;
      if(image)image.updateImage({url,coordinates:patch.coordinates});
      else {
        const layers=this.map.getStyle().layers;
        const index=layers.findLastIndex(l=>'source' in l && l.source===this.sourceId);
        if(index<0)return;
        this.map.addSource(ID,{type:'image',url,coordinates:patch.coordinates});
        this.map.addLayer({id:ID,type:'raster',source:ID,paint:{'raster-fade-duration':0}},layers[index+1]?.id);
      }
      report(patch.fullViewport ? '当前视野已使用固定级别' : '中心固定级别，外围同源概览');
    } catch { if(!controller.signal.aborted){this.key='';controller.abort();report('高清暂缺，当前使用已加载影像；移动地图可重试');} /* Keep the overview when offline/outside cache. */ }
  };
  dispose() { this.disposed=true;this.map.off('moveend',this.update);this.clear(); }
}
