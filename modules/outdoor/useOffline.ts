import { nativeOffline, nativeOfflineState, applyNativeProgress } from './nativeOffline';
import { useEffect, useRef, useState } from 'react';
import type { Coordinate } from '../navigation/types';
import {
  downloadTrip,
  prepareTrip,
  prepareRegion,
  removeTrip,
  tripPackages,
  putTrip,
  verifyTrip,
  type TripPackage,
  prepareMapPackage, type DownloadProvider,
} from './offline';
import type { DownloadArea } from './downloadPlan';
import type { LayerSettings } from '../map/types';
export function useOffline() {
  const [packages, setPackages] = useState<TripPackage[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [current, setCurrent] = useState<TripPackage|null>(null);
  const task = useRef<AbortController | null>(null);
  const activeId = useRef<string | null>(null);
  const deleting = useRef(new Set<string>());
  const [removing, setRemoving] = useState<string[]>([]);
  const remove = async (trip: TripPackage) => {
    if(deleting.current.has(trip.id))return;
    deleting.current.add(trip.id);setRemoving([...deleting.current]);
    try {
      if(activeId.current===trip.id) task.current?.abort();
      const bridge=nativeOffline();
      const state=nativeOfflineState();
      if(bridge && state.id===trip.id)bridge.offlinePause();
      const deadline=Date.now()+35000;
      while(activeId.current===trip.id && task.current) {
        if(Date.now()>deadline)throw Error('正在停止下载，请稍后重试移除');
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(bridge && state.id===trip.id) {
        while(!bridge.offlineRemove(trip.id)) {
          if(Date.now()>deadline)throw Error('下载尚未停止或删除失败，请稍后重试');
          await new Promise(resolve=>setTimeout(resolve,200));
        }
      }
      await removeTrip(trip);
      setCurrent(value=>value?.id===trip.id?null:value);
      if(activeId.current===trip.id || state.id===trip.id)setBusy(false);
      setMessage('离线包已移除，原路线保留');
    } catch(e) {setMessage((e as Error).message);}
    finally {deleting.current.delete(trip.id);setRemoving([...deleting.current]);setPackages(tripPackages());}
  };
  useEffect(() => {
    setPackages(tripPackages());
    let nativeSignature="";
    const syncNative=()=>{
      if(!nativeOffline())return;
      const state=nativeOfflineState(),trip=tripPackages().find(t=>t.id===state.id);if(!trip || deleting.current.has(trip.id))return;
      const signature=JSON.stringify(state);if(signature===nativeSignature)return;nativeSignature=signature;
      const next=applyNativeProgress(trip,state);putTrip(next);setPackages(tripPackages());setCurrent(next);
      if(!task.current)setBusy(['queued','running','waiting'].includes(state.state??''));
      setMessage(state.state==='waiting' ? '等待网络恢复，已下载内容保留' : state.error || (next.complete?'缓存完成':state.state==='running' || state.state==='queued'?'后台缓存中':'已下载内容保留，可继续'));
    };
    syncNative();const timer=setInterval(syncNative,1000);
    return () => {clearInterval(timer);if(!nativeOffline())task.current?.abort();};
  }, []);
  const run = async (work: (signal: AbortSignal) => Promise<unknown>) => {
    if (task.current) return;
    if(deleting.current.size){setMessage('正在移除缓存，请稍候');return;}
    const controller = new AbortController();
    task.current = controller;
    setBusy(true);
    setMessage('');
    try {
      await work(controller.signal);
      setMessage('完成');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      task.current = null;
      activeId.current = null;
      setBusy(false);
      setPackages(tripPackages());
    }
  };
  const download = (trip: TripPackage, signal: AbortSignal) => {
    // Keep the retry target even if native startup fails before its first update.
    activeId.current=trip.id;
    setCurrent(trip);
    return downloadTrip(trip, signal, (progress) => {
      if(deleting.current.has(trip.id))return;
      setPackages(tripPackages());
      setCurrent(progress);
      setMessage(`${progress.done}/${progress.urls.length} 项 · ${(progress.bytes / 1048576).toFixed(1)} MB`);
    });
  };
  return {
    packages,
    removing,
    current,
    background: !!nativeOffline(),
    busy,
    message,
    createMap: (name: string, area: DownloadArea, settings: LayerSettings, provider: DownloadProvider, zoom: number) => run(async signal => {
      const trip=await prepareMapPackage(name,area,settings,provider,zoom,signal);
      await download(trip,signal);
    }),
    createRegion: (name: string, bounds: TripPackage['bounds'], zoom: number) => run(async signal => {
      const trip = await prepareRegion(name, bounds, signal, zoom);
      await download(trip, signal);
    }),
    create: (name: string, points: Coordinate[]) =>
      run(async (signal) => {
        const trip = await prepareTrip(name, points, signal);
        await download(trip, signal);
      }),
    resume: (trip: TripPackage) => deleting.current.has(trip.id) ? Promise.resolve() : run((signal) => download(trip, signal)),
    verify: (trip: TripPackage) => deleting.current.has(trip.id) ? Promise.resolve() : run(() => {activeId.current=trip.id;return verifyTrip(trip);}),
    remove,
    pause: () => {if(nativeOffline())nativeOffline()!.offlinePause();task.current?.abort();},
  };
}
