import { useState, type ReactNode } from 'react';
import { RouteProviderNote } from './RouteProviderNote';
import { RouteElevationSummary } from '../journey/RouteElevationSummary';
import { formatDistance, formatDuration, TRAVEL_MODES, type PlannedRoute } from './types';
import { RouteRemovalControl } from './RouteRemovalControl';
import './routeResultSummary.css';

export function RouteResultSummary({ route, start, end, mode, loading, planningError, onModeChange, onSwap, onShow, onEdit, onSave, onShare, onCache, onStartNavigation, navigating, guidanceError, saveMessage, onEditPoints, onCancel, previewMode, onPreview, onPreviewTopDown, onExitPreview, quickRouteControls }: {
  route: PlannedRoute; onShow: () => void; onEdit: () => void;
  start: { name: string } | null; end: { name: string } | null;
  mode: PlannedRoute['mode']; loading: boolean;
  planningError: string;
  onModeChange: (mode: PlannedRoute['mode']) => void; onSwap: () => void;
  onSave: () => void; onShare: () => void; onStartNavigation: () => void;
  navigating: boolean; guidanceError: string; saveMessage: string;
  onEditPoints?: () => void; onCancel?: () => boolean | void;
  onCache?: () => void;
  previewMode?: 'forward' | 'top' | null;
  onPreview?: () => void;
  onPreviewTopDown?: () => void;
  onExitPreview?: () => void;
  quickRouteControls?: ReactNode;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsMounted, setDetailsMounted] = useState(false);
  return <section className={`route-panel route-summary${previewMode ? ' route-summary-preview' : ''}`} aria-label="路线摘要" aria-busy={loading}>
    {previewMode ? <>
      <nav className="route-preview-actions" aria-label="路线前视预览">
        <span role="status">路线预览（{previewMode === 'forward' ? '第一人称' : '俯视'}）· 非定位导航</span>
        {onPreviewTopDown && <button type="button" onClick={onPreviewTopDown}>{previewMode === 'forward' ? '俯视' : '第一人称'}</button>}
        {onExitPreview && <button type="button" onClick={onExitPreview}>退出预览</button>}
      </nav>
      {!!route.accessDistance && <p className="route-preview-note">虚线接入约 {Math.round(route.accessDistance)} 米，时间按步行估算</p>}
      <nav className="route-summary-actions" aria-label="路线操作">
        <button className="is-primary" onClick={onStartNavigation} disabled={navigating || loading}>{navigating ? '导航中' : loading ? '规划中…' : '开始导航'}</button>
      </nav>
      {guidanceError && !navigating && <p className="route-error" role="alert">{guidanceError}</p>}
    </> : <>
    {!moreOpen && <div className="route-summary-metrics">
      <span>{TRAVEL_MODES.find(item => item.id === mode)?.label}</span>
      <strong>{formatDistance(route.distance)}</strong><span>{formatDuration(route.duration)}</span>
    </div>}
    <nav className={`route-summary-actions route-summary-actions-primary${moreOpen ? ' route-summary-back-row' : ''}`} aria-label={moreOpen ? '返回路线摘要' : '路线主要操作'}>
      {!moreOpen && <>
      <button className="is-primary" onClick={onStartNavigation} disabled={navigating || loading}>{navigating ? '导航中' : loading ? '规划中…' : '开始导航'}</button>
      <button type="button" onClick={() => { setMoreOpen(false); onShow(); }}>看全程</button>
      <button type="button" onClick={onEdit}>编辑</button>
      </>}
      <button type="button" aria-expanded={moreOpen} aria-controls="route-summary-more" onClick={() => setMoreOpen(!moreOpen)}>{moreOpen ? '‹ 返回路线摘要' : '更多'}</button>
    </nav>
    <div className="route-summary-more" id="route-summary-more" hidden={!moreOpen}>
      <nav className="route-summary-actions route-summary-actions-secondary" aria-label="更多路线操作">
        <button type="button" onClick={onSave}>收藏</button>
        <button type="button" onClick={onShare}>分享</button>
        <button type="button" className="route-summary-details-toggle" aria-expanded={detailsOpen} aria-controls="route-summary-detail" onClick={() => {
          setDetailsMounted(true);
          setDetailsOpen(!detailsOpen);
        }}>{detailsOpen ? '收起详情' : '路线详情'}</button>
        {onPreview && <button type="button" onClick={onPreview}>第一人称预览</button>}
        {onEditPoints && <button type="button" onClick={onEditPoints}>编辑线点</button>}
        {onCache && <button type="button" onClick={onCache}>缓存地图</button>}
        {onCancel && <RouteRemovalControl onRemove={onCancel} label="清除当前规划" buttonClassName="route-danger" />}
      </nav>
      {quickRouteControls && <div className="route-summary-quick-controls">{quickRouteControls}</div>}
      {moreOpen && <label className="route-mode-select">导航方式
        <select aria-label="当前导航方式" value={mode} onChange={event => onModeChange(event.target.value as PlannedRoute['mode'])}>
          {TRAVEL_MODES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>}
      {detailsMounted && <div className="route-summary-detail" id="route-summary-detail" hidden={!detailsOpen}>
        <div className="route-summary-endpoints">
          <button type="button" className="route-endpoint-row route-endpoint-row-start" aria-label={`编辑起点：${start?.name ?? '起点'}`} onClick={onEdit}>
            <b className="route-endpoint-start">起点</b><span>{start?.name ?? '起点'}</span>
          </button>
          <button type="button" className="route-endpoint-swap" aria-label="交换起点和终点" onClick={onSwap}>↕ 交换</button>
          <button type="button" className="route-endpoint-row route-endpoint-row-end" aria-label={`编辑终点：${end?.name ?? '终点'}`} onClick={onEdit}>
            <b className="route-endpoint-end">终点</b><span>{end?.name ?? '终点'}</span>
          </button>
        </div>
        {!!route.accessDistance && <p className="route-note route-access-note">虚线步行接入 {Math.round(route.accessDistance)} 米 · 时间按步行估算</p>}
        <RouteElevationSummary coordinates={route.coordinates} distance={route.distance} duration={route.duration} />
        <RouteProviderNote />
      </div>}
    </div>
    {(planningError || guidanceError) && !navigating && <p className="route-error" role="alert">{planningError || guidanceError}</p>}
    {saveMessage && <p className="route-note" role="status">{saveMessage}</p>}
    </>}
  </section>;
}
