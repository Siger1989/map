import { useMemo, useState } from 'react';
import type { LayerSettings } from '../map/types';
import type { DownloadArea } from './downloadPlan';
import { mapDownloadPlan, type DownloadProvider } from './offline';
import { tiandituBase, TIANDITU_LAYERS } from '../cartography/tianditu';
import type { useOffline } from './useOffline';
import './offlineRegion.css';
export type OfflineDownloadTarget = {
  name: string;
  area: DownloadArea;
  provider: DownloadProvider;
  settings: LayerSettings;
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
  const [zoom, setZoom] = useState(14),
    [bufferKm, setBufferKm] = useState(10),
    [started, setStarted] = useState(false);
  const area = useMemo(
    () =>
      target.area.kind === 'route' ? { ...target.area, bufferKm } : target.area,
    [target.area, bufferKm],
  );
  const result = useMemo(() => {
    try {
      return {
        plan: mapDownloadPlan(area, target.settings, target.provider, zoom),
        error: '',
      };
    } catch (e) {
      return { plan: null, error: (e as Error).message };
    }
  }, [area, target.settings, target.provider, zoom]);
  const source =
    target.provider === 'tianditu'
      ? `天地图${TIANDITU_LAYERS[tiandituBase(target.settings)].name}`
      : '开源道路地形';
  const max =
    target.provider === 'tianditu'
      ? TIANDITU_LAYERS[tiandituBase(target.settings)].maxzoom
      : 14;
  return (
    <section className="offline-download-dock" aria-label="下载当前地图">
      <header>
        <strong title={target.name}>
          {target.area.kind === 'route' ? '下载沿线地图' : '下载当前区域'}
        </strong>
        <button aria-label="关闭下载窗口" onClick={onClose}>
          ×
        </button>
      </header>
      <small
        className="offline-download-source"
        title={`${target.name} · ${source}`}
      >
        {target.name} · {source}
      </small>
      {!started ? (
        <>
          {target.area.kind === 'route' && (
            <label>
              路线两侧
              <select
                aria-label="沿线覆盖宽度"
                value={bufferKm}
                onChange={(e) => setBufferKm(Number(e.target.value))}
              >
                {[5, 10, 20].map((k) => (
                  <option key={k} value={k}>
                    各 {k} 公里
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            清晰度
            <select
              aria-label="离线清晰度"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            >
              {[12, 14, 16, 18]
                .filter((z) => z <= max)
                .map((z) => (
                  <option key={z} value={z}>
                    {{ 12: '概览', 14: '标准', 16: '清晰', 18: '精细' }[z]} ·{' '}
                    {z}级
                  </option>
                ))}
            </select>
          </label>
          <small role="status">
            {result.error ||
              `${result.plan!.count}项 · 估计 ${(result.plan!.estimatedBytes / 1048576).toFixed(0)} MB，实际可能不同`}
          </small>
          <button
            className="offline-download-primary"
            disabled={!result.plan || offline.busy}
            onClick={() => {
              setStarted(true);
              void offline.createMap(
                target.name,
                area,
                target.settings,
                target.provider,
                zoom,
              );
            }}
          >
            下载地图{target.settings.labels ? '及注记' : ''}
            {target.settings.terrain ? '、地形' : ''}
          </button>
        </>
      ) : (
        <>
          <p role="status">
            {offline.busy
              ? `正在下载 ${offline.message}；可关闭窗口，请保持应用在前台。`
              : offline.message}
          </p>
          <div>
            <button onClick={onManage}>查看离线包</button>
            {offline.busy ? (
              <button onClick={offline.pause}>暂停</button>
            ) : (
              <button onClick={() => setStarted(false)}>返回设置</button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
