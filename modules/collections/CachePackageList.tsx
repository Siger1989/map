import type { TripPackage } from '../outdoor/offline';
import { OfflineProgress } from '../outdoor/OfflineProgress';

type Props = {
  packages: readonly TripPackage[];
  query: string;
  totalCount: number;
  onOpen?: (id: string) => void;
  onManage: () => void;
};

function packageStatus(trip: TripPackage) {
  if (!trip.phase) {
    if (trip.complete) return '缓存完成';
    if (trip.done > 0) return '未完成，可继续';
    if (!trip.urls.length) return trip.phaseMessage || '正在规划路线缓存';
    return trip.phaseMessage || '尚未开始缓存';
  }
  if (trip.phase === 'preparing' || !trip.urls.length) return trip.phaseMessage || '正在规划路线缓存';
  if (trip.phase === 'running') return trip.phaseMessage || '正在缓存';
  if (trip.phase === 'queued') return trip.phaseMessage || '缓存排队中';
  if (trip.phase === 'waiting') return trip.phaseMessage || '等待网络恢复';
  if (trip.phase === 'paused') return trip.phaseMessage || '缓存已暂停';
  if (trip.phase === 'failed') return trip.phaseMessage || '缓存失败';
  if (trip.complete || trip.phase === 'complete') return '缓存完成';
  return trip.phaseMessage || '尚未开始缓存';
}

function activityRank(trip: TripPackage) {
  if (['preparing', 'queued', 'running', 'waiting'].includes(trip.phase ?? '')) return 0;
  if (trip.phase === 'paused' || trip.phase === 'failed') return 1;
  if (trip.complete || trip.phase === 'complete') return 2;
  if (!trip.phase && trip.done > 0) return 1;
  return 3;
}

export function CachePackageList({ packages, query, totalCount, onOpen, onManage }: Props) {
  const needle = query.trim().toLocaleLowerCase();
  const visible = packages
    .filter((trip) => `${trip.name} ${trip.sourceName ?? ''} ${packageStatus(trip)}`.toLocaleLowerCase().includes(needle))
    .map((trip, index) => ({ trip, index }))
    .sort((a, b) => activityRank(a.trip) - activityRank(b.trip) || a.index - b.index)
    .map(({ trip }) => trip);

  return (
    <section className="workbench-cache-packages" aria-label="地图缓存包">
      <header className="workbench-cache-packages-heading">
        <strong>地图缓存包</strong>
        <button type="button" className="workbench-cache-manage" onClick={onManage}>
          管理全部缓存
          <small>{totalCount} 个包</small>
        </button>
      </header>
      {!visible.length ? (
        <p className="workbench-cache-empty">{packages.length ? '没有匹配的缓存路线或图源' : '暂无已导入图源的路线缓存'}</p>
      ) : visible.map((trip) => (
        <article className="workbench-cache-package" key={trip.id}>
          <button
            type="button"
            className="workbench-cache-package-open"
            aria-label={`查看缓存任务：${trip.name}`}
            title={`${trip.name} · ${packageStatus(trip)}`}
            disabled={!onOpen}
            onClick={() => onOpen?.(trip.id)}
          >
            <span className="workbench-cache-package-copy">
              <strong>{trip.name}</strong>
              <small>{trip.sourceName || (trip.provider === 'tianditu' ? '天地图' : trip.provider === 'openfreemap' ? '开源地图' : '导入图源')} · {packageStatus(trip)}</small>
            </span>
            <small className="workbench-cache-open-label">查看缓存任务</small>
          </button>
          <OfflineProgress trip={trip} />
        </article>
      ))}
    </section>
  );
}
