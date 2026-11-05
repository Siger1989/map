import { CircleStop, ExternalLink, Navigation } from 'lucide-react';
import type { useFloatingNavigation } from './useFloatingNavigation';
import './floatingNavigation.css';

export type FloatingNavigationControlsState = ReturnType<typeof useFloatingNavigation>;

export function FloatingNavigationControls({ controls }: { controls: FloatingNavigationControlsState }) {
  if (!controls.supported) return null;
  return <div className="floating-navigation-controls" aria-label="跨App悬浮导航">
    <span className="floating-navigation-controls__title"><ExternalLink size={14} />悬浮导航</span>
    <div className="floating-navigation-controls__modes" role="group" aria-label="悬浮导航方向">
      <button type="button" aria-pressed={controls.mode === 'north'} onClick={() => controls.setMode('north')}>指北</button>
      <button type="button" aria-pressed={controls.mode === 'motion'} onClick={() => controls.setMode('motion')}>运动朝上</button>
    </div>
    {controls.enabled
      ? <button className="floating-navigation-controls__action" type="button" onClick={controls.stop}><CircleStop size={14} />关闭悬浮</button>
      : <button className="floating-navigation-controls__action" type="button" onClick={() => controls.start()}><Navigation size={14} />开启悬浮</button>}
    {controls.message && <span className="floating-navigation-controls__message" role="status">{controls.message}</span>}
  </div>;
}
