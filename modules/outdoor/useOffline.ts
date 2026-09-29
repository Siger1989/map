import { nativeOffline, nativeOfflineState, applyNativeProgress } from './nativeOffline';
import { useEffect, useRef, useState } from 'react';
import type { Coordinate } from '../navigation/types';
import {
  downloadTrip,
  prepareImportedRoutePackage,
  removeTrip,
  tripPackages,
  putTrip,
  verifyTrip,
  type TripPackage,
  type DownloadProvider,
} from './offline';
import type { DownloadArea } from './downloadPlan';
import type { LayerSettings } from '../map/types';
import { canDownloadTrip, TIANDITU_OFFLINE_DISABLED } from './offlineDownloadPolicy';
import { fetchOnlineMapTile } from '../mapSources/tileTransport';
import type { MapSource } from '../mapSources/types';
export function useOffline() {
  const [packages, setPackages] = useState<TripPackage[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [current, setCurrent] = useState<TripPackage|null>(null);
  const task = useRef<AbortController | null>(null);
  const activeId = useRef<string | null>(null);
  const activeProvider = useRef<TripPackage['provider']>(null);
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
      if (task.current && activeProvider.current === 'imported') return;
      const state=nativeOfflineState(),trip=tripPackages().find(t=>t.id===state.id);if(!trip || deleting.current.has(trip.id))return;
      if (!canDownloadTrip(trip) && ['queued','running','waiting'].includes(state.state ?? '')) {
        nativeOffline()?.offlinePause();
        setBusy(false);setMessage(TIANDITU_OFFLINE_DISABLED);
        return;
      }
      const signature=JSON.stringify(state);if(signature===nativeSignature)return;nativeSignature=signature;
      const next=applyNativeProgress(trip,state);putTrip(next);setPackages(tripPackages());setCurrent(next);
      if(!task.current)setBusy(['queued','running','waiting'].includes(state.state??''));
      setMessage(state.state==='waiting' ? '等待网络恢复，已下载内容保留' : state.error || (next.complete?'缓存完成':state.state==='running' || state.state==='queued'?'后台缓存中':'已下载内容保留，可继续'));
    };
    syncNative();const timer=setInterval(syncNative,1000);
    return () => {clearInterval(timer);if(!nativeOffline() || activeProvider.current === 'imported')task.current?.abort();};
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
      activeProvider.current = null;
      setBusy(false);
      setPackages(tripPackages());
    }
  };
  const download = (trip: TripPackage, signal: AbortSignal) => {
    // Keep the retry target even if native startup fails before its first update.
    activeId.current=trip.id;
    activeProvider.current=trip.provider;
    setCurrent(trip);
    return downloadTrip(trip, signal, (progress) => {
      if(deleting.current.has(trip.id))return;
      setPackages(tripPackages());
      setCurrent(progress);
      setMessage(`${progress.done}/${progress.urls.length} 项 · ${(progress.bytes / 1048576).toFixed(1)} MB`);
    }, trip.provider === 'imported' ? fetchOnlineMapTile : undefined);
  };
  return {
    packages,
    removing,
    current,
    background: !!nativeOffline() && current?.provider !== 'imported',
    busy,
    message,
    createMap: (_name: string, _area: DownloadArea, _settings: LayerSettings, _provider: DownloadProvider, _zoom: number) => {
      setMessage('新离线下载仅支持已导入图源的路线走廊');
      return Promise.resolve();
    },
    createImportedRoute: (name: string, area: Extract<DownloadArea, { kind: 'route' }>, source: MapSource, zoom: number) => run(async signal => {
      activeProvider.current='imported';
      setCurrent(null);
      const trip=await prepareImportedRoutePackage(name,area,source,zoom,signal);
      await download(trip,signal);
    }),
    createRegion: (_name: string, _bounds: TripPackage['bounds'], _zoom: number) => {
      setMessage('新离线下载仅支持已导入图源的路线走廊');
      return Promise.resolve();
    },
    create: (_name: string, _points: Coordinate[]) => {
      setMessage('新离线下载仅支持已导入图源的路线走廊');
      return Promise.resolve();
    },
    resume: (trip: TripPackage) => {
      if (trip.provider !== 'imported') {
        setMessage('旧版整区下载已停止续传；已有数据仍可查看或移除');
        return Promise.resolve();
      }
      return deleting.current.has(trip.id) ? Promise.resolve() : run((signal) => download(trip, signal));
    },
    verify: (trip: TripPackage) => deleting.current.has(trip.id) ? Promise.resolve() : run(() => {activeId.current=trip.id;return verifyTrip(trip);}),
    remove,
    pause: () => {if(activeProvider.current !== 'imported' && nativeOffline())nativeOffline()!.offlinePause();task.current?.abort();},
  };
}
