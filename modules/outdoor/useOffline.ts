import { useEffect, useRef, useState } from 'react';
import type { Coordinate } from '../navigation/types';
import {
  downloadTrip,
  prepareTrip,
  prepareRegion,
  removeTrip,
  tripPackages,
  verifyTrip,
  type TripPackage,
  prepareMapPackage, type DownloadProvider,
} from './offline';
import type { DownloadArea } from './downloadPlan';
import type { LayerSettings } from '../map/types';
export function useOffline() {
  const [packages, setPackages] = useState<TripPackage[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const task = useRef<AbortController | null>(null);
  useEffect(() => {
    setPackages(tripPackages());
    return () => task.current?.abort();
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
      setMessage(`${progress.done}/${progress.urls.length} 项 · ${(progress.bytes / 1048576).toFixed(1)} MB`);
    });
  return {
    packages,
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
    pause: () => task.current?.abort(),
  };
}
