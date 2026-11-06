import { ExternalLink } from 'lucide-react';
import type { useFloatingNavigation } from './useFloatingNavigation';
import './floatingNavigation.css';

export type FloatingNavigationControlsState = ReturnType<typeof useFloatingNavigation>;

export function FloatingNavigationControls({ controls }: { controls: FloatingNavigationControlsState }) {
  if (!controls.supported) return null;
  return <div className="floating-navigation-controls" aria-label="跨App悬浮小地图">
    <div className="floating-navigation-controls__kinds" role="group" aria-label="悬浮显示方式">
      <label><input type="checkbox" checked={controls.windowEnabled} onChange={(event) => controls.setWindowEnabled(event.currentTarget.checked)} />悬浮小窗</label>
      <label><input type="checkbox" checked={controls.lockscreenEnabled} onChange={(event) => controls.setLockscreenEnabled(event.currentTarget.checked)} />锁屏地图</label>
    </div>
    <span className="floating-navigation-controls__title"><ExternalLink size={14} />朝向</span>
    <div className="floating-navigation-controls__modes" role="group" aria-label="悬浮导航方向">
      <button type="button" aria-pressed={controls.mode === 'north'} onClick={() => controls.setMode('north')}>指北</button>
      <button type="button" aria-pressed={controls.mode === 'motion'} onClick={() => controls.setMode('motion')}>运动朝上</button>
    </div>
    <span className="floating-navigation-controls__message" role="status">
      {controls.enabled
        ? controls.visible ? '悬浮地图服务运行中 · 当前可见' : '悬浮地图服务运行中 · 切换到其他应用后显示'
        : controls.windowEnabled || controls.lockscreenEnabled ? '显示已开启 · 悬浮地图尚未运行或等待授权' : '悬浮小窗与锁屏地图均已关闭'}
    </span>
    {!controls.enabled && (controls.windowEnabled || controls.lockscreenEnabled) &&
      <button className="floating-navigation-controls__action" type="button" onClick={() => controls.start()}>
        授权并启用
      </button>}
    <details className="floating-navigation-controls__message"><summary>地图数据与锁屏说明</summary>
      <p>锁屏亮屏时自动尝试显示地图，解锁恢复小窗；部分系统需允许后台弹出界面。锁屏不显示信息栏。</p>
      <p>OpenFreeMap · © OpenMapTiles · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors（ODbL）</a></p>
    </details>
    {controls.message && <span className="floating-navigation-controls__message" role="status">{controls.message}</span>}
  </div>;
}
