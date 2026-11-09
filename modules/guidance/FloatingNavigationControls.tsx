import { ExternalLink } from 'lucide-react';
import type { useFloatingNavigation } from './useFloatingNavigation';
import { MapSwitch } from '../ui/MapSwitch';
import './floatingNavigation.css';

export type FloatingNavigationControlsState = ReturnType<typeof useFloatingNavigation>;

export function FloatingNavigationControls({ controls, preview = false }: { controls: FloatingNavigationControlsState; preview?: boolean }) {
  if (!controls.supported && !preview) return null;
  return <div className="floating-navigation-controls" aria-label="跨App悬浮小地图">
    {!controls.supported && <p className="floating-navigation-controls__message" role="status">网页仅预览，实际启用需在安卓软件中授权。</p>}
    <div className="floating-navigation-controls__kinds" role="group" aria-label="悬浮显示方式">
      <MapSwitch label="悬浮小窗" checked={controls.windowEnabled} disabled={!controls.supported} onChange={controls.setWindowEnabled} size="setting" />
      <MapSwitch label="锁屏地图" checked={controls.lockscreenEnabled} disabled={!controls.supported} onChange={controls.setLockscreenEnabled} size="setting" />
    </div>
    <div className="floating-navigation-controls__kinds" role="group" aria-label="节能与常亮">
      <MapSwitch label="熄屏低频节能" checked={controls.energySaving} disabled={!controls.supported} onChange={controls.setEnergySaving} size="setting" />
      <MapSwitch label="锁屏地图常亮" checked={controls.lockscreenKeepOn} disabled={!controls.supported} onChange={controls.setLockscreenKeepOn} size="setting" />
    </div>
    <span className="floating-navigation-controls__title"><ExternalLink size={14} />朝向</span>
    <div className="floating-navigation-controls__modes" role="group" aria-label="悬浮导航方向">
      <button type="button" disabled={!controls.supported} aria-pressed={controls.mode === 'north'} onClick={() => controls.setMode('north')}>指北</button>
      <button type="button" disabled={!controls.supported} aria-pressed={controls.mode === 'motion'} onClick={() => controls.setMode('motion')}>运动朝上</button>
      <button type="button" disabled={!controls.supported} aria-pressed={controls.mode === 'compass'} onClick={() => controls.setMode('compass')}>手机罗盘</button>
    </div>
    {controls.supported && <span className="floating-navigation-controls__message" role="status">
      {controls.enabled
        ? controls.visible ? '悬浮地图服务运行中 · 当前可见' : '悬浮地图服务运行中 · 切换到其他应用后显示'
        : controls.windowEnabled || controls.lockscreenEnabled ? '显示已开启 · 悬浮地图尚未运行或等待授权' : '悬浮小窗与锁屏地图均已关闭'}
    </span>}
    {controls.supported && !controls.enabled && (controls.windowEnabled || controls.lockscreenEnabled) &&
      <button className="floating-navigation-controls__action" type="button" onClick={() => controls.start()}>
        授权并启用
      </button>}
    <details className="floating-navigation-controls__message"><summary>显示选项与地图说明</summary>
      <p>小窗与锁屏地图共用真实高程；路线、实走轨迹和中央实际方向继续显示。缺少高程的区域暂时留黑，不补画地形。</p>
      <p>节能仅在熄屏时降低浮窗定位频率；屏幕亮起恢复高频定位。启用常亮时会调暗锁屏地图，但不能承诺整机省电。锁屏地图需已开启；不会主动唤醒屏幕或绕过解锁。</p>
      <p>罗盘使用手机传感器；若精度不足会提示校准，不会拿路线方向代替罗盘。</p>
      <p>锁屏亮屏时自动尝试显示地图，解锁恢复小窗；部分系统需允许后台弹出界面。锁屏不显示信息栏。</p>
      <p>OpenFreeMap · © OpenMapTiles · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors（ODbL）</a></p>
    </details>
    {controls.message && <span className="floating-navigation-controls__message" role="status">{controls.message}</span>}
  </div>;
}
