import { useState, type ReactNode } from 'react';
import { RouteProviderNote } from './RouteProviderNote';
import { formatDistance, formatDuration, type PlannedRoute } from './types';

export function RouteResultSummary({ route, onShow, onEdit, onSave, onShare, onStartNavigation, navigating, guidanceError, saveMessage, weather, onRally, onEditPoints, onCancel, onCache }: {
  route: PlannedRoute; onShow: () => void; onEdit: () => void;
  onSave: () => void; onShare: () => void; onStartNavigation: () => void;
  navigating: boolean; guidanceError: string; saveMessage: string; weather?: ReactNode;
  onRally?: () => void;
  onEditPoints?: () => void; onCancel?: () => void;
  onCache?: () => void;
}) {
  const [section, setSection] = useState<'steps' | 'weather' | null>(null);
  const toggle = (next: 'steps' | 'weather') => setSection(section === next ? null : next);
  return <section className="route-panel route-summary" aria-label="路线摘要">
    <div className="route-summary-metrics">
      <strong>{formatDistance(route.distance)}</strong><span>{formatDuration(route.duration)}</span>
      <button onClick={() => { setSection(null); onShow(); }}>看全程</button>
      <button onClick={onEdit}>起终点</button>
      {onRally && <button onClick={onRally}>路书</button>}
    </div>
    {!!route.accessDistance && <p className="route-note">含虚线接入 {Math.round(route.accessDistance)} 米，接入时间按步行估算</p>}
    <nav className="route-summary-actions" aria-label="路线编辑操作">
      {onEditPoints && <button onClick={onEditPoints}>编辑线点</button>}
      {onCancel && <button onClick={onCancel}>取消路线</button>}
    </nav>
    <nav className="route-summary-actions" aria-label="路线操作">
      <button className="is-primary" onClick={onStartNavigation} disabled={navigating}>{navigating ? '导航中' : '开始导航'}</button>
      <button onClick={onSave}>收藏</button>
      <button onClick={onShare}>分享</button>
      <button aria-expanded={section === 'steps'} onClick={() => toggle('steps')}>路段</button>
      <button aria-expanded={section === 'weather'} onClick={() => toggle('weather')}>天气</button>
    </nav>
    {onCache && <nav className="route-summary-actions"><button onClick={onCache}>缓存当前路线</button></nav>}
    {guidanceError && !navigating && <p className="route-error" role="alert">{guidanceError}</p>}
    {saveMessage && <p className="route-note" role="status">{saveMessage}</p>}
    {section && <div className="route-summary-detail">
      {section === 'weather' ? weather : <>
        {route.routingSource && <p className="route-note">离线步行 · {route.routingSource.name}</p>}
        <p className="route-note">虚线为选点与道路的直连接入，实际通行需现场确认。</p>
        <ol>{route.steps.map((s, i) => <li key={i}>{s.instruction} · {formatDistance(s.distance)}</li>)}</ol>
        <RouteProviderNote />
      </>}
    </div>}
  </section>;
}
