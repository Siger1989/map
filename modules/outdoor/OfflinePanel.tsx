import type { Coordinate } from '../navigation/types';
import type { useOffline } from './useOffline';
import { OfflineRoutingPanel } from '../offlineRouting/OfflineRoutingPanel';
import { OfflineMapSettings } from './OfflineMapSettings';
import { type TripPackage } from './offline';
import { canDownloadTrip, TIANDITU_OFFLINE_DISABLED } from './offlineDownloadPolicy';
import './offlineRegion.css';
export function OfflinePanel({
  offline,
  points,
  name,
  onShow,
  onOpenMap,
  onDownloadRoute,
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
  return (
    <>
      <strong>离线地图缓存</strong>
      <small>选择已导入的在线图源，只下载路线附近；级别按图源支持范围选择。</small>
      <div className="outdoor-actions"><button disabled={offline.busy || points.length < 2 || !onDownloadRoute} onClick={onDownloadRoute}>下载「{name}」沿线地图</button></div>
      <OfflineMapSettings onOpenMap={()=>onOpenMap()} />
      {offline.busy && <button onClick={offline.pause}>暂停下载</button>}
      {offline.packages.map((p) => (
        <article className="trip-package" key={p.id}>
          <strong>{p.name}</strong>
          <small>{p.provider==='imported'?p.sourceName??'导入图源':p.provider==='tianditu'?'天地图':'开源地图'} · {p.zoom??14}级{p.bufferKm?` · 沿线两侧各${p.bufferKm}公里`:''}</small>
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
              disabled={offline.busy || p.provider !== 'imported' || !canDownloadTrip(p)}
              title={p.provider !== 'imported' ? '旧包仅查看，新的下载仅支持导入图源' : !canDownloadTrip(p) ? TIANDITU_OFFLINE_DISABLED : undefined}
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
              disabled={offline.removing?.includes(p.id)}
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
