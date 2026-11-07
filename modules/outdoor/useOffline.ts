import { nativeRouteOffline, canUseNativeRouteDownload, applyNativeProgress, isNativeOfflineAvailable, readNativeOfflineState, nativeOfflinePause } from './nativeOffline';
import { hydrateTripPackages, loadTripManifest } from './tripStorage';
import { useEffect, useRef, useState } from 'react';
import type { Coordinate } from '../navigation/types';
import {
  downloadTrip,
  prepareImportedRoutePackage,
  removeTrip,
  tripPackages,
  putTrip,
  persistTripPlanningTask,
  verifyTrip,
  type TripPackage,
  type DownloadProvider,
} from './offline';
import type { DownloadArea } from './downloadPlan';
import { downloadBounds } from './downloadPlan';
import type { ImportedDownloadArea } from './importedRouteDownload';
import type { LayerSettings } from '../map/types';
import { canDownloadTrip, TIANDITU_OFFLINE_DISABLED } from './offlineDownloadPolicy';
import { fetchOnlineMapTile } from '../mapSources/tileTransport';
import type { MapSource } from '../mapSources/types';
import { readMap } from '../mapSources/storage';
import { createImportedPlanningTrip, importedTaskPhase } from './offlineTaskState';
export function useOffline() {
  const [packages, setPackages] = useState<TripPackage[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [current, setCurrent] = useState<TripPackage|null>(null);
  const task = useRef<AbortController | null>(null);
  const activeId = useRef<string | null>(null);
  const activeProvider = useRef<TripPackage['provider']>(null);
  const activeNative = useRef(false);
  const deleting = useRef(new Set<string>());
  const [removing, setRemoving] = useState<string[]>([]);
  const remove = async (trip: TripPackage) => {
    if(deleting.current.has(trip.id))return;
    deleting.current.add(trip.id);setRemoving([...deleting.current]);
    try {
      if(activeId.current===trip.id) task.current?.abort();
      const state=await readNativeOfflineState();
      if(isNativeOfflineAvailable() && state.id===trip.id)await nativeOfflinePause();
      const deadline=Date.now()+35000;
      while(activeId.current===trip.id && task.current) {
        if(Date.now()>deadline)throw Error('正在停止下载，请稍后重试移除');
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(isNativeOfflineAvailable() && state.id===trip.id) {
        while(['queued','running','waiting','downloading'].includes((await readNativeOfflineState()).state ?? '')) {
          if(Date.now()>deadline)throw Error('下载尚未停止或删除失败，请稍后重试');
          await new Promise(resolve=>setTimeout(resolve,200));
        }
      }
      let wasSelected = false;
      try { wasSelected = localStorage.getItem('shantu.offline-package.v1') === trip.id; } catch {}
      await removeTrip(trip);
      if (wasSelected) window.dispatchEvent(new Event('shantu:offline-map-mode'));
      setCurrent(value=>value?.id===trip.id?null:value);
      if(activeId.current===trip.id || state.id===trip.id)setBusy(false);
      setMessage('离线包已移除，原路线保留');
    } catch(e) {setMessage((e as Error).message);}
    finally {deleting.current.delete(trip.id);setRemoving([...deleting.current]);setPackages(tripPackages());}
  };
  useEffect(() => {
    let alive=true;
    void hydrateTripPackages().then(items=>{
      const recovered = items.map((trip) => {
        if (trip.phase !== 'preparing' || trip.urls.length) return trip;
        const next = { ...trip, phase: 'failed' as const, phaseMessage: `上次${trip.areaBoundary ? '区域' : '路线'}规划未完成；可从收藏中继续规划` };
        putTrip(next);
        return next;
      });
      if(alive)setPackages(recovered);
    }).catch(error=>{if(alive)setMessage((error as Error).message);});
    let nativeSignature="";
    let syncing=false;
    const syncNative=async()=>{
      if(!isNativeOfflineAvailable())return;
      if (task.current || syncing) return;
      const state=await readNativeOfflineState(),stored=tripPackages().find(t=>t.id===state.id);if(!stored || deleting.current.has(stored.id))return;
      const signature=JSON.stringify(state);if(signature===nativeSignature)return;
      syncing=true;
      try {
      const trip=await loadTripManifest(stored);
      if(!alive || deleting.current.has(trip.id) || !tripPackages().some(item=>item.id===trip.id))return;
      if (!canDownloadTrip(trip) && ['queued','running','waiting','downloading'].includes(state.state ?? '')) {
        await nativeOfflinePause();
        setBusy(false);setMessage(TIANDITU_OFFLINE_DISABLED);
        return;
      }
      nativeSignature=signature;
      const phase = importedTaskPhase(state.state);
      const nativeTrip = applyNativeProgress(trip,state);
      const next={...nativeTrip, ...(phase ? { phase } : {})};
      putTrip(next);setPackages(tripPackages());setCurrent(next);
       if(!task.current)setBusy(['queued','running','waiting','downloading'].includes(state.state??''));
       setMessage(state.state==='waiting' ? '等待网络恢复，已下载内容保留' : state.error || (next.complete?'缓存完成':state.state==='running' || state.state==='queued' || state.state==='downloading'?'缓存中':'已下载内容保留，可继续'));
      } catch(error) {if(alive)setMessage((error as Error).message);}
      finally {syncing=false;}
    };
    syncNative();const timer=setInterval(syncNative,1000);
    return () => {alive=false;clearInterval(timer);if(!activeNative.current)task.current?.abort();};
  }, []);
  const run = async (work: (signal: AbortSignal) => Promise<unknown>) => {
    if (task.current) return;
    if (['queued','running','waiting','downloading'].includes((await readNativeOfflineState()).state ?? '')) {setMessage('已有后台缓存正在下载，请先暂停');return;}
    if(deleting.current.size){setMessage('正在移除缓存，请稍候');return;}
    const controller = new AbortController();
    task.current = controller;
    setBusy(true);
    setMessage('');
    try {
      await work(controller.signal);
      setMessage('完成');
    } catch (e) {
      const reason = (e as Error).message || '路线缓存失败';
      const saved = activeId.current ? tripPackages().find((trip) => trip.id === activeId.current) : current ?? undefined;
      if (saved?.provider === 'imported' && !saved.complete) {
        const phase: TripPackage['phase'] = controller.signal.aborted ? 'paused' : 'failed';
        const next = { ...saved, phase, phaseMessage: reason };
        putTrip(next);setCurrent(next);setPackages(tripPackages());
      }
      setMessage(reason);
    } finally {
      task.current = null;
      activeId.current = null;
      activeProvider.current = null;
      activeNative.current = false;
      setBusy(false);
      setPackages(tripPackages());
    }
  };
  const download = (trip: TripPackage, signal: AbortSignal) => {
    // Keep the retry target even if native startup fails before its first update.
    activeId.current=trip.id;
    activeProvider.current=trip.provider;
    activeNative.current=isNativeOfflineAvailable() && (window.ShantuMac?.version === 1 || (trip.provider === 'imported' && canUseNativeRouteDownload(trip)));
    const queued = { ...trip, phase: trip.complete ? 'complete' as const : 'running' as const, phaseMessage: trip.complete ? '缓存完成' : '缓存中' };
    putTrip(queued);setPackages(tripPackages());setCurrent(queued);
    return downloadTrip(trip, signal, (progress) => {
      if(deleting.current.has(trip.id))return;
      const next = { ...progress, phase: progress.phase ?? (progress.complete ? 'complete' as const : 'running' as const), phaseMessage: progress.phaseMessage ?? (progress.complete ? '缓存完成' : '缓存中') };
      putTrip(next);setPackages(tripPackages());
      setCurrent(next);
      setMessage(`${progress.done}/${progress.urls.length} 项 · ${(progress.bytes / 1048576).toFixed(1)} MB`);
    }, trip.provider === 'imported' ? fetchOnlineMapTile : undefined);
  };
  return {
    packages,
    removing,
    current,
    background: isNativeOfflineAvailable() && (!current || window.ShantuMac?.version === 1 || canUseNativeRouteDownload(current)),
    busy,
    message,
    createMap: (_name: string, _area: DownloadArea, _settings: LayerSettings, _provider: DownloadProvider, _zoom: number) => {
      setMessage('新离线下载仅支持已导入图源的路线走廊');
      return Promise.resolve();
    },
    createImportedRoute: (name: string, area: ImportedDownloadArea, source: MapSource, zoom: number, routeNames?: readonly string[]) => run(async signal => {
      activeProvider.current='imported';
      if (tripPackages().length >= 8) throw new Error('已达 8 个离线包，请先移除不用的包');
      const id = crypto.randomUUID();
      const placeholder: TripPackage = area.kind === 'route'
        ? createImportedPlanningTrip(id, name, area, source, zoom, routeNames)
        : {
          id,
          name: `${name.trim().slice(0, 30) || '区域'} · ${source.name}`.slice(0, 60),
          bounds: downloadBounds(area),
          urls: [],
          done: 0,
          bytes: 0,
          createdAt: Date.now(),
          complete: false,
          provider: 'imported',
          sourceId: source.id,
          sourceName: source.name,
          datum: source.datum ?? 'wgs84',
          zoom,
          areaBoundary: area.boundary.map(point => [...point] as Coordinate),
          phase: 'preparing',
          phaseMessage: '正在规划区域缓存…',
        };
      activeId.current = id;
      await persistTripPlanningTask(placeholder);setPackages(tripPackages());setCurrent(placeholder);setMessage(area.kind === 'polygon' ? '正在规划区域缓存…' : '正在规划路线缓存…');
      const trip=await prepareImportedRoutePackage(name,area,source,zoom,signal,routeNames,id);
      setPackages(tripPackages());setCurrent(trip);
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
      return deleting.current.has(trip.id) ? Promise.resolve() : run(async (signal) => {
        activeId.current = trip.id;
        activeProvider.current = trip.provider;
        if (!trip.urls.length) {
          const area: ImportedDownloadArea | null = trip.areaBoundary?.length
            ? { kind: 'polygon', boundary: trip.areaBoundary }
            : trip.routeSegments?.length
              ? { kind: 'route', segments: trip.routeSegments, bufferKm: trip.bufferKm ?? 4 }
              : null;
          if (!trip.sourceId || !area) throw new Error('该规划任务缺少路线或区域边界信息，无法继续；请重新选择缓存范围');
          const source = await readMap(trip.sourceId);
          if (!source || source.kind !== 'online') throw new Error('导入图源已移除，无法继续规划该缓存');
          const suffix = ` · ${source.name}`;
          const name = trip.name.endsWith(suffix) ? trip.name.slice(0, -suffix.length) : trip.name;
          const prepared = await prepareImportedRoutePackage(name, area, source, trip.zoom ?? 14, signal, trip.routeNames, trip.id);
          setPackages(tripPackages());setCurrent(prepared);
          await download(prepared, signal);
          return;
        }
        await download(trip, signal);
      });
    },
    verify: (trip: TripPackage) => deleting.current.has(trip.id) ? Promise.resolve() : run(() => {activeId.current=trip.id;return verifyTrip(trip);}),
    remove,
    pause: () => {if(activeNative.current || current?.native)void nativeOfflinePause();task.current?.abort();},
  };
}
