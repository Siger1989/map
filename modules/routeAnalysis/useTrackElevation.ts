import { useEffect, useMemo, useState } from 'react';
import type { ManualTrack } from '../tracks/drawing';
import { sampleTerrain } from '../journey/metrics';
import { readProfile } from '../journey/elevationProvider';
import { offlineMapOnly } from '../outdoor/tileCache';
import { finiteHeight } from './elevationColors';
import { withTerrainHeights } from './trackElevation';

/** Shared display-only terrain enrichment for map colours and the analysis panel. */
export function useTrackElevation(target: ManualTrack | null, enabled: boolean) {
  const key = useMemo(() => target ? JSON.stringify([target.id, target.segments, target.samples]) : '', [target?.id, target?.segments, target?.samples]);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; track: ManualTrack; estimated: boolean; error: string } | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled || !target || target.segments.every((line, part) => line.every((_, i) => finiteHeight(target.samples?.[part]?.[i]?.altitude)))) { setLoading(false); return; }
    const request = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      const parts = target.segments.map((line, part) => ({ line, part })).filter(({ line }) => line.length >= 2);
      const points = sampleTerrain(parts.map(({ line }) => line)).map(p => ({ ...p, part: parts[p.part].part }));
      void readProfile(points, request.signal).then(heights => {
        if (request.signal.aborted) return;
        const available = heights.filter(p => finiteHeight(p.elevation)).length;
        const error = available === heights.length && available > 0 ? '' : offlineMapOnly()
          ? '离线包缺少部分路线地形，请联网下载覆盖整条路线的地图包后重试。'
          : available > 0 ? '部分地形读取失败，缺测路段保留灰色，可重试。' : '地形高程读取失败，请检查网络后重试。';
        setResult({ key, track: withTerrainHeights(target, heights), estimated: available > 0, error });
      }).catch(() => {
        if (!request.signal.aborted) setResult({ key, track: target, estimated: false, error: '地形高程读取失败，请重试。' });
      }).finally(() => { if (!request.signal.aborted) setLoading(false); });
    }, 300);
    return () => { clearTimeout(timer); request.abort(); };
  }, [key, enabled, retry]);
  const current = result?.key === key ? result : null;
  return { data: current?.track ?? target, estimated: current?.estimated ?? false, elevationError: current?.error ?? '', loading, refresh: () => setRetry(v => v + 1) };
}
