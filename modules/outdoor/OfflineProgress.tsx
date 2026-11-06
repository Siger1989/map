import type { TripPackage } from './offline';
import './offlineProgress.css';
export function OfflineProgress({trip}:{trip:TripPackage}) {
  const total=trip.urls.length,done=Math.min(total,Math.max(0,trip.done));
  const percent=total ? Math.floor(done/total*100) : 0;
  if (!total && trip.phase === 'preparing') return <div className="offline-progress" role="status"><progress aria-label={`${trip.name}路线规划中`} /><span>{trip.phaseMessage || '正在规划路线缓存…'}</span></div>;
  return <div className="offline-progress"><progress aria-label={`${trip.name}缓存进度`} value={done} max={Math.max(1,total)}/><span>{percent}% · {done}/{total} 项 · {(trip.bytes/1048576).toFixed(1)} MB</span></div>;
}
