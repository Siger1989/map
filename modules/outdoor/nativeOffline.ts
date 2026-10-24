import type { TripPackage } from './offline';
import { resourceFetchUrl } from './tiandituCache.ts';
import { canDownloadTrip, TIANDITU_OFFLINE_DISABLED } from './offlineDownloadPolicy.ts';
type State = { id?:string; done?:number; bytes?:number; total?:number; state?:string; error?:string };
type Bridge = {
  offlineStart(raw:string):string; offlineState():string; offlinePause():void;
  offlineHas(url:string):boolean; offlineVerify(id:string):string; offlineRemove(id:string):boolean;
  offlineCapabilities?():string; offlineAvailableBytes?():number;
  offlineBegin?(id:string,name:string,total:number):string;
  offlineAppend?(id:string,offset:number,urls:string):string;
  offlineCommit?(id:string):string; offlineDiscard?(id:string):void;
};
export function nativeOffline():Bridge|null {
  const bridge=typeof window!=='undefined' ? (window as unknown as {GuanyunNative?:Bridge}).GuanyunNative : undefined;
  return bridge?.offlineStart ? bridge : null;
}
/** Old APKs expose disabled compatibility methods: presence alone is not support. */
export function nativeRouteOffline():Bridge|null {
  const bridge = nativeOffline();
  try {
    const capability = JSON.parse(bridge?.offlineCapabilities?.() ?? '{}');
    return capability.version >= 2 && capability.imported === true && capability.chunked === true &&
      bridge?.offlineBegin && bridge.offlineAppend && bridge.offlineCommit && bridge.offlineDiscard ? bridge : null;
  } catch { return null; }
}
/** Keep existing foreground partial packages in their original cache without re-downloading. */
export function canUseNativeRouteDownload(trip: TripPackage): boolean {
  return !!nativeRouteOffline() && (trip.native === true || trip.done === 0);
}
export function nativeOfflineState():State {
  try{return JSON.parse(nativeOffline()?.offlineState()??'{}');}catch{return {};}
}
export function applyNativeProgress(trip:TripPackage,state:State):TripPackage {
  if(state.id!==trip.id)return trip;
  const done=Math.min(trip.urls.length,Math.max(0,state.done??trip.done));
  return {...trip, native:true, done, bytes:Math.max(0,state.bytes??trip.bytes),complete:done===trip.urls.length};
}
export async function downloadNative(trip:TripPackage, signal:AbortSignal, progress:(trip:TripPackage)=>void) {
  if(!canDownloadTrip(trip))throw Error(TIANDITU_OFFLINE_DISABLED);
  const bridge=trip.provider === 'imported' ? nativeRouteOffline() : nativeOffline();if(!bridge)return false;
  let message:string;
  signal.throwIfAborted();
  try {
    if (trip.provider === 'imported') {
      message = bridge.offlineBegin!(trip.id,trip.name,trip.urls.length);
      if (message !== 'ok') throw new Error(message);
      try {
        for (let offset=0;offset<trip.urls.length;offset+=1000) {
          signal.throwIfAborted();
          message=bridge.offlineAppend!(trip.id,offset,JSON.stringify(trip.urls.slice(offset,offset+1000)));
          if (message !== 'ok') throw new Error(message);
          // Give paint and pause controls time between bridge chunks.
          await new Promise(resolve=>setTimeout(resolve,0));
        }
        signal.throwIfAborted();
        message=bridge.offlineCommit!(trip.id);
      } catch (error) { bridge.offlineDiscard!(trip.id); throw error; }
    } else message=bridge.offlineStart(JSON.stringify({id:trip.id,name:trip.name,urls:trip.urls.map(resourceFetchUrl)}));
  } catch (error) { throw Error(signal.aborted ? '下载已暂停，可继续' : (error as Error)?.message || '后台下载启动失败，任务已保留，请点击继续下载重试'); }
  if(message!=='ok')throw Error(message);
  progress({...trip,native:true});
  const pause=()=>bridge.offlinePause();signal.addEventListener('abort',pause,{once:true});
  if(signal.aborted)pause();
  try {
    // Native service owns retries and writes. JS polling is only a foreground view.
    while(!signal.aborted) {
      const state=nativeOfflineState();
      if(state.id===trip.id){progress(applyNativeProgress(trip,state));if(state.state==='complete')return true;if(state.state==='paused'||state.state==='cancelled')throw Error(state.error||'下载已暂停，可继续');}
      await new Promise(resolve=>setTimeout(resolve,700));
    }
    throw Error('下载已暂停，可继续');
  }finally{signal.removeEventListener('abort',pause);}
}
