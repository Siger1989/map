import { CircleStop, ExternalLink, Navigation } from 'lucide-react';
import type { useFloatingNavigation } from './useFloatingNavigation';
import './floatingNavigation.css';

export type FloatingNavigationControlsState = ReturnType<typeof useFloatingNavigation>;

export function FloatingNavigationControls({ controls }: { controls: FloatingNavigationControlsState }) {
  if (!controls.supported) return null;
  return <div className="floating-navigation-controls" aria-label="跨App悬浮小地图">
    <div className="floating-navigation-controls__kinds" role="group" aria-label="悬浮地图内容">
      <button type="button" aria-pressed={controls.kind === 'position'} onClick={() => controls.setKind('position')}>定位小地图</button>
      <button type="button" disabled={!controls.hasRoute} aria-pressed={controls.kind === 'route'} onClick={() => controls.setKind('route')}>导航路线</button>
    </div>
    <span className="floating-navigation-controls__title"><ExternalLink size={14} />朝向</span>
    <div className="floating-navigation-controls__modes" role="group" aria-label="悬浮导航方向">
      <button type="button" aria-pressed={controls.mode === 'north'} onClick={() => controls.setMode('north')}>指北</button>
      <button type="button" aria-pressed={controls.mode === 'motion'} onClick={() => controls.setMode('motion')}>运动朝上</button>
    </div>
    {controls.enabled
      ? <button className="floating-navigation-controls__action" type="button" onClick={controls.stop}><CircleStop size={14} />关闭悬浮</button>
      : <button className="floating-navigation-controls__action" type="button" onClick={() => controls.start()}><Navigation size={14} />开启悬浮</button>}
    <span className="floating-navigation-controls__message">窗内 ± 缩放地图，拖右下角调整窗口大小</span>
    {controls.message && <span className="floating-navigation-controls__message" role="status">{controls.message}</span>}
  </div>;
}
