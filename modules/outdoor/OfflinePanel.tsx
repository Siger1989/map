import type { Coordinate } from '../navigation/types';
import type { useOffline } from './useOffline';
export function OfflinePanel({
  offline,
  points,
  name,
  onShow,
  onOpenMap,
}: {
  offline: ReturnType<typeof useOffline>;
  points: Coordinate[];
  name: string;
  onShow: (points: Coordinate[]) => void;
  onOpenMap: () => void;
}) {
  return (
    <>
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
        <button onClick={onOpenMap}>使用开源底图</button>
        {offline.busy && <button onClick={offline.pause}>暂停下载</button>}
      </div>
      {offline.packages.map((p) => (
        <article className="trip-package" key={p.id}>
          <strong>{p.name}</strong>
          <progress value={p.done} max={p.urls.length} />
          <span>
            {p.complete ? '已下载' : '待补齐'} · {p.done}/{p.urls.length} ·{' '}
            {(p.bytes / 1048576).toFixed(1)} MB
          </span>
          <div className="outdoor-actions">
            <button
              onClick={() => {
                onOpenMap();
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
    </>
  );
}
