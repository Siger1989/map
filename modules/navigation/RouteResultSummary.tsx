import { useState } from 'react';
import { RouteProviderNote } from './RouteProviderNote';
import { RouteElevationSummary } from '../journey/RouteElevationSummary';
import { formatDistance, formatDuration, type PlannedRoute } from './types';

export function RouteResultSummary({ route, start, end, mode, loading, planningError, onModeChange, onSwap, onShow, onEdit, onSave, onShare, onStartNavigation, navigating, guidanceError, saveMessage, onEditPoints, onCancel }: {
  route: PlannedRoute; onShow: () => void; onEdit: () => void;
  start: { name: string } | null; end: { name: string } | null;
  mode: PlannedRoute['mode']; loading: boolean;
  planningError: string;
  onModeChange: (mode: PlannedRoute['mode']) => void; onSwap: () => void;
  onSave: () => void; onShare: () => void; onStartNavigation: () => void;
  navigating: boolean; guidanceError: string; saveMessage: string;
  onEditPoints?: () => void; onCancel?: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsMounted, setDetailsMounted] = useState(false);
  return <section className="route-panel route-summary" aria-label="路线摘要" aria-busy={loading}>
    {detailsMounted && <div className="route-summary-detail" id="route-summary-detail" hidden={!detailsOpen}>
      <RouteElevationSummary coordinates={route.coordinates} distance={route.distance} duration={route.duration} />
      <RouteProviderNote />
    </div>}
    <div className="route-summary-endpoints">
      <div><b className="route-endpoint-start">起点</b><span>{start?.name ?? '起点'}</span></div>
      <button type="button" aria-label="交换起点和终点" onClick={onSwap}>↕ 交换</button>
      <div><b className="route-endpoint-end">终点</b><span>{end?.name ?? '终点'}</span></div>
    </div>
    <div className="route-summary-metrics">
      <strong>{formatDistance(route.distance)}</strong><span>{formatDuration(route.duration)}</span>
      <button onClick={() => { setDetailsOpen(false); onShow(); }}>看全程</button>
      <button onClick={onEdit}>起终点</button>
    </div>
    {!!route.accessDistance && <p className="route-note">含虚线接入 {Math.round(route.accessDistance)} 米，接入时间按步行估算</p>}
    <nav className="route-summary-actions" aria-label="路线管理操作">
      <label className="route-mode-select">导航方式
        <select aria-label="当前导航方式" value={mode} onChange={(event) => onModeChange(event.target.value as PlannedRoute['mode'])}>
          <option value="auto">驾车</option><option value="bicycle">骑行</option><option value="pedestrian">步行</option>
        </select>
      </label>
      {onEditPoints && <button onClick={onEditPoints}>编辑线点</button>}
      {onCancel && <button onClick={onCancel}>取消路线</button>}
    </nav>
    <nav className="route-summary-actions" aria-label="路线操作">
      <button className="is-primary" onClick={onStartNavigation} disabled={navigating || loading}>{navigating ? '导航中' : loading ? '规划中…' : '开始导航'}</button>
      <button onClick={onSave}>收藏</button>
      <button onClick={onShare}>分享</button>
      <button aria-expanded={detailsOpen} aria-controls="route-summary-detail" onClick={() => {
        const next = !detailsOpen;
        if (next) setDetailsMounted(true);
        setDetailsOpen(next);
      }}>详情</button>
    </nav>
    {(planningError || guidanceError) && !navigating && <p className="route-error" role="alert">{planningError || guidanceError}</p>}
    {saveMessage && <p className="route-note" role="status">{saveMessage}</p>}
  </section>;
}
