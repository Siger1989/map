import { OfflineProgress } from './OfflineProgress';
import { useEffect, useMemo, useState } from 'react';
import type { MapSource } from '../mapSources/types';
import type { DownloadArea } from './downloadPlan';
import { planImportedRouteDownload } from './importedRouteDownload';
import { canDownloadTrip } from './offlineDownloadPolicy';
import type { useOffline } from './useOffline';
import './offlineRegion.css';
export type OfflineDownloadTarget = {
  name: string;
  area: Extract<DownloadArea, { kind: 'route' }>;
  source: MapSource;
};
const zoomChoices = (source: MapSource) => Number.isInteger(source.minzoom) && Number.isInteger(source.maxzoom) && source.maxzoom >= source.minzoom && source.minzoom >= 0 && source.maxzoom <= 24
  ? Array.from({ length: source.maxzoom - source.minzoom + 1 }, (_, index) => source.minzoom + index)
  : [];
const initialZoom = (source: MapSource) => {
  const choices = zoomChoices(source);
  return choices.includes(14) ? 14 : choices.find((z) => z > 14) ?? choices[choices.length - 1] ?? 14;
};
export function OfflineDownload({
  target,
  offline,
  onClose,
  onManage,
}: {
  target: OfflineDownloadTarget;
  offline: ReturnType<typeof useOffline>;
  onClose: () => void;
  onManage: () => void;
}) {
  const [zoom, setZoom] = useState(() => initialZoom(target.source)),
    [bufferKm, setBufferKm] = useState(1),
    [started, setStarted] = useState(false);
  useEffect(() => setZoom(initialZoom(target.source)), [target.source.id]);
  const area = useMemo(
    () => ({ ...target.area, bufferKm }),
    [target.area, bufferKm],
  );
  const result = useMemo(() => {
    try {
      return {
        plan: planImportedRouteDownload(area, target.source, zoom),
        error: '',
      };
    } catch (e) {
      return { plan: null, error: (e as Error).message };
    }
  }, [area, target.source, zoom]);
  const zoomOptions = zoomChoices(target.source);
  return (
    <section className="offline-download-dock" aria-label="下载当前地图">
      <header>
        <strong title={target.name}>
          下载沿线地图
        </strong>
        <button aria-label="关闭下载窗口" onClick={onClose}>
          ×
        </button>
      </header>
      <small
        className="offline-download-source"
        title={`${target.name} · ${target.source.name}`}
      >
        {target.name} · {target.source.name}
      </small>
      {!started ? (
        <>
          <small>只下载已导入图源的路线走廊瓦片；沿线断开的路段分别计算。</small>
          <label>
            路线两侧
            <select
              aria-label="沿线覆盖宽度"
              value={bufferKm}
              onChange={(e) => setBufferKm(Number(e.target.value))}
            >
              {[0.5, 1, 2].map((k) => (
                <option key={k} value={k}>各 {k} 公里</option>
              ))}
            </select>
          </label>
          <label>
            最高级别
            <select
              aria-label="路线瓦片最高级别"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            >
              {zoomOptions.map((z) => <option key={z} value={z}>{target.source.minzoom}–{z} 级</option>)}
            </select>
          </label>
          <small>下载按单个请求顺序执行；图源服务额度与使用规则仍适用。</small>
          <small role="status">
            {result.error ||
              `预计 ${result.plan!.count} 次瓦片请求 · 约 ${(result.plan!.estimatedBytes / 1048576).toFixed(0)} MB，实际可能不同`}
          </small>
          <button
            className="offline-download-primary"
            disabled={offline.busy || !result.plan}
            onClick={() => {
              if (!result.plan) return;
              setStarted(true);
              void offline.createImportedRoute(target.name, area, target.source, zoom);
            }}
          >
            {result.plan ? '开始下载' : '当前无法下载'}
          </button>
        </>
      ) : (
        <>
          {offline.current && <OfflineProgress trip={offline.current} />}
          <p role="status">
            {offline.busy
              ? `${offline.message}；按服务额度顺序下载，请保持页面打开。`
              : offline.message}
          </p>
          <div>
            <button onClick={onManage}>在收藏夹查看</button>
            {offline.busy ? (
              <button onClick={offline.pause}>暂停</button>
            ) : (
              <><button disabled={!offline.current || offline.current.complete || offline.current.provider !== 'imported' || !canDownloadTrip(offline.current)} onClick={()=>offline.current && void offline.resume(offline.current)}>继续下载</button><button onClick={() => setStarted(false)}>返回设置</button></>
            )}
          </div>
        </>
      )}
    </section>
  );
}
