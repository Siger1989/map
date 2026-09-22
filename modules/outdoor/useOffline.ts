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
  useEffect(() => {
    setPackages(tripPackages());
    let nativeSignature="";
    const syncNative=()=>{
      if(!nativeOffline())return;
      const state=nativeOfflineState(),trip=tripPackages().find(t=>t.id===state.id);if(!trip)return;
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
      setBusy(false);
      setPackages(tripPackages());
    }
  };
  const download = (trip: TripPackage, signal: AbortSignal) =>
    downloadTrip(trip, signal, (progress) => {
      setPackages(tripPackages());
      setCurrent(progress);
      setMessage(`${progress.done}/${progress.urls.length} 项 · ${(progress.bytes / 1048576).toFixed(1)} MB`);
    });
  return {
    packages,
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
    resume: (trip: TripPackage) => run((signal) => download(trip, signal)),
    verify: (trip: TripPackage) => run(() => verifyTrip(trip)),
    remove: (trip: TripPackage) => run(() => removeTrip(trip)),
    pause: () => {if(nativeOffline())nativeOffline()!.offlinePause();task.current?.abort();},
  };
}
