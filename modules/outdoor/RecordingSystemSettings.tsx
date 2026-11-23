import { useEffect, useState } from 'react';
import { readRecordingSystem, recordingSystem, RECORDING_SYSTEM_STATE_EVENT } from './recordingSystem';

export function RecordingSystemSettings() {
  const bridge = recordingSystem();
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState(readRecordingSystem);

  useEffect(() => {
    if (!bridge || !expanded) return;
    const sync = () => setState(readRecordingSystem());
    sync();
    window.addEventListener(RECORDING_SYSTEM_STATE_EVENT, sync);
    return () => window.removeEventListener(RECORDING_SYSTEM_STATE_EVENT, sync);
  }, [bridge, expanded]);

  if (!bridge) return null;
  return <details className="record-function-group record-group-system" open={expanded}
    onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>后台记录与快捷按钮</summary>
    <div className="record-system-settings">
      {!state && <small role="status">正在读取安卓设置…</small>}
      <div><span>精确定位{state ? state.preciseLocation ? ' · 已允许' : ' · 待授权' : ''}</span>
        <button type="button" onClick={() => bridge.openSettings('permissions')}>应用权限</button></div>
      {state?.systemLocation === false && <div><span>系统定位 · 已关闭</span>
        <button type="button" onClick={() => bridge.openSettings('location')}>系统定位</button></div>}
      <div><span>记录通知{state ? state.notifications ? ' · 已开启' : ' · 已关闭' : ''}</span>
        <button type="button" onClick={() => bridge.openSettings('notifications')}>通知设置</button></div>
      <div><span>电池优化{state ? state.batteryUnrestricted ? ' · 不优化' : ' · 优化中' : ''}</span>
        <button type="button" onClick={() => bridge.openSettings('battery')}>电池设置</button></div>
      {state?.batterySaver && <div><span>系统省电模式 · 已开启</span>
        <button type="button" onClick={() => bridge.openSettings('powerSaver')}>省电设置</button></div>}
      {state?.backgroundRestricted && <div><span>后台运行 · 受限制</span>
        <button type="button" onClick={() => bridge.openSettings('permissions')}>应用设置</button></div>}
      <small>锁屏断点可检查山兔的后台活动限制。部分手机在应用详情的耗电设置里提供此选项。</small>
      <button type="button" onClick={() => bridge.addTile()}>添加「轨迹记录」到下拉快捷设置</button>
    </div>
  </details>;
}
