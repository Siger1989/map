import { useEffect, useMemo, useState } from 'react';
import type {
  SkyObserver,
  SkyTimeInterval,
  SolarVisibility,
} from './astronomy';
import type { TerrainHorizon } from './terrainHorizon';

export function useSolarDay(
  day: SkyTimeInterval,
  observer: SkyObserver,
  terrain: TerrainHorizon | null,
) {
  const request = useMemo(
    () => ({
      day,
      observer,
      terrain: terrain?.status === 'unavailable' ? null : terrain,
    }),
    [day, observer, terrain],
  );
  type Result = { value: SolarVisibility; flatReference: boolean };
  const [result, setResult] = useState<{
    request: typeof request;
    data: Result | null;
  } | null>(null);
  useEffect(() => {
    const worker = new Worker(
      new URL('./skyEvents.worker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = ({ data }: MessageEvent<Result>) =>
      setResult({ request, data });
    worker.onerror = () => setResult({ request, data: null });
    worker.postMessage(request);
    return () => worker.terminate();
  }, [request]);
  return {
    done: result?.request === request,
    data: result?.request === request ? result.data : null,
  };
}
