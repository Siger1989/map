import type { Coordinate } from '../navigation/types';
import type { useOffline } from './useOffline';
import { OfflineRoutingPanel } from '../offlineRouting/OfflineRoutingPanel';
import { OfflineMapSettings } from './OfflineMapSettings';
import { useState } from 'react';
import { regionEstimate, type TripPackage } from './offline';
import './offlineRegion.css';
export function OfflinePanel({
  offline,
  points,
  name,
  onShow,
  onOpenMap,
  region, onChooseRegion,
  onDownloadCurrent, onDownloadRoute,
}: {
  offline: ReturnType<typeof useOffline>;
  points: Coordinate[];
  name: string;
  onShow: (points: Coordinate[]) => void;
  onOpenMap: (trip?: TripPackage) => void;
  region: TripPackage['bounds'] | null;
  onChooseRegion: () => void;
  onDownloadCurrent?: () => void;
  onDownloadRoute?: () => void;
}) {
  const [regionName, setRegionName] = useState('我的离线区域');
  let estimate = 0, regionError = '';
  if (region) { try { estimate = regionEstimate(region, 14); } catch(e) { regionError = (e as Error).message; } }
  return (
    <>
      <strong>离线地图缓存</strong>
      {onDownloadCurrent && <div className="outdoor-actions"><button onClick={onDownloadCurrent}>下载当前地图范围</button><button disabled={!points.length} onClick={onDownloadRoute}>下载「{name}」沿线地图</button></div>}
      {!onDownloadCurrent && <>
      <section className="offline-download-region" aria-label="区域下载">
        <button disabled={offline.busy} onClick={onChooseRegion}>{region ? '重新选择地图区域' : '地图选区下载'}</button>
        {region && <><input aria-label="离线区域名称" maxLength={60} value={regionName} onChange={e => setRegionName(e.target.value)} /><small>{region.map(n => n.toFixed(3)).join(' / ')}</small><small>{regionError || `约 ${estimate} 项资源（含字库）；大小以实际下载为准`}</small><button disabled={offline.busy || !estimate || !regionName.trim()} onClick={() => void offline.createRegion(regionName.trim(), region, 14)}>下载所选区域</button></>}
        <small>道路14级 · 地形12级 · 含地名，不含天地图影像。离线算路需另下载下方路网。</small>
      </section>
      <p className="route-note">
        下载「{name}」周边约 2 km 的开源道路、地名与地形。道路精细至 14
        级，地形至 12
        级；更高缩放放大已有数据。卫星、天气更新和在线搜索不在包内。
      </p>
      <div className="outdoor-actions">
        <button
          disabled={offline.busy}
          onClick={() => void offline.create(name, points)}
        >
          下载此行程
        </button>
        <button onClick={() => onOpenMap()}>使用开源底图</button>
        {offline.busy && <button onClick={offline.pause}>暂停下载</button>}
      </div>
      </>}
      <OfflineMapSettings onOpenMap={()=>onOpenMap()} />
      {offline.busy && <button onClick={offline.pause}>暂停下载</button>}
      {offline.packages.map((p) => (
        <article className="trip-package" key={p.id}>
          <strong>{p.name}</strong>
          <small>{p.provider==='tianditu'?'天地图':'开源地图'} · {p.zoom??14}级{p.bufferKm?` · 沿线两侧各${p.bufferKm}公里`:''}</small>
          <progress value={p.done} max={p.urls.length} />
          <span>
            {p.complete ? '已下载' : '待补齐'} · {p.done}/{p.urls.length} ·{' '}
            {(p.bytes / 1048576).toFixed(1)} MB
          </span>
          <div className="outdoor-actions">
            <button
              onClick={() => {
                onOpenMap(p);
                onShow([
                  [p.bounds[0], p.bounds[1]],
                  [p.bounds[2], p.bounds[3]],
                ]);
              }}
            >
              打开范围
            </button>
            <button
              disabled={offline.busy}
              onClick={() => void offline.resume(p)}
            >
              继续 / 补齐
            </button>
            <button
              disabled={offline.busy}
              onClick={() => void offline.verify(p)}
            >
              检查完整性
            </button>
            <button
              disabled={offline.busy}
              onClick={() => void offline.remove(p)}
            >
              移除缓存
            </button>
          </div>
        </article>
      ))}
      <p className="route-note">
        下载时请保持应用在前台；完成后在飞行模式下检查行程范围；清理应用数据会删除离线包。
      </p>
      {offline.message && (
        <p role="status" className="route-note">
          {offline.message}
        </p>
      )}
      <OfflineRoutingPanel points={points} name={name} onShow={onShow} />
    </>
  );
}
