import { useEffect, useRef, useState } from 'react';
import type { Coordinate } from '../navigation/types';
import {
  downloadTrip,
  prepareTrip,
  removeTrip,
  tripPackages,
  verifyTrip,
  type TripPackage,
} from './offline';
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
    downloadTrip(trip, signal, () => setPackages(tripPackages()));
  return {
    packages,
    busy,
    message,
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
