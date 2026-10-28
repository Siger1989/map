import type { TripPackage } from './offline';
import { resourceFetchUrl } from './tiandituCache.ts';
import { canDownloadTrip, TIANDITU_OFFLINE_DISABLED } from './offlineDownloadPolicy.ts';
import { macBridge, macRequest, macSnapshot } from '../platform/macNative.ts';
type State = { id?:string; done?:number; bytes?:number; total?:number; state?:string; error?:string };
type Bridge = {
  offlineStart(raw:string):string; offlineState():string; offlinePause():void;
  offlineHas(url:string):boolean; offlineVerify(id:string):string; offlineRemove(id:string):boolean;
  offlineCapabilities?():string; offlineAvailableBytes?():number;
  offlineExportLegacyArchive?():string;
  offlineBegin?(id:string,name:string,total:number):string;
  offlineAppend?(id:string,offset:number,urls:string):string;
  offlineCommit?(id:string):string; offlineDiscard?(id:string):void;
};
export function nativeOffline():Bridge|null {
  const bridge=typeof window!=='undefined' ? (window as unknown as {GuanyunNative?:Bridge}).GuanyunNative : undefined;
  return bridge?.offlineStart ? bridge : null;
}
export function canExportLegacyOfflineArchive() { return !!nativeOffline()?.offlineExportLegacyArchive; }
export function requestLegacyOfflineArchiveExport() {
  const bridge=nativeOffline();
  if(!bridge?.offlineExportLegacyArchive)throw new Error('当前APK没有旧版缓存导出入口，请先更新到带导出功能的旧版应用');
  const result=bridge.offlineExportLegacyArchive();
  if(result!=='started')throw new Error(result||'旧版缓存导出未能启动');
  return result;
}
export function isNativeOfflineAvailable() { return !!macBridge() || !!nativeOffline(); }
function decodeState(raw: unknown): State {
  try { return typeof raw === 'string' ? JSON.parse(raw) : (raw && typeof raw === 'object' ? raw as State : {}); }
  catch { return {}; }
}
export function nativeOfflineState():State {
  if (macBridge()) return decodeState(macSnapshot('offline'));
  try{return JSON.parse(nativeOffline()?.offlineState()??'{}');}catch{return {};}
}
export async function readNativeOfflineState():Promise<State> {
  if (macBridge()) return decodeState(await macRequest('offline.state'));
  return nativeOfflineState();
}
export async function nativeOfflineHas(url:string):Promise<boolean> {
  if (macBridge()) return await macRequest<boolean>('offline.has',{url});
  return nativeOffline()?.offlineHas(url) ?? false;
}
export async function nativeOfflineRead(url:string):Promise<Response|null> {
  if (!macBridge()) return null;
  const value = await macRequest<unknown>('offline.read',{url});
  if (value === null) return null;
  if (!value || typeof value !== 'object') throw new Error('macOS 离线瓦片返回无效');
  const result=value as {base64?:unknown;mime?:unknown};
  if(typeof result.base64!=='string'||typeof result.mime!=='string')throw new Error('macOS 离线瓦片返回无效');
  const bytes=Uint8Array.from(atob(result.base64),char=>char.charCodeAt(0));
  return new Response(bytes,{status:200,headers:{'Content-Type':result.mime}});
}
export async function nativeOfflineAvailableBytes():Promise<number|undefined> {
  if(macBridge()) {
    const value=await macRequest<unknown>('offline.availableBytes');
    return typeof value==='number'&&Number.isFinite(value)&&value>=0?value:undefined;
  }
  const value=nativeOffline()?.offlineAvailableBytes?.();
  return typeof value==='number'&&Number.isFinite(value)&&value>=0?value:undefined;
}
export async function nativeOfflineVerify(id:string):Promise<State> {
  if(macBridge())return decodeState(await macRequest('offline.verify',{id}));
  const bridge=nativeOffline();return bridge?decodeState(bridge.offlineVerify(id)):{};
}
export async function nativeOfflineRemove(id:string):Promise<boolean> {
  if(macBridge())return await macRequest<boolean>('offline.remove',{id});
  return nativeOffline()?.offlineRemove(id) ?? true;
}
export async function nativeOfflinePause() {
  if(macBridge()) { await macRequest('offline.pause'); return; }
  nativeOffline()?.offlinePause();
}
/** Old APKs expose disabled compatibility methods: presence alone is not support. */
export function nativeRouteOffline():Bridge|null {
  if (macBridge()) return null;
  const bridge = nativeOffline();
  try {
    const capability = JSON.parse(bridge?.offlineCapabilities?.() ?? '{}');
    return capability.version >= 2 && capability.imported === true && capability.chunked === true &&
      bridge?.offlineBegin && bridge.offlineAppend && bridge.offlineCommit && bridge.offlineDiscard ? bridge : null;
  } catch { return null; }
}
/** Keep existing foreground partial packages in their original cache without re-downloading. */
export function canUseNativeRouteDownload(trip: TripPackage): boolean {
  return macBridge() ? true : !!nativeRouteOffline() && (trip.native === true || trip.done === 0);
}
export function applyNativeProgress(trip:TripPackage,state:State):TripPackage {
  if(state.id!==trip.id)return trip;
  const done=Math.min(trip.urls.length,Math.max(0,state.done??trip.done));
  return {...trip, native:true, done, bytes:Math.max(0,state.bytes??trip.bytes),complete:done===trip.urls.length};
}
export async function downloadNative(trip:TripPackage, signal:AbortSignal, progress:(trip:TripPackage)=>void) {
  if(!canDownloadTrip(trip))throw Error(TIANDITU_OFFLINE_DISABLED);
  if(macBridge()) {
    const start=await macRequest<unknown>('offline.begin',{id:trip.id,name:trip.name,total:trip.urls.length});
    if(start!=='ok')throw Error(typeof start==='string'?start:'macOS 离线任务启动失败');
    try {
      for(let offset=0;offset<trip.urls.length;offset+=1000) {
        signal.throwIfAborted();
        const result=await macRequest<unknown>('offline.append',{id:trip.id,offset,urls:trip.urls.slice(offset,offset+1000)});
        if(result!=='ok')throw Error(typeof result==='string'?result:'macOS 离线清单写入失败');
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      signal.throwIfAborted();
      const committed=await macRequest<unknown>('offline.commit',{id:trip.id});
      if(committed!=='ok')throw Error(typeof committed==='string'?committed:'macOS 离线任务提交失败');
    } catch(error) {
      await macRequest('offline.discard',{id:trip.id}).catch(()=>{});
      if(signal.aborted)await nativeOfflinePause();
      throw Error(signal.aborted?'下载已暂停，可继续':(error as Error)?.message||'macOS 离线任务启动失败');
    }
    progress({...trip,native:true});
    while(!signal.aborted) {
      const state=await readNativeOfflineState();
      if(state.id===trip.id) {
        progress(applyNativeProgress(trip,state));
        if(state.state==='complete')return true;
        if(state.state==='paused'||state.state==='cancelled')throw Error(state.error||'下载已暂停，可继续');
        if(state.state==='error'||state.error)throw Error(state.error||'macOS 离线下载失败');
      }
      await new Promise(resolve=>setTimeout(resolve,700));
    }
    await nativeOfflinePause();
    throw Error('下载已暂停，可继续');
  }
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
