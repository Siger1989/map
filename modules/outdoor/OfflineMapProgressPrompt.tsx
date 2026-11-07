import type { TripPackage } from './offline';
import './offlineMapProgressPrompt.css';

type Props = {
  trip: TripPackage;
  onOpenTask: (trip: TripPackage) => void;
};

function taskStatus(trip: TripPackage) {
  if (trip.phase === 'preparing' || !trip.urls.length) return trip.phaseMessage || '正在规划路线缓存';
  if (trip.phase === 'waiting') return trip.phaseMessage || '等待网络恢复';
  if (trip.phase === 'paused') return trip.phaseMessage || '缓存已暂停';
  if (trip.phase === 'failed') return trip.phaseMessage || '缓存失败';
  if (trip.complete || trip.phase === 'complete') return '缓存完成';
  if (trip.phase === 'queued') return trip.phaseMessage || '缓存排队中';
  return trip.phaseMessage || '正在缓存';
}

export function OfflineMapProgressPrompt({ trip, onOpenTask }: Props) {
  const total = trip.urls.length;
  const done = Math.min(total, Math.max(0, trip.done));
  const status = taskStatus(trip);
  const detail = total
    ? `${done}/${total} 项 · ${(trip.bytes / 1048576).toFixed(1)} MB`
    : status;
  const percent = total ? Math.floor(done / total * 100) : undefined;
  const needsAttention = trip.phase === 'failed' || trip.phase === 'paused' || trip.phase === 'waiting';

  return (
    <button
      type="button"
      className="offline-map-progress-prompt"
      aria-label={`${trip.name}，${status}${percent === undefined ? '' : `，${percent}%`}${total ? `，${detail}` : ''}。点击查看缓存任务`}
      title={trip.phaseMessage || `${trip.name} · ${detail}`}
      onClick={() => onOpenTask(trip)}
    >
      <span className="offline-map-progress-copy">
        <strong>{trip.name}</strong>
        {needsAttention ? <span className="offline-map-progress-reason">{status}</span> : <span>{detail}</span>}
        {needsAttention && total > 0 && <span>{detail}</span>}
      </span>
      {total > 0 && <progress aria-label={`${trip.name}缓存进度`} value={done} max={total} />}
      {trip.phase === 'preparing' && <progress aria-label={`${trip.name}路线规划中`} />}
    </button>
  );
}
