import type { TripPackage } from './offline';
import { resourceFetchUrl } from './tiandituCache.ts';
import { canDownloadTrip, TIANDITU_OFFLINE_DISABLED } from './offlineDownloadPolicy.ts';
type State = { id?:string; done?:number; bytes?:number; total?:number; state?:string; error?:string };
type Bridge = { offlineStart(raw:string):string; offlineState():string; offlinePause():void; offlineHas(url:string):boolean; offlineVerify(id:string):string; offlineRemove(id:string):boolean };
export function nativeOffline():Bridge|null {
  const bridge=typeof window!=='undefined' ? (window as unknown as {GuanyunNative?:Bridge}).GuanyunNative : undefined;
  return bridge?.offlineStart ? bridge : null;
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
  const bridge=nativeOffline();if(!bridge)return false;
  let message:string;
  try { message=bridge.offlineStart(JSON.stringify({id:trip.id,name:trip.name,urls:trip.urls.map(resourceFetchUrl)})); }
  catch { throw Error('后台下载启动失败，任务已保留，请点击继续下载重试'); }
  if(message!=='ok')throw Error(message);
  const pause=()=>bridge.offlinePause();signal.addEventListener('abort',pause,{once:true});
  try {
    // Native service owns retries and writes. JS polling is only a foreground view.
    while(!signal.aborted) {
      const state=nativeOfflineState();
      if(state.id===trip.id){progress(applyNativeProgress(trip,state));if(state.state==='complete')return true;if(state.state==='paused')throw Error(state.error||'下载已暂停，可继续');}
      await new Promise(resolve=>setTimeout(resolve,700));
    }
    throw Error('下载已暂停，可继续');
  }finally{signal.removeEventListener('abort',pause);}
}
