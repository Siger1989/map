import { useState } from 'react';
import { RouteProviderNote } from './RouteProviderNote';
import { RouteElevationSummary } from '../journey/RouteElevationSummary';
import { formatDistance, formatDuration, type PlannedRoute } from './types';

export function RouteResultSummary({ route, onShow, onEdit, onSave, onShare, onStartNavigation, navigating, guidanceError, saveMessage, onEditPoints, onCancel, onImport }: {
  route: PlannedRoute; onShow: () => void; onEdit: () => void;
  onSave: () => void; onShare: () => void; onStartNavigation: () => void;
  navigating: boolean; guidanceError: string; saveMessage: string;
  onEditPoints?: () => void; onCancel?: () => void;
  onImport?: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsVisited, setDetailsVisited] = useState(false);
  return <section className="route-panel route-summary" aria-label="路线摘要">
    <div className="route-summary-metrics">
      <strong>{formatDistance(route.distance)}</strong><span>{formatDuration(route.duration)}</span>
      <button onClick={() => { setDetailsOpen(false); onShow(); }}>看全程</button>
      <button onClick={onEdit}>起终点</button>
    </div>
    {!!route.accessDistance && <p className="route-note">含虚线接入 {Math.round(route.accessDistance)} 米，接入时间按步行估算</p>}
    <nav className="route-summary-actions" aria-label="路线管理操作">
      {onImport && <button onClick={onImport}>加载路线</button>}
      {onEditPoints && <button onClick={onEditPoints}>编辑线点</button>}
      {onCancel && <button onClick={onCancel}>取消路线</button>}
    </nav>
    <nav className="route-summary-actions" aria-label="路线操作">
      <button className="is-primary" onClick={onStartNavigation} disabled={navigating}>{navigating ? '导航中' : '开始导航'}</button>
      <button onClick={onSave}>收藏</button>
      <button onClick={onShare}>分享</button>
      <button aria-expanded={detailsOpen} aria-controls="route-summary-detail" onClick={() => {
        const next = !detailsOpen;
        setDetailsOpen(next);
        if (next) setDetailsVisited(true);
      }}>详情</button>
    </nav>
    {guidanceError && !navigating && <p className="route-error" role="alert">{guidanceError}</p>}
    {saveMessage && <p className="route-note" role="status">{saveMessage}</p>}
    {detailsVisited && <div className="route-summary-detail" id="route-summary-detail" hidden={!detailsOpen}>
      <RouteElevationSummary coordinates={route.coordinates} distance={route.distance} duration={route.duration} />
      <RouteProviderNote />
    </div>}
  </section>;
}
