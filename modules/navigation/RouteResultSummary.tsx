import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { RouteProviderNote } from './RouteProviderNote';
import { RouteElevationSummary } from '../journey/RouteElevationSummary';
import { RouteDetailsDialog } from '../tracks/RouteDetailsDialog';
import { formatDistance, formatDuration, TRAVEL_MODES, type PlannedRoute, type RoutePlace } from './types';
import { RouteRemovalControl } from './RouteRemovalControl';
import { RouteActionGroups } from './RouteActionGroups';
import { defaultRouteName } from './routeName';
import { plannedRouteSkyJourney, requestSkyJourney } from '../sky/journeyPlayback';
import './routeResultSummary.css';

export function RouteResultSummary({ route, start, end, mode, loading, planningError, planningPositionStatus = '', onModeChange, onSwap, onShow, onEdit, onSave, onShare, onCache, onStartNavigation, navigating, guidanceError, saveMessage, onEditPoints, onCancel, previewMode, onPreview, onPreviewTopDown, onExitPreview, quickRouteControls, detailsCovered = false }: {
  route: PlannedRoute; onShow: () => void; onEdit: () => void;
  start: RoutePlace | null; end: RoutePlace | null;
  mode: PlannedRoute['mode']; loading: boolean;
  planningError: string;
  planningPositionStatus?: string;
  onModeChange: (mode: PlannedRoute['mode']) => void; onSwap: () => void;
  onSave: () => void; onShare: (keepOverview?: boolean) => void; onStartNavigation: () => void;
  navigating: boolean; guidanceError: string; saveMessage: string;
  onEditPoints?: () => void; onCancel?: () => boolean | void;
  onCache?: () => void;
  previewMode?: 'forward' | 'top' | null;
  onPreview?: () => void;
  onPreviewTopDown?: () => void;
  onExitPreview?: () => void;
  quickRouteControls?: ReactNode;
  detailsCovered?: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsHost, setDetailsHost] = useState<HTMLElement | null>(null);
  const name = route.name || defaultRouteName(start ?? { name: '起点' }, end ?? { name: '终点' });
  const startNavigation = <button type="button" className="is-primary" onClick={onStartNavigation} disabled={navigating || loading}>{navigating ? '导航中' : loading ? '规划中…' : '开始导航'}</button>;
  const simulate = () => requestSkyJourney(plannedRouteSkyJourney(route, name));
  return <section className={`route-panel route-summary${previewMode ? ' route-summary-preview' : ''}`} data-summary-page={previewMode ? 'preview' : 'main'} aria-label="路线摘要" aria-busy={loading}>
    {previewMode ? <>
      <nav className="route-preview-actions" aria-label="路线前视预览">
        <span role="status">路线预览（{previewMode === 'forward' ? '第一人称' : '俯视'}）· 非定位导航</span>
        {onPreviewTopDown && <button type="button" onClick={onPreviewTopDown}>{previewMode === 'forward' ? '俯视' : '第一人称'}</button>}
        {onExitPreview && <button type="button" onClick={onExitPreview}>退出预览</button>}
      </nav>
      {!!route.accessDistance && <p className="route-preview-note">虚线接入约 {Math.round(route.accessDistance)} 米，时间按步行估算</p>}
      <RouteActionGroups primary={startNavigation} />
      {guidanceError && !navigating && <p className="route-error" role="alert">{guidanceError}</p>}
    </> : <>
    <nav className="route-summary-modes" aria-label="当前导航方式">
      {TRAVEL_MODES.map(item => <button key={item.id} type="button" aria-label={item.label} aria-pressed={mode === item.id}
        disabled={loading || navigating} onClick={() => { if (mode !== item.id) onModeChange(item.id); }}>
        {item.id === 'motorcycle' ? <>摩托车<small>离线</small></> : item.label}
      </button>)}
    </nav>
    <div className="route-summary-metrics">
      <strong>{formatDistance(route.distance)}</strong><span>{formatDuration(route.duration)}</span>
    </div>
    {planningPositionStatus && <p className="route-summary-position-note" role="status">{planningPositionStatus}</p>}
    <RouteActionGroups primary={startNavigation} context={<>
        <button type="button" onClick={onShow}>看全程</button>
        <button type="button" onClick={onEdit}>编辑</button>
      </>} important={<>
        <button type="button" aria-haspopup="dialog" onClick={(event) => {
          setDetailsHost(event.currentTarget.closest<HTMLElement>('.observatory') ?? event.currentTarget.ownerDocument.body);
          setDetailsOpen(true);
        }}>路线详情</button>
        {route.coordinates.length > 0 && <button type="button" disabled={loading} onClick={simulate}>轨迹模拟</button>}
        <button type="button" onClick={() => onShare()}>分享</button>
      </>} utilities={<>
        <button type="button" onClick={onSave}>收藏</button>
        {onPreview && <button type="button" onClick={onPreview}>第一人称预览</button>}
        {onEditPoints && <button type="button" onClick={onEditPoints}>编辑线点</button>}
        {onCache && <button type="button" onClick={onCache}>缓存地图</button>}
        {onCancel && <RouteRemovalControl onRemove={onCancel} label="清除当前规划" buttonClassName="route-danger" />}
      </>} appearance={quickRouteControls} />
      {detailsHost && createPortal(<RouteDetailsDialog
        open={detailsOpen && !detailsCovered}
        name={name}
        start={{ name: start?.name, coordinate: start?.coordinates }}
        end={{ name: end?.name, coordinate: end?.coordinates }}
        endpointActions={<div className="route-endpoint-actions">
          <button type="button" onClick={onEdit}>编辑起终点</button>
          <button type="button" onClick={onSwap} disabled={loading} aria-label="交换起点和终点">交换起终点</button>
        </div>}
        profile={<RouteElevationSummary coordinates={route.coordinates} distance={route.distance} duration={route.duration} />}
        onBack={() => setDetailsOpen(false)}
        onShare={() => onShare(true)}
      >
        <section className="route-detail-group" aria-label="规划说明">
          {!!route.accessDistance && <p className="route-note">虚线步行接入 {Math.round(route.accessDistance)} 米 · 时间按步行估算</p>}
          <RouteProviderNote />
        </section>
      </RouteDetailsDialog>, detailsHost)}
    {(planningError || guidanceError) && !navigating && <p className="route-error" role="alert">{planningError || guidanceError}</p>}
    {saveMessage && <p className="route-note" role="status">{saveMessage}</p>}
    </>}
  </section>;
}
